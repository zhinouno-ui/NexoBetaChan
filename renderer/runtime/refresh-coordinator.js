(function(root, factory){
  if(typeof module === 'object' && module.exports) module.exports = factory();
  else root.NodoRefresh = factory();
})(globalThis, function(){
  'use strict';

  // Sólo lecturas: agrupa ráfagas y garantiza una lectura final si llegó un evento
  // durante una petición. Nunca usar para acciones monetarias ni escrituras.
  function create(tasks, { timers = globalThis, delay = 80, onError = () => {} } = {}) {
    const entries = new Map();
    let disposed = false;
    for(const [name, task] of Object.entries(tasks)) {
      entries.set(name, { task, timer: null, running: false, dirty: false });
    }
    function request(name) {
      const entry = entries.get(name);
      if(!entry) throw new Error('Lectura desconocida: ' + name);
      if(disposed) return;
      entry.dirty = true;
      if(entry.running || entry.timer !== null) return;
      entry.timer = timers.setTimeout(() => {
        entry.timer = null;
        if(disposed) return;
        entry.dirty = false;
        entry.running = true;
        Promise.resolve().then(() => {
          if(!disposed) return entry.task();
        }).catch(error => {
          try { onError(error, name); } catch(_) {}
        }).finally(() => {
          entry.running = false;
          if(entry.dirty && !disposed) request(name);
        });
      }, delay);
    }
    function dispose() {
      disposed = true;
      for(const entry of entries.values()) {
        if(entry.timer !== null) timers.clearTimeout(entry.timer);
        entry.timer = null;
        entry.dirty = false;
      }
    }
    return { request, dispose };
  }
  return { create };
});
