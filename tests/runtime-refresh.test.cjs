const { test } = require('node:test');
const assert = require('node:assert/strict');
const Refresh = require('../renderer/runtime/refresh-coordinator.js');
const Realtime = require('../renderer/runtime/realtime.js');
const { fakeClock, settle } = require('./helpers/clock.cjs');

test('100 señales simultáneas hacen una lectura, y señales durante ella dejan una lectura final', async () => {
  const timers = fakeClock();
  let count = 0, release;
  const reader = Refresh.create({ requests: () => { count++; return new Promise(r => { release = r; }); } }, { timers });
  for(let i = 0; i < 100; i++) reader.request('requests');
  timers.flush(); await settle();
  assert.equal(count, 1);
  for(let i = 0; i < 100; i++) reader.request('requests');
  timers.flush(); await settle();
  assert.equal(count, 1, 'no se superponen lecturas');
  release(); await settle(); timers.flush(); await settle();
  assert.equal(count, 2, 'no se pierde el cambio que llegó durante la lectura');
  release(); await settle(); reader.dispose();
});

test('un error se informa y no bloquea el próximo evento; dispose cancela pendientes', async () => {
  const timers = fakeClock();
  let errors = 0, count = 0;
  const reader = Refresh.create({ chats: () => { count++; throw Error('offline'); } }, { timers, onError: () => errors++ });
  reader.request('chats'); timers.flush(); await settle();
  assert.equal(errors, 1);
  reader.request('chats'); timers.flush(); await settle();
  assert.equal(count, 2);
  reader.request('chats'); reader.dispose(); timers.flush(); await settle();
  assert.equal(count, 2);
  assert.deepEqual(timers.counts(), { timeouts: 0, intervals: 0 });
});

function setup() {
  const timers = fakeClock(), channels = [], removed = [], reads = { requests: 0, chats: 0, wallets: 0, conversation: 0 };
  const client = {
    channel(name) {
      const channel = { name, on(type, filter, fn) { this.fn = fn; this.filter = filter; return this; }, subscribe() { return this; } };
      channels.push(channel); return channel;
    },
    removeChannel(channel) { removed.push(channel); }
  };
  const service = Realtime.create({ client, timers, getOffice: () => 'P4', getAliases: () => ['P4', 'PC4', 'SANCHEZ'],
    hasOpenChat: () => true, refresh: Object.fromEntries(Object.keys(reads).map(key => [key, () => reads[key]++])) });
  service.subscribeRequests(); service.subscribeRequestBroadcast(); service.subscribeChatBroadcast(); service.startPolling();
  return { timers, channels, removed, reads, service };
}

test('canales filtran oficinas y comparten la misma lectura de solicitudes', async () => {
  const { timers, channels, reads, service } = setup();
  channels[1].fn({ payload: { pc: 'P2' } });
  channels[2].fn({ payload: { pc: 'P2' } });
  timers.flush(); await settle();
  assert.equal(reads.requests + reads.chats, 0);
  channels[0].fn({ eventType: 'UPDATE' });
  channels[1].fn({ payload: { pc: 'PC4' } });
  channels[2].fn({ payload: { pc: 'SANCHEZ' } });
  timers.flush(); await settle();
  assert.deepEqual(reads, { requests: 1, chats: 1, wallets: 0, conversation: 1 });
  service.stop();
});

test('reemplazo y cierre eliminan canales/timers e ignoran eventos de suscripciones antiguas', async () => {
  const { timers, channels, removed, reads, service } = setup();
  service.startPolling();
  assert.equal(timers.counts().intervals, 3, 'iniciar dos veces no duplica polls');
  service.subscribeRequests();
  assert.equal(removed.length, 1);
  channels[0].fn({ eventType: 'UPDATE' }); timers.flush(); await settle();
  assert.equal(reads.requests, 0);
  timers.poll(); service.stop(); service.stop(); timers.flush(); await settle();
  assert.equal(removed.length, 4);
  channels.forEach(ch => ch.fn({ payload: { pc: 'P4' }, eventType: 'UPDATE' }));
  timers.flush(); await settle();
  assert.deepEqual(reads, { requests: 0, chats: 0, wallets: 0, conversation: 0 });
  assert.deepEqual(timers.counts(), { timeouts: 0, intervals: 0 });
});
