'use strict';

// Remove listeners AND deadlines after a successful load or a closed window.
function whenWindowReady(win, timeoutMs = 12000, { setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  if (!win.webContents.isLoading()) return Promise.resolve();
  return waitForWindowLoad(win, timeoutMs, null, { setTimer, clearTimer });
}

function waitForWindowLoad(win, timeoutMs, startLoad, { setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  const contents = win.webContents;
  return new Promise(resolve => {
    let done = false;
    let timer;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimer(timer);
      contents.removeListener('did-finish-load', finish);
      contents.removeListener('destroyed', finish);
      resolve();
    };
    contents.once('did-finish-load', finish);
    contents.once('destroyed', finish);
    timer = setTimer(finish, timeoutMs);
    if (startLoad) {
      try { Promise.resolve(startLoad()).catch(finish); }
      catch (_) { finish(); }
    }
  });
}

module.exports = { whenWindowReady, waitForWindowLoad };
