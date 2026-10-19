// Simple Task Timer
// Copyright (C) 2026 Islam Hassan
// SPDX-License-Identifier: GPL-3.0-only
//
// Google sign-in for the desktop app (OAuth 2.0 for desktop apps, with PKCE).
// Google does not let its sign-in page run in an app web view, so:
//   1. The app listens on http://127.0.0.1:<free port>.
//   2. It opens the Google sign-in page in the system browser.
//   3. Google sends the browser back to that address with a one-time code.
//   4. The app sends the code and the PKCE verifier to Google and gets an ID token.
// The page gives the ID token to Firebase (Sync.signInWithGoogleIdToken).
// The client ID and secret are of a Google OAuth client of the type "Desktop
// app". Google says that the secret of such a client is not a secret.

use std::io::{BufRead, BufReader, Write};
use std::net::{TcpListener, TcpStream};
use std::time::{Duration, Instant};

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use sha2::{Digest, Sha256};

const AUTH_URL: &str = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL: &str = "https://oauth2.googleapis.com/token";
const WAIT: Duration = Duration::from_secs(300);

const DONE_PAGE: &str = "<!doctype html><meta charset=utf-8><title>Simple Task Timer</title>\
<body style=\"font:16px system-ui;margin:40px\"><h1>Signed in</h1>\
<p>You can close this tab and go back to Simple Task Timer.</p>";
const FAIL_PAGE: &str = "<!doctype html><meta charset=utf-8><title>Simple Task Timer</title>\
<body style=\"font:16px system-ui;margin:40px\"><h1>Not signed in</h1>\
<p>Go back to Simple Task Timer and try again.</p>";

// A random text of URL-safe characters
fn random_text(bytes: usize) -> Result<String, String> {
    let mut buf = vec![0u8; bytes];
    getrandom::fill(&mut buf).map_err(|e| e.to_string())?;
    Ok(URL_SAFE_NO_PAD.encode(buf))
}

// The PKCE code challenge (RFC 7636, method S256)
pub fn challenge(verifier: &str) -> String {
    URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()))
}

fn decode(text: &str) -> String {
    let bytes = text.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'+' => out.push(b' '),
            b'%' if i + 2 < bytes.len() => {
                match u8::from_str_radix(&text[i + 1..i + 3], 16) {
                    Ok(b) => {
                        out.push(b);
                        i += 2;
                    }
                    Err(_) => out.push(b'%'),
                }
            }
            b => out.push(b),
        }
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn encode(text: &str) -> String {
    let mut out = String::new();
    for b in text.bytes() {
        if b.is_ascii_alphanumeric() || b"-._~".contains(&b) {
            out.push(b as char);
        } else {
            out.push_str(&format!("%{:02X}", b));
        }
    }
    out
}

// The value of a parameter in the request line "GET /?code=...&state=... HTTP/1.1"
pub fn query_param(request_line: &str, name: &str) -> Option<String> {
    let target = request_line.split_whitespace().nth(1)?;
    let query = target.split_once('?')?.1;
    query.split('&').find_map(|pair| {
        let (k, v) = pair.split_once('=').unwrap_or((pair, ""));
        if decode(k) == name { Some(decode(v)) } else { None }
    })
}

pub fn auth_url(client_id: &str, redirect: &str, challenge: &str, state: &str) -> String {
    format!(
        "{AUTH_URL}?client_id={}&redirect_uri={}&response_type=code&scope={}&code_challenge={}\
         &code_challenge_method=S256&state={}&prompt=select_account",
        encode(client_id),
        encode(redirect),
        encode("openid email"),
        encode(challenge),
        encode(state)
    )
}

fn answer(mut stream: TcpStream, page: &str) {
    let _ = write!(
        stream,
        "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        page.len(),
        page
    );
}

// Waits for the browser to come back with the code. Other requests (such as
// /favicon.ico) get the page and the wait goes on.
fn wait_for_code(listener: &TcpListener, state: &str) -> Result<String, String> {
    listener.set_nonblocking(true).map_err(|e| e.to_string())?;
    let start = Instant::now();
    loop {
        if start.elapsed() > WAIT {
            return Err("No answer from the Google sign-in page in 5 minutes.".into());
        }
        let stream = match listener.accept() {
            Ok((stream, _)) => stream,
            Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                std::thread::sleep(Duration::from_millis(200));
                continue;
            }
            Err(e) => return Err(e.to_string()),
        };
        stream.set_nonblocking(false).map_err(|e| e.to_string())?;
        stream.set_read_timeout(Some(Duration::from_secs(5))).map_err(|e| e.to_string())?;
        let mut line = String::new();
        BufReader::new(&stream).read_line(&mut line).map_err(|e| e.to_string())?;
        if let Some(error) = query_param(&line, "error") {
            answer(stream, FAIL_PAGE);
            return Err(format!("Google sign-in stopped: {error}"));
        }
        match (query_param(&line, "code"), query_param(&line, "state")) {
            (Some(code), Some(got)) if got == state => {
                answer(stream, DONE_PAGE);
                return Ok(code);
            }
            (Some(_), _) => {
                answer(stream, FAIL_PAGE);
                return Err("The answer from Google did not match this sign-in.".into());
            }
            _ => answer(stream, FAIL_PAGE),
        }
    }
}

