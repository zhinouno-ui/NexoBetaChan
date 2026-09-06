'use strict';

// One request, one send. A timeout or lost window never retries a money action.
function createRequestRegistry({ setTimer = setTimeout, clearTimer = clearTimeout, makeId = () => `${Date.now()}-${Math.random().toString(16).slice(2)}` } = {}) {
  const pending = new Map();

  function run(webContents, channel, payload, timeoutMs, timeoutMessage, prefix = '') {
    const requestId = prefix + makeId();
    return new Promise((resolve, reject) => {
      const finish = (callback, value) => {
        clearTimer(timer);
        pending.delete(requestId);
        callback(value);
      };
      const timer = setTimer(() => finish(reject, new Error(timeoutMessage)), timeoutMs);
      pending.set(requestId, {
        resolve: value => finish(resolve, value),
        reject: error => finish(reject, error)
      });
      try { webContents.send(channel, { requestId, ...payload }); }
      catch (error) { pending.get(requestId)?.reject(error); }
    });
  }

  function settle(response = {}, errorMessage = 'Error en automatización.') {
    const request = pending.get(response.requestId);
    if (!request) return;
    if (response.ok !== false) request.resolve(response.result ?? response);
    else request.reject(new Error(response.error || errorMessage));
  }

  function rejectAll(error) {
    for (const request of pending.values()) request.reject(error);
    pending.clear();
  }

  return { pending, run, settle, rejectAll };
}

module.exports = { createRequestRegistry };
