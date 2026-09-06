function fakeClock() {
  let sequence = 0;
  const timeouts = new Map(), intervals = new Map();
  return {
    setTimeout(fn) { const id = ++sequence; timeouts.set(id, fn); return id; },
    clearTimeout(id) { timeouts.delete(id); },
    setInterval(fn) { const id = ++sequence; intervals.set(id, fn); return id; },
    clearInterval(id) { intervals.delete(id); },
    flush() { const next = [...timeouts.values()]; timeouts.clear(); next.forEach(fn => fn()); },
    poll() { [...intervals.values()].forEach(fn => fn()); },
    counts() { return { timeouts: timeouts.size, intervals: intervals.size }; }
  };
}
const settle = () => new Promise(resolve => setImmediate(resolve));
module.exports = { fakeClock, settle };
