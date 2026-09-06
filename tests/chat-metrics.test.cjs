const { test } = require('node:test');
const assert = require('node:assert/strict');
const Metrics = require('../renderer/chat/metrics.js');

test('cuenta sólo mensajes del usuario posteriores a la lectura en tickets aceptados', () => {
  const ticket = { usuario: 'ana', masterId: 1, accepted: true, thread: [
    { origen: 'USUARIO', fecha: '2026-09-05T10:00:00Z' },
    { origen: 'USUARIO', fecha: '2026-09-05T12:00:00Z' },
    { origen: 'PANEL', fecha: '2026-09-05T13:00:00Z' },
    { origen: 'USUARIO', fecha: 'fecha inválida' }
  ] };
  const waiting = { ...ticket, usuario: 'otro', accepted: false };
  const result = Metrics.snapshot([ticket, waiting], { [Metrics.chatKey(ticket)]: '2026-09-05T10:00:00Z' });
  assert.equal(result.total, 1);
  assert.equal(result.accepted, 1);
  assert.equal(result.unread.get(waiting), 0);
  assert.equal(result.byUser.get('ANA'), ticket);
});

test('una pasada obtiene tickets/marcas una vez y no reordena los mensajes', () => {
  const tickets = Array.from({ length: 300 }, (_, i) => ({ usuario: 'u' + i, accepted: true, thread: [
    { origen: 'USUARIO', fecha: '2026-09-05T12:00:00Z', mensaje: 'último en tiempo' },
    { origen: 'USUARIO', fecha: '2026-09-05T10:00:00Z', mensaje: 'último en array' }
  ] }));
  let ticketReads = 0, markReads = 0;
  const model = Metrics.create({ getTickets: () => { ticketReads++; return tickets; }, readMarks: () => { markReads++; return {}; } });
  const result = model.read();
  assert.equal(ticketReads, 1); assert.equal(markReads, 1);
  assert.equal(result.total, 600);
  assert.equal(tickets[0].thread[0].mensaje, 'último en tiempo');
  assert.ok(result.signature.includes('último en array'));
});

test('estabiliza el cero durante 2,2 segundos y conserva el primer ticket por nombre', () => {
  let now = 10;
  const model = Metrics.create({ getTickets: () => [], readMarks: () => ({}), now: () => now });
  assert.equal(model.stableTotal(3), 3);
  now = 2000; assert.equal(model.stableTotal(0), 3);
  now = 2210; assert.equal(model.stableTotal(0), 0);
  const first = { usuario: 'Ana' }, other = { usuario: ' ANA ' };
  assert.equal(Metrics.snapshot([first, other], {}).byUser.get('ANA'), first);
});
