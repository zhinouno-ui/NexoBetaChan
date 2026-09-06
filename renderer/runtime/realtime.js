(function(root, factory){
  if(typeof module === 'object' && module.exports) module.exports = factory(require('./refresh-coordinator.js'));
  else root.NodoRealtime = factory(root.NodoRefresh);
})(globalThis, function(Refresh){
  'use strict';

  function create({ client, getOffice, getAliases, hasOpenChat, refresh,
    notify = () => {}, playSound = () => {}, logger = console, timers = globalThis }) {
    const channels = new Map();
    const intervals = [];
    let stopped = false;
    const reads = Refresh.create({
      requests: refresh.requests, wallets: refresh.wallets, chats: refresh.chats,
      conversation: () => { if(hasOpenChat()) return refresh.conversation(); }
    }, { timers, onError: (error, name) => logger.warn('[RT] lectura ' + name, error) });

    function isMyOffice(pc) {
      const eventPc = String(pc || '').toUpperCase().trim();
      if(!eventPc) return true;
      let aliases;
      try { aliases = getAliases(); } catch(_) { aliases = [getOffice()]; }
      aliases = (aliases || []).map(x => String(x).toUpperCase().trim()).filter(Boolean);
      return !aliases.length || aliases.includes(eventPc);
    }
    function remove(key) {
      const channel = channels.get(key);
      channels.delete(key);
      if(channel) {
        try { Promise.resolve(client.removeChannel(channel)).catch(error => logger.warn('[RT] cierre', error)); }
        catch(error) { logger.warn('[RT] cierre', error); }
      }
    }
    function subscribe(key, name, type, filter, handler) {
      if(stopped || !client) return;
      remove(key);
      try {
        // Un callback de una suscripción reemplazada no debe disparar nuevas lecturas.
        const channel = client.channel(name);
        channels.set(key, channel);
        channel.on(type, filter, payload => {
          if(!stopped && channels.get(key) === channel) handler(payload);
        }).subscribe();
      } catch(error) { logger.warn('[RT] suscripción ' + name, error); }
    }
    function inserted() { notify('🔔 Nueva solicitud'); playSound('solicitud'); }
    function subscribeRequests() {
      subscribe('requests', 'solicitudes_' + getOffice(), 'postgres_changes', {
        event: '*', schema: 'public', table: 'solicitudes', filter: 'pc_codigo=eq.' + getOffice()
      }, payload => {
        reads.request('requests');
        if(payload.eventType === 'INSERT') inserted();
      });
    }
    function subscribeRequestBroadcast() {
      subscribe('requestBroadcast', 'nodo:solicitudes', 'broadcast', { event: 'cambio' }, msg => {
        const payload = msg && msg.payload;
        if(!isMyOffice(payload && payload.pc)) return;
        reads.request('requests');
        if(payload && String(payload.op) === 'INSERT') inserted();
      });
    }
    function subscribeChatBroadcast() {
      subscribe('chatBroadcast', 'nodo:chat', 'broadcast', { event: 'cambio' }, msg => {
        if(!isMyOffice(msg && msg.payload && msg.payload.pc)) return;
        reads.request('chats');
        if(hasOpenChat()) reads.request('conversation');
      });
    }
    function startPolling() {
      if(stopped || intervals.length) return;
      intervals.push(timers.setInterval(() => reads.request('requests'), 60000));
      intervals.push(timers.setInterval(() => reads.request('wallets'), 20000));
      intervals.push(timers.setInterval(() => {
        if(hasOpenChat()) reads.request('conversation');
      }, 3500));
    }
    function stop() {
      if(stopped) return;
      stopped = true;
      reads.dispose();
      intervals.forEach(id => timers.clearInterval(id));
      intervals.length = 0;
      for(const key of channels.keys()) remove(key);
    }
    return { isMyOffice, subscribeRequests, subscribeRequestBroadcast,
      subscribeChatBroadcast, startPolling, stop };
  }
  return { create };
});