fn exchange(client_id: &str, secret: &str, code: &str, verifier: &str, redirect: &str) -> Result<String, String> {
    let agent: ureq::Agent = ureq::Agent::config_builder()
        .http_status_as_error(false)
        .timeout_global(Some(Duration::from_secs(30)))
        .build()
        .into();
    let mut response = agent
        .post(TOKEN_URL)
        .send_form([
            ("code", code),
            ("client_id", client_id),
            ("client_secret", secret),
            ("redirect_uri", redirect),
            ("grant_type", "authorization_code"),
            ("code_verifier", verifier),
        ])
        .map_err(|e| e.to_string())?;
    let status = response.status();
    let body: serde_json::Value = response.body_mut().read_json().map_err(|e| e.to_string())?;
    if !status.is_success() {
        let reason = body.get("error_description").or(body.get("error")).cloned().unwrap_or_default();
        return Err(format!("Google did not give a token ({status}): {reason}"));
    }
    body.get("id_token")
        .and_then(|v| v.as_str())
        .map(String::from)
        .ok_or_else(|| "Google gave no ID token.".into())
}

// The whole sign-in. open_browser opens a URL in the system browser.
pub fn sign_in(client_id: &str, secret: &str, open_browser: impl Fn(&str) -> Result<(), String>) -> Result<String, String> {
    if client_id.is_empty() {
        return Err("Sync is not set up in this build (no Google client ID).".into());
    }
    let listener = TcpListener::bind("127.0.0.1:0").map_err(|e| e.to_string())?;
    let redirect = format!("http://127.0.0.1:{}", listener.local_addr().map_err(|e| e.to_string())?.port());
    let verifier = random_text(48)?;
    let state = random_text(16)?;
    open_browser(&auth_url(client_id, &redirect, &challenge(&verifier), &state))?;
    let code = wait_for_code(&listener, &state)?;
    exchange(client_id, secret, &code, &verifier, &redirect)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn challenge_matches_rfc_7636() {
        // The example in RFC 7636, appendix B
        assert_eq!(
            challenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"),
            "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
        );
    }

    #[test]
    fn reads_the_code_and_state() {
        let line = "GET /?state=abc%2D1&code=4%2F0Ab_x+y&scope=email HTTP/1.1\r\n";
        assert_eq!(query_param(line, "code").as_deref(), Some("4/0Ab_x y"));
        assert_eq!(query_param(line, "state").as_deref(), Some("abc-1"));
        assert_eq!(query_param(line, "error"), None);
        assert_eq!(query_param("GET /favicon.ico HTTP/1.1", "code"), None);
        assert_eq!(query_param("GET /?error=access_denied HTTP/1.1", "error").as_deref(), Some("access_denied"));
        assert_eq!(query_param("GET /?code=a%2 HTTP/1.1", "code").as_deref(), Some("a%2"));
    }

    #[test]
    fn auth_url_has_the_parameters() {
        let url = auth_url("id.apps.googleusercontent.com", "http://127.0.0.1:5000", "ch", "st");
        assert!(url.starts_with("https://accounts.google.com/o/oauth2/v2/auth?client_id=id.apps.googleusercontent.com&"));
        assert!(url.contains("redirect_uri=http%3A%2F%2F127.0.0.1%3A5000"));
        assert!(url.contains("scope=openid%20email"));
        assert!(url.contains("code_challenge=ch&code_challenge_method=S256&state=st"));
    }

    #[test]
    fn random_texts_differ() {
        let a = random_text(48).unwrap();
        assert_eq!(a.len(), 64);
        assert_ne!(a, random_text(48).unwrap());
    }

    #[test]
    fn no_client_id_gives_an_error() {
        assert!(sign_in("", "", |_| Ok(())).unwrap_err().contains("not set up"));
    }
}
