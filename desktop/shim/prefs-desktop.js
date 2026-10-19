// Simple Task Timer
// Copyright (C) 2026 Islam Hassan
// SPDX-License-Identifier: GPL-3.0-or-later
//
// Desktop app: the "Turn off" button on the Preferences page. It removes the
// global shortcut, so that no key goes to Simple Task Timer from other apps.
// Uses showShortcut, showError and showStatus from options.js.

'use strict';

document.getElementById('open-off').addEventListener('click', async () => {
  try {
    await browser.commands.update({ name: '_execute_action', shortcut: '' });
    showError('open-error', '');
    showStatus('Saved. No shortcut opens Simple Task Timer.');
  } catch (e) {
    showError('open-error', 'The shortcut was not removed: ' + (e && e.message || e));
  }
  await showShortcut();
});
