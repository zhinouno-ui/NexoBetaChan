// Funciones sin DOM ni estado del panel. Los Intl se crean una sola vez, al usarlos.
(function(root, factory){
  if(typeof module==='object' && module.exports && typeof window==='undefined') module.exports=factory();
  else (root.NodoDomain||(root.NodoDomain={})).formatos=factory();
})(globalThis, function(){
  'use strict';
  const ZONA_AR='America/Argentina/Buenos_Aires';
  let moneda, fechaHora, horaChat, diaArgentina, miles;

  function money(v){
    moneda ||= new Intl.NumberFormat('es-AR',{style:'currency',currency:'ARS',maximumFractionDigits:0});
    return moneda.format(Number(v||0));
  }
  function normalizar(v){ return String(v||'').trim().toUpperCase(); }
  function formatFecha(fechaRaw){
    if(!fechaRaw) return '';
    try{
      const fecha=new Date(fechaRaw);
      if(isNaN(fecha)) return String(fechaRaw||'');
      fechaHora ||= new Intl.DateTimeFormat('es-AR',{
        timeZone:ZONA_AR, day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit', hour12:false
      });
      return fechaHora.format(fecha).replace(',', ' ·');
    }catch(_e){ return String(fechaRaw||''); }
  }
  function formatearHoraChat(fechaRaw){
    if(!fechaRaw) return '';
    try{
      const fecha=new Date(fechaRaw);
      if(isNaN(fecha)) return '';
      horaChat ||= new Intl.DateTimeFormat('es-AR',{
        timeZone:ZONA_AR, hour:'2-digit', minute:'2-digit', hour12:false
      });
      return horaChat.format(fecha);
    }catch(_e){ return ''; }
  }
  // `ahora` explícito permite verificar límites sin cambiar el reloj del sistema.
  function inicioDiaArgentina(ahora=Date.now()){
    diaArgentina ||= new Intl.DateTimeFormat('en-CA',{
      timeZone:ZONA_AR, year:'numeric', month:'2-digit', day:'2-digit'
    });
    const partes=diaArgentina.formatToParts(new Date(ahora));
    const get=tipo=>partes.find(p=>p.type===tipo).value;
    return new Date(get('year')+'-'+get('month')+'-'+get('day')+'T00:00:00-03:00');
  }
  // Exportación de agentes: MM/DD/YYYY HH:MM:SS interpretado en Argentina.
  function parseFechaCSV(str){
    if(!str) return null;
    const s=String(str).trim();
    const m=s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
    if(m){
      const iso=m[3]+'-'+m[1].padStart(2,'0')+'-'+m[2].padStart(2,'0')+'T'
        +(m[4]||'00').padStart(2,'0')+':'+(m[5]||'00').padStart(2,'0')+':'+(m[6]||'00').padStart(2,'0')+'-03:00';
      const fecha=new Date(iso);
      if(!isNaN(fecha)) return fecha;
    }
    const fecha=new Date(s);
    return isNaN(fecha)?null:fecha;
  }
  function getTurno(fechaISO){
    if(!fechaISO) return 'TN';
    const h=new Date(new Date(fechaISO).getTime()-3*60*60*1000).getUTCHours();
    return h>=6&&h<14?'TM':h>=14&&h<22?'TT':'TN';
  }
  function soloDigitos(v){ return Math.abs(Number(String(v==null?'':v).replace(/[^\d]/g,''))||0); }
  function formatMiles(n){
    miles ||= new Intl.NumberFormat('es-AR');
    return miles.format(n);
  }
  function cotejoFmtMiles(v){ const n=soloDigitos(v); return n?formatMiles(n):''; }
  function fmtMilesConSigno(v){
    const neg=/^\s*-/.test(String(v==null?'':v)), n=soloDigitos(v);
    return n?(neg?'-':'')+formatMiles(n):(neg?'-':'');
  }
  function parseMontoConSigno(v){ return /^\s*-/.test(String(v==null?'':v))?-soloDigitos(v):soloDigitos(v); }

  return Object.freeze({money, normalizar, formatFecha, formatearHoraChat, inicioDiaArgentina,
    parseFechaCSV, getTurno, cotejoFmtMiles, fmtMilesConSigno, parseMontoConSigno});
});
// Importación: convierte texto en datos; el adaptador del panel administra archivos y Supabase.
(function(root, factory){
  if(typeof module==='object' && module.exports && typeof window==='undefined') module.exports=factory(require('./formatos.js'));
  else (root.NodoDomain||(root.NodoDomain={})).csv=factory(root.NodoDomain.formatos);
})(globalThis, function(formatos){
  'use strict';
  function parseCSV(text){
    if(text.charCodeAt(0)===0xFEFF) text=text.slice(1);
    const rows=[];
    let row=[], cur='', inQuotes=false;
    for(let i=0;i<text.length;i++){
      const c=text[i];
      if(inQuotes){
        if(c==='"'&&text[i+1]==='"'){ cur+='"'; i++; }
        else if(c==='"') inQuotes=false;
        else cur+=c;
      }else{
        if(c==='"') inQuotes=true;
        else if(c===','){ row.push(cur); cur=''; }
        else if(c==='\n'||c==='\r'){
          row.push(cur); rows.push(row); row=[]; cur='';
          if(c==='\r'&&text[i+1]==='\n') i++;
        }else cur+=c;
      }
    }
    if(cur||row.length||text.endsWith('"')){ row.push(cur); rows.push(row); }
    return rows;
  }
  function cleanPhone(v){ return v?(String(v).replace(/[^\d]/g,'')||null):null; }
  function parseNumCsv(v){
    if(v===undefined||v===null||v==='') return 0;
    const n=Number(String(v).replace(/\./g,'').replace(',','.'));
    return Number.isFinite(n)?n:0;
  }
  function parseIntCsv(v){
    if(v===undefined||v===null||v==='') return 0;
    const n=parseInt(String(v).trim(),10);
    return Number.isFinite(n)?n:0;
  }
  function columnas(headers){
    const indices=new Map(headers.map((h,i)=>[String(h||'').trim().toLowerCase(),i]));
    return (row,name)=>{ const i=indices.get(name); return i===undefined?'':(row[i]??''); };
  }
  function prepararJugadores(rows, pc){
    if(!rows.length) return [];
    const getCol=columnas(rows[0]), registros=[];
    for(let i=1;i<rows.length;i++){
      const r=rows[i];
      if(!r||!r.length) continue;
      const usuario=String(getCol(r,'usuarios')||'').trim();
      if(!usuario||/^\d{4}-\d{2}-\d{2}t/i.test(usuario)||(/^\d+$/.test(usuario)&&usuario.length>=10)) continue;
      const alias=String(getCol(r,'alias')||'').trim();
      const reg={
        usuario:usuario.toLowerCase(), nombre:alias||usuario.toLowerCase(), alias:alias||null,
        estado_revision:String(getCol(r,'estado de revision')||'').trim()||null,
        estado_actual:String(getCol(r,'estado actual')||'').trim()||null,
        cargas_hist:parseIntCsv(getCol(r,'cargas')), descargas_hist:parseIntCsv(getCol(r,'descargas')),
        neto:parseNumCsv(getCol(r,'neto')), score_hist:parseNumCsv(getCol(r,'score')),
        lealtad:parseIntCsv(getCol(r,'lealtad')),
        ultima_actividad:String(getCol(r,'ultima actividad')||'').trim()||null,
        contactado_por:String(getCol(r,'ya contactados')||'').trim()||null,
        recuperado_por:String(getCol(r,'recuperados!')||'').trim()||null, pc_codigo:pc
      };
      const tel=cleanPhone(getCol(r,'telefono'));
      if(tel) reg.telefono=tel;
      registros.push(reg);
    }
    return registros;
  }
  function prepararOperaciones(text, ahora=Date.now()){
    // La declaración opcional de Excel no es un registro CSV.
    text=text.replace(/^\uFEFF/, '').replace(/^\s*sep=,[ \t]*(?:\r\n|\r|\n|$)/i, '');
    const rows=parseCSV(text), aliasSet=new Set(), retiros=[];
    if(!rows.length) return {aliases:[], retiros, totalRows:0};
    const getCol=columnas(rows[0]), desde=new Date(ahora).getTime()-24*60*60*1000;
    let totalRows=0;
    for(let i=1;i<rows.length;i++){
      const row=rows[i], alias=String(getCol(row,'alias')||'').trim().toLowerCase();
      if(!alias||alias==='donplata') continue;
      aliasSet.add(alias); totalRows++;
      const tipo=String(getCol(row,'tipo')||'').trim();
      const cantidad=parseFloat(String(getCol(row,'cantidad')).replace(/,/g,'.')||'0');
      const fecha=getCol(row,'fecha');
      if(tipo==='Deposito de un jugador'&&cantidad<0&&fecha){
        const date=formatos.parseFechaCSV(fecha);
        if(date&&date.getTime()>=desde) retiros.push({alias, fecha:date.toISOString(), monto:Math.abs(cantidad)});
      }
    }
    return {aliases:[...aliasSet], retiros, totalRows};
  }
  return Object.freeze({parseCSV, cleanPhone, parseNumCsv, parseIntCsv, prepararJugadores, prepararOperaciones});
});
// Motor puro: recibe casos/historial; no consulta DOM, red, billeteras ni almacenamiento.
(function(root, factory){
  if(typeof module==='object' && module.exports && typeof window==='undefined') module.exports=factory();
  else (root.NodoDomain||(root.NodoDomain={})).conciliacion=factory();
})(globalThis, function(){
  'use strict';
  const HORA=60*60*1000, OFFSET_AR=-3*HORA;
  function turno(ts=Date.now()){
    // Trabajar en UTC sobre la hora desplazada evita depender del TZ de Windows.
    const d=new Date(new Date(ts).getTime()+OFFSET_AR), h=d.getUTCHours();
    let franja, inicio;
    if(h>=22){ franja='22-06'; inicio=22; }
    else if(h<6){ franja='22-06'; inicio=22; d.setUTCDate(d.getUTCDate()-1); }
    else if(h<14){ franja='06-14'; inicio=6; }
    else{ franja='14-22'; inicio=14; }
    const id=d.getUTCFullYear()+'-'+String(d.getUTCMonth()+1).padStart(2,'0')+'-'+String(d.getUTCDate()).padStart(2,'0')+'_'+franja;
    d.setUTCHours(inicio,0,0,0);
    return {id, inicioMs:d.getTime()-OFFSET_AR};
  }
  function turnoId(ts){ return turno(ts).id; }
  function inicioTurnoMs(ts){ return turno(ts).inicioMs; }
  function agregar(map, key, value){
    const values=map.get(key);
    if(values) values.push(value); else map.set(key,[value]);
  }
  function match(casos, movs){
    casos=Array.isArray(casos)?casos:[]; movs=Array.isArray(movs)?movs:[];
    const falt=[], sobr=[], sobrPorMonto=new Map(), retiros=new Map(), deposPorMonto=new Map();
    for(const c of casos){
      const monto=Number(c.monto_disponible);
      if(!(monto>0)) continue;
      if(c.tipo==='FALTANTE') falt.push(c);
      if(c.tipo==='SOBRANTE'){ sobr.push(c); agregar(sobrPorMonto,monto,c); }
    }
    // Una sola pasada sobre movimientos, en vez de filtrarlos por cada caso.
    for(const mov of movs){
      const tipo=String(mov.tipo||'').toUpperCase(), monto=Math.abs(Number(mov.monto));
      if(tipo==='RETIRO'&&!mov.esTransferenciaInterna){
        const wallet=String(mov.billetera_id);
        if(!retiros.has(wallet)) retiros.set(wallet,new Map());
        agregar(retiros.get(wallet),monto,mov);
      }else if(tipo==='DEPOSITO_SR'&&!(mov.usuario&&String(mov.usuario).trim())) agregar(deposPorMonto,monto,mov);
    }
    const sugerencias=[], combinaciones=[], explicaciones=[], usadosSobr=new Set();
    for(const f of falt){
      const monto=Number(f.monto_disponible);
      const pares=(sobrPorMonto.get(monto)||[]).filter(s=>!usadosSobr.has(s.case_id)&&s.wallet_id!==f.wallet_id);
      if(pares.length){
        const s=pares[0];
        if(pares.length===1) usadosSobr.add(s.case_id);
        const candidatos=(retiros.get(String(s.wallet_id))?.get(monto)||[]).slice();
        sugerencias.push({tipo:'MOVER_RETIRO', confianza:pares.length===1&&candidatos.length===1?'EXACTA':'AMBIGUA',
          caso_faltante:f.case_id, caso_sobrante:s.case_id, pares_posibles:pares.map(p=>p.case_id), candidatos});
        continue;
      }
      // Se mantiene orden y aritmética original: combinaciones sólo sugeridas, nunca aplicadas.
      for(let i=0;i<sobr.length;i++) for(let j=i+1;j<sobr.length;j++){
        if(Number(sobr[i].monto_disponible)+Number(sobr[j].monto_disponible)===monto)
          combinaciones.push({tipo:'COMBINACION',caso:f.case_id,partes:[sobr[i].case_id,sobr[j].case_id]});
      }
    }
    for(const s of sobr){
      if(usadosSobr.has(s.case_id)) continue;
      const candidatos=deposPorMonto.get(Number(s.monto_disponible));
      if(candidatos?.length) explicaciones.push({tipo:'DEPO_EXISTENTE',caso:s.case_id,candidatos:candidatos.slice()});
    }
    return {sugerencias, combinaciones, explicaciones};
  }
  function movimientosTurno(historial, inicioMs, estados=['OK','ACREDITADA','PAGADA','COMPLETADA','APROBADA']){
    const permitidos=new Set(estados), movimientos=[];
    for(const h of historial){
      const ts=h.created_at?new Date(h.created_at).getTime():0;
      if(!(ts>=inicioMs)||!permitidos.has(String(h.estado||'').toUpperCase())) continue;
      movimientos.push({id:h.id,tipo:String(h.tipo||'').toUpperCase(),billetera_id:String(h.billetera_id||''),
        billetera_nombre:h.billetera_nombre||'',monto:Math.abs(Number(h.monto||0)),usuario:h.usuario||'',
        esTransferenciaInterna:/transfer/i.test(String(h.origen||'')+' '+String(h.notas||'')),
        chunior_movimiento_id:h.chunior_movimiento_id||null,ts,_fila:h});
    }
    return movimientos;
  }
  function indexarMovimientos(movimientos){
    const porBilletera=new Map();
    for(const mov of movimientos) agregar(porBilletera,String(mov.billetera_id),mov);
    return porBilletera;
  }
  function declaracion(saldo, valor){
    const decl=Math.abs(Number(String(valor).replace(/[^\d]/g,''))||0);
    const chunior=Number(saldo.saldo_chunior||0), dif=Math.round(decl-chunior);
    const resid=+(decl-chunior-dif).toFixed(2);
    return {wallet_id:saldo.wallet_id,nombre:saldo.nombre,chunior,decl,dif,resid};
  }
  return Object.freeze({turnoId, inicioTurnoMs, match, movimientosTurno, indexarMovimientos, declaracion});
});
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
