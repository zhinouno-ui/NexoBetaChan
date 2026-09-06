(function(root, factory){
  if(typeof module === 'object' && module.exports) module.exports = factory();
  else root.NodoChatMetrics = factory();
})(globalThis, function(){
  'use strict';
  const upper = value => String(value ?? '').trim().toUpperCase();
  const date = value => { const d = new Date(value || 0); return Number.isNaN(d.getTime()) ? 0 : d.getTime(); };
  function chatKey(ticket) {
    const id = ticket?.masterId || ticket?.solicitudId || ticket?.usuario || 'chat';
    return upper(ticket?.usuario || 'usuario') + '_' + String(id).replace(/[^A-Z0-9]/gi, '_');
  }
  function snapshot(tickets, marks) {
    const byUser = new Map(), unread = new Map(), signatures = [];
    let total = 0, accepted = 0;
    for(const ticket of tickets) {
      const name = upper(ticket.usuario);
      if(!byUser.has(name)) byUser.set(name, ticket);
      let count = 0;
      if(ticket.accepted) {
        accepted++;
        const readAt = date(marks[chatKey(ticket)]);
        for(const message of ticket.thread || []) {
          if(upper(message.origen) === 'USUARIO' && date(message.fecha) > readAt) count++;
        }
      }
      unread.set(ticket, count);
      total += count;
      const thread = ticket.thread || [], last = thread[thread.length - 1] || {};
      signatures.push([ticket.usuario, ticket.accepted ? 'A' : 'E', ticket.masterId || ticket.solicitudId || '',
        thread.length, count, last.fecha || '', last.mensaje || ''].join(':'));
    }
    return { byUser, unread, total, accepted, signature: signatures.join('||') };
  }
  function create({ getTickets, readMarks, now = Date.now }) {
    let lastTotal = null, lastAt = 0;
    function read() { return snapshot(getTickets() || [], readMarks() || {}); }
    function stableTotal(real) {
      const current = now();
      if(lastTotal > 0 && real === 0 && current - lastAt < 2200) return lastTotal;
      if(real !== lastTotal) { lastTotal = real; lastAt = current; }
      return real;
    }
    return { read, stableTotal };
  }
  return { create, snapshot, chatKey };
});
