/* Portal: withdrawals-execution. Factories are inert until create(deps); legacy handlers are returned in globals. */
(function(root, define){
  const api = define();
  if(typeof module === 'object' && module.exports) module.exports = api;
  else root.NodoPortalWithdrawalsExecution = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function(){
  'use strict';
  const dependencies = Object.freeze(["_drexGlobalLock","_drexGlobalUnlock","_rv2ActualizarBotonAprobar","_rv2BilsUsables","_rv2Finalizar","_rv2Modal","_rv2PintarVeredicto","_rv2TotalSel","_trazaFin","_trazaInit","_trazaPaso","_wdLock","_wdUnlock","ajustarSaldoBilletera","alert","callDrex","cargarHistorial","cargarSolicitudesPortal","cerrarExpedienteSolicitud","cerrarPortalJobModal","cerrarRetiroV2","confirm","document","ensureDrexSession","escapeHtml","fetch","localStorage","money","notificarUsuarioEnChat","pcOperativa","registrarEnHistorial","registrarRetiroEnChunior","renderBillerasInicio","setTimeout","sincronizarBilleterasChunior","supabaseClient","toast","window"]);
  function create(deps){
const api = {};
async function notificarRetiroParcialPortal(solicitudId, montoPago, pagadoAcum, restante, montoTotal, saldoPost){
  if(!deps.window.panelAPI || !deps.window.panelAPI.rpc || !solicitudId) return { ok:false, detail:'sin panelAPI/id' };
  const op = (deps.window.operador && (deps.window.operador.usuario||deps.window.operador.nombre)) || 'panel';
  const sid = Number(solicitudId);
  const formas = [
    // Firma REAL (verificada contra Supabase y usada por el camino original del panel):
    //   landing_retiro_registrar_parcial(p_id, p_monto_parcial, p_operador)
    // Las A/B/C eran conjeturas y NINGUNA coincidía → el parcial se pagaba pero nunca se
    // registraba el progreso. Va primera.
    { k:'N', p:{ p_id:sid, p_monto_parcial:Number(montoPago)||0, p_operador:op,
                 p_saldo_post:(saldoPost!=null?Number(saldoPost):null) } },
    { k:'A', p:{ p_solicitud_id:sid, p_monto_pagado:Number(pagadoAcum)||0, p_monto_restante:Number(restante)||0, p_monto_total:Number(montoTotal)||0, p_operador:op } },
    { k:'B', p:{ p_solicitud_id:sid, p_monto:Number(montoPago)||0, p_operador:op } },
    { k:'C', p:{ p_solicitud_id:sid, p_monto:Number(montoPago)||0 } }
  ];
  // La firma real va siempre primero. Un error de transporte puede llegar después
  // de confirmar el pago en la base: jamás se prueba otra firma en ese caso.
  for(const f of formas){
    let r;
    try{
      r = await deps.window.panelAPI.rpc('landing_retiro_registrar_parcial', f.p);
    }catch(e){
      const detail = String(e.message || e);
      console.warn('[retiro-parcial-portal] resultado incierto; no se reintenta:', detail);
      return { ok:false, uncertain:true, detail };
    }
    if(!r) return { ok:false, uncertain:true, detail:'sin respuesta al registrar el parcial' };
    if(!r.error){
      // Guardar una preferencia local no forma parte de la transacción. Si falla,
      // el pago sigue confirmado y no debe enviarse otra vez.
      try{ deps.localStorage.setItem('nodo_rpc_parcial_shape', f.k); }catch(_e){}
      return { ok:true, detail:'forma '+f.k };
    }
    const msg = String(r.error.message||'');
    const esFirma = /PGRST202|Could not find the function|function .* does not exist/i.test(
      String(r.error.code||'')+' '+msg+' '+String(r.error.details||''));
    if(!esFirma) return { ok:false, detail:msg };
  }
  return { ok:false, detail:'ninguna firma coincidió — mirá el hint en consola y avisá para ajustarla' };
}
api.notificarRetiroParcialPortal = notificarRetiroParcialPortal;

async function _rv2LeerSaldo(intento){
  const st = deps.withdrawalState.current; if(!st || !deps.window.ctrlElectron) return;
  const pintar=function(){ try{ deps._rv2PintarVeredicto(); deps._rv2ActualizarBotonAprobar(); }catch(_e){} };
  // El agente puede estar tomado por otra operación justo cuando abrís el modal. Antes se
  // intentaba UNA vez, quedaba en "no pudimos leer sus fichas" y ahí moría — y como _rv2Aprobar
  // sólo valida el saldo si pudo leerlo, el retiro salía SIN chequear las fichas. Ahora reintenta.
  intento = Number(intento||0);
  if(!deps._drexGlobalLock('rv2-saldo')){
    if(intento < 6 && deps.withdrawalState.current===st){
      st.saldoFallo='ocupado'; pintar();
      deps.setTimeout(function(){ if(deps.withdrawalState.current===st) _rv2LeerSaldo(intento+1); }, 2500);
      return;
    }
    st.saldoFallo='ocupado'; pintar(); return;
  }
  deps._wdLock();
  try{
    const b = await deps.callDrex('buscarUsuario', st.usuario, { skipBalance:false });
    // Sólo se cree un saldo LEÍDO de verdad: con dígitos en el texto y sin la sesión caída. Con la
    // sesión inválida el casino deja la lista de fondo y el modal del saldo no abre bien: el preload
    // devolvía 0 y el modal decía "NO TIENE FICHAS · $0" con el jugador teniendo $35.020.
    const _raw = String((b && b.balance && b.balance.raw) || '');
    const _confiable = !!(b && b.exists && !b.needsLogin && !b.pageError
      && typeof b.balance?.value === 'number' && Number.isFinite(b.balance.value) && /\d/.test(_raw));
    if(_confiable){
      st.saldoReal = b.balance.value; st.saldoFallo = null;
      // Y que la tarjeta de pendientes también lo sepa: de ahí sale el atajo "Retirar lo que tiene",
      // que dependía sólo del escaneo en segundo plano y después de recargar no aparecía.
      try{
        deps.window._retiroSaldoCheck = deps.window._retiroSaldoCheck || {};
        const _m = Number(st.objetivo || st.declarado || 0);
        deps.window._retiroSaldoCheck[String(st.usuario).toLowerCase()] = {
          saldo: b.balance.value, monto: _m, suficiente: b.balance.value + 0.5 >= _m,
          confiable: true, ts: Date.now(), raw: _raw.trim() };
      }catch(_e){}
    } else {
      st.saldoFallo = (b && (b.needsLogin || b.pageError)) ? 'sesion' : 'ilegible';
    }
  }catch(_e){ st.saldoFallo='ilegible'; }
  finally{ deps._wdUnlock(); deps._drexGlobalUnlock(); pintar(); }
}

// APROBAR: valida, extrae las fichas UPFRONT (para que no se las jueguen) y pasa a
// la fase de confirmar cada transferencia.
api._rv2Aprobar = async function(){
  const st = deps.withdrawalState.current; if(!st) return;
  const total = deps._rv2TotalSel();
  const seleccionadas = deps._rv2BilsUsables()
    .filter(function(b){ return st.sel[String(b.ID_BILLETERA)] && Number(st.montos[String(b.ID_BILLETERA)])>0; })
    .map(function(b){ return { id:String(b.ID_BILLETERA), nombre:b.NOMBRE_VISIBLE||'—', chunior:b.CHUNIOR_UID, saldo:Number(b.SALDO||0), monto:Number(st.montos[String(b.ID_BILLETERA)]||0) }; });
  if(!seleccionadas.length){ deps.toast('Tildá al menos una billetera con monto.','red'); return; }
  if(total<=0){ deps.toast('El total a pagar es 0.','red'); return; }
  // Se compara contra LO QUE FALTA de la deuda (totalReal − yaPagado), igual que el botón. Antes
  // comparaba contra st.objetivo, que es un valor que se lee al abrir el modal y puede venir del
  // metadata podrido: el botón te habilitaba y esta validación te rechazaba con "supera el monto
  // real ($200.000)" cuando en pantalla decía claramente que faltaban $250.000. Y no corta el
  // flujo: pagar de más se pregunta, no se prohíbe — el que sabe cuánto se debe es el operador.
  const _faltaDeuda = Math.max(0, Number(st.totalReal||0) - Number(st.yaPagado||0));
  if(total > _faltaDeuda + 0.5){
    if(!deps.confirm('Vas a pagar '+deps.money(total)+' y de esta deuda sólo faltan '+deps.money(_faltaDeuda)+'.\n\n'
      + 'Son '+deps.money(total-_faltaDeuda)+' de MÁS.\n\n'
      + 'Si el total del retiro está mal cargado, corregilo arriba en "Total del retiro".\n\n¿Pagar igual?')) return;
  }
  for(const b of seleccionadas){ if(b.monto > b.saldo+0.5){ deps.toast(b.nombre+' no tiene '+deps.money(b.monto)+' (saldo '+deps.money(b.saldo)+').','red'); return; } }
  // Chequeo de fichas. Si no se pudo leer al abrir el modal, se intenta AHORA — antes se salteaba
  // en silencio (la condición pedía saldoReal!=null) y el retiro salía sin verificar nada.
  if(st.saldoReal==null){
    deps.toast('Leyendo las fichas de '+st.usuario+' antes de pagar…','blue');
    try{ await _rv2LeerSaldo(99); }catch(_e){}          // 99 = sin reintentos, es el último tiro
  }
  if(st.saldoReal==null){
    if(!deps.confirm('No se pudieron leer las fichas de '+st.usuario+'.\n\nSi seguís, el retiro sale A CIEGAS: no sabemos si tiene el saldo.\n\n¿Continuar igual?')) return;
  } else if(total > st.saldoReal+0.5){
    if(!deps.confirm('El usuario tiene '+deps.money(st.saldoReal)+' de fichas pero vas a retirar '+deps.money(total)+'. ¿Seguir igual?')) return;
  }
  st.obs = (deps.document.getElementById('rv2Obs')?deps.document.getElementById('rv2Obs').value:'').trim();
  st.pagar = seleccionadas; st.totalPagar = total;

  // El botón ya dice "Pagar $X ahora · quedan $Y": esa ES la confirmación. Antes había además un
  // tilde "confirmo retiro parcial" que sólo repetía lo que el operador acababa de armar a mano.
  const esParcial = total < st.objetivo - 0.5;
  // En modo parcial explícito no se pide confirmar que es parcial: ya se eligió ese camino.
  if(esParcial && !st.parcialAceptado && !st.modoParcial){
    deps.toast('Tildá "Confirmo retiro PARCIAL" para continuar (o completá el monto).','yellow');
    try{ const t=deps.document.getElementById('rv2Total'); if(t){ t.style.outline='2px solid #f5c518'; deps.setTimeout(function(){ t.style.outline=''; },1500); t.scrollIntoView({block:'center'}); } }catch(_e){}
    return;
  }
  // Freno inverso: entraste por "💸 Parcial" pero el monto cubre TODO. Pasa fácil, porque al elegir
  // la billetera del desplegable se completa con min(saldo, lo que falta): si esa billetera alcanza,
  // te llena la deuda entera. Si seguís, el retiro se cierra PAGADO y sale de la bandeja de parciales.
  if(st.modoParcial && !esParcial){
    if(!deps.confirm('Con este monto el retiro queda COMPLETO, no parcial.\n\n'
      + 'Pagás ' + deps.money(total) + ' y la deuda es ' + deps.money(st.objetivo) + '.\n\n'
      + '¿Es correcto? Si querías abonar solo una parte, cancelá y bajá el monto de la billetera.')) return;
  }
  const confirmarCada = !!(deps.document.getElementById('rv2ConfCada') && deps.document.getElementById('rv2ConfCada').checked);

  // Cerrar la vista/pestaña/modal de inmediato si no se confirmó paso a paso, liberando al operador para ver el hilo abajo
  if(!confirmarCada){
    deps.cerrarRetiroV2();
    try{ if(typeof deps.cerrarExpedienteSolicitud === 'function') deps.cerrarExpedienteSolicitud(); else if(deps.window.cerrarExpedienteSolicitud) deps.window.cerrarExpedienteSolicitud(); }catch(_e){}
    try{ if(typeof deps.cerrarPortalJobModal === 'function') deps.cerrarPortalJobModal(); else if(deps.window.cerrarPortalJobModal) deps.window.cerrarPortalJobModal(); }catch(_e){}
    deps.toast('Portal: procesando retiro '+(esParcial?'parcial ':'')+'...', 'blue');
  }

  // 1) Extraer las fichas del usuario (Agentes) — con lock y traza inferior visible
  if(!deps._drexGlobalLock('rv2-retiro')){ deps.toast('Hay otra operación en curso. Esperá.','yellow'); return; }
  deps._wdLock();
  deps._trazaInit('Retiro '+(esParcial?'PARCIAL':'')+' · '+st.usuario+' · '+deps.money(total)+(st.id?(' (sol. #'+st.id+')'):''));
  let fichasOk=false;
  try{
    deps.toast('Portal: abriendo backoffice...', 'blue');
    deps._trazaPaso('Abriendo sesión de Agentes...');
    if(!await deps.ensureDrexSession()){
      deps.toast('Sesión de Agentes requerida.','red');
      deps._trazaPaso('Falta sesión de Agentes','err');
      deps._trazaFin('err');
      return;
    }
    deps._trazaPaso('Sesión de Agentes lista','ok');

    deps.toast('Portal: buscando '+st.usuario+'...', 'blue');
    deps._trazaPaso('Buscando '+st.usuario+' en Agentes...');
    const bb = await deps.callDrex('buscarUsuario', st.usuario, { skipBalance:true });
    if(bb && (bb.needsLogin || bb.pageError)){
      const _mot = bb.needsLogin ? 'Se cayó la sesión de Agentes' : 'Agentes devolvió una página de error';
      deps.toast(_mot+' · no se sacó nada. Entrá de nuevo y reintentá.','red');
      deps._trazaPaso(_mot+' · no se operó','err');
      deps._trazaFin('err');
      return;
    }
    if(!bb || !bb.exists){
      deps.toast('Usuario '+st.usuario+' no encontrado en Agentes.','red');
      deps._trazaPaso(st.usuario+' no existe en Agentes','err');
      deps._trazaFin('err');
      return;
    }
    deps._trazaPaso(st.usuario+' encontrado'+(bb.balance?.raw?(' · saldo '+bb.balance.raw.trim()):''), 'ok');

    deps.toast('Portal: retirando '+deps.money(total)+'...', 'blue');
    deps._trazaPaso('Retirando '+deps.money(total)+' en Agentes...');
    const rr = await deps.callDrex('retirarSaldo', total);
    if(!(rr && rr.ok!==false)){
      deps.toast('No se pudo extraer las fichas: '+((rr&&rr.message)||'error')+' — no se transfirió nada.','red');
      deps._trazaPaso('Falló extracción: '+((rr&&rr.message)||'error'),'err');
      deps._trazaFin('err');
      return;
    }
    st.saldoPost = (typeof rr?.newBalance?.value==='number' && !rr?.newBalance?.unchanged) ? rr.newBalance.value : null;
    fichasOk=true;
    deps._trazaPaso('Retiro aplicado en Agentes'+(st.saldoPost!=null?(' · saldo '+deps.money(st.saldoPost)):''), 'ok');
    deps.toast('Retiro '+(esParcial?'parcial ':'')+'OK: '+st.usuario+' · '+deps.money(total), 'green');
  }catch(e){
    deps.toast('Error en retiro: '+(e.message||''),'red');
    deps._trazaPaso('Error: '+(e.message||String(e)),'err');
    deps._trazaFin('err');
  }finally{
    deps._wdUnlock();
    deps._drexGlobalUnlock();
  }
  if(!fichasOk) return;

  // 2) Registrar las transferencias
  if(confirmarCada){ st.fase='confirmar'; _rv2RenderConfirmar(); return; } // fase de confirmar una x una
  // RÁPIDO (default): debita cada billetera + registra su retiro en Chunior con notificación y traza, y finaliza.
  st.chuMovs = st.chuMovs || [];
  for(const b of st.pagar){
    if(b.chunior){
      deps._trazaPaso('Registrando en Chunior ('+b.nombre+' · '+deps.money(b.monto)+')...');
      try{
        const _rc = await deps.registrarRetiroEnChunior(b.chunior, b.monto, st.usuario);
        if(_rc && _rc.ok && _rc.movimientoId){
          st.chuMovs.push(String(_rc.movimientoId));
          deps.toast('📋 Retiro Chunior N° '+_rc.movimientoId+' ('+b.nombre+')', 'blue');
          deps._trazaPaso('Registrado en Chunior (N° '+_rc.movimientoId+' · '+b.nombre+')', 'ok');
        } else if(_rc && _rc.ok && !_rc.movimientoId){
          deps.toast('📋 Retiro anotado en Chunior ('+b.nombre+', sin N° confirmado)', 'blue');
          deps._trazaPaso('Anotado en Chunior ('+b.nombre+')', 'ok');
        } else if(_rc && _rc.error){
          deps.toast('⚠️ Retiro OK pero falló Chunior ('+b.nombre+'): '+_rc.error, 'red');
          deps._trazaPaso('Falló Chunior ('+b.nombre+'): '+_rc.error, 'warn');
          try{ if(deps.window.chuniorPendienteAdd) deps.window.chuniorPendienteAdd({ tipo:'RETIRO', uid:b.chunior, monto:b.monto, usuario:st.usuario, histId:null, motivo:_rc.error }); }catch(_e){}
        }
      }catch(_e){
        console.warn('[rv2] chunior', _e);
        deps.toast('⚠️ Error Chunior ('+b.nombre+'): '+(_e.message||''), 'red');
        deps._trazaPaso('Error Chunior ('+b.nombre+')', 'warn');
        try{ if(deps.window.chuniorPendienteAdd) deps.window.chuniorPendienteAdd({ tipo:'RETIRO', uid:b.chunior, monto:b.monto, usuario:st.usuario, histId:null, motivo:_e.message||'excepción' }); }catch(_e2){}
      }
    }
    try{ await deps.ajustarSaldoBilletera(b.id, -b.monto); }catch(_e){}
    st.hechas[b.id]=true;
    try{ deps._trazaPaso('Billetera '+b.nombre+' debitada ('+deps.money(b.monto)+')', 'ok'); }catch(_e){}
  }
  // Sin try/catch, una excepción acá se perdía en un unhandled rejection: la plata YA salió,
  // el modal quedaba congelado en el último paso de la traza y no se registraba nada — ni en
  // historial_ops ni en la solicitud. Pasó con un parcial de $500.000 (sol. #198680).
  try{
    // CON el estado: el modal ya se cerró arriba (cerrarRetiroV2) y el global está en null.
    await deps._rv2Finalizar(st);
  }catch(e){
    const _d = (e && e.message) || String(e);
    try{ deps._trazaPaso('FALLÓ EL CIERRE: '+_d, 'err'); }catch(_e){}
    try{ deps.toast('⚠ Se pagó pero NO se cerró la solicitud · anotalo', 'red'); }catch(_e){}
    try{ deps.alert('⚠️ El retiro SE PAGÓ pero falló el cierre.\n\n' + _d
      + '\n\nLa plata ya salió y la solicitud quedó con el estado anterior.'
      + '\nAnotalo y cerralo desde 💸 Parciales.'); }catch(_e){}
  }
};

function _rv2RenderConfirmar(){
  const st = deps.withdrawalState.current; if(!st) return;
  const el = deps._rv2Modal();
  const filas = st.pagar.map(function(b){
    const done = st.hechas[b.id]===true; const proc = st.hechas[b.id]==='procesando';
    return '<div style="display:flex;align-items:center;gap:10px;padding:9px 11px;border-radius:9px;background:'+(done?'#12261a':'#161b22')+';border:1px solid '+(done?'rgba(34,197,94,.4)':'#30363d')+';margin-top:7px">'
      + '<div style="flex:1"><div style="font-weight:800;color:#f0f6fc">💳 '+deps.escapeHtml(b.nombre)+' → '+deps.money(b.monto)+'</div>'
      +   '<div class="small" style="color:#8b949e">'+(done?'✓ transferido y registrado':(proc?'registrando…':'Hacé la transferencia real y tocá Listo'))+'</div></div>'
      + (done?'<span style="color:#22c55e;font-weight:800">✓</span>':(proc?'<span class="small" style="color:#8b949e">…</span>':'<button class="mini-btn green" style="font-size:11px" onclick="_rv2Confirmar(\''+b.id+'\')">✅ Transferí, listo</button>'))
      + '</div>';
  }).join('');
  const faltan = st.pagar.filter(function(b){ return st.hechas[b.id]!==true; }).length;
  el.innerHTML =
    '<div style="max-height:82vh;overflow:auto;background:#0d1117;border:1px solid #30363d;border-radius:16px;box-shadow:0 18px 55px rgba(0,0,0,.55);padding:16px;color:#e6edf3">'
    + '<div style="font-size:17px;font-weight:900;color:#fb923c;margin-bottom:4px">⬆ Confirmá las transferencias</div>'
    + '<div class="small" style="color:#8b949e;margin-bottom:8px">Las fichas ('+deps.money(st.totalPagar)+') YA se extrajeron. Transferí desde cada billetera al CBU <b>'+deps.escapeHtml(st.cbu||'—')+'</b> y confirmá cada una.</div>'
    + filas
    + '<div style="display:flex;justify-content:flex-end;gap:8px;margin-top:14px">'
    // Con todas confirmadas el cierre ya salió solo (ver _rv2Confirmar). El botón queda como
    // reintento manual por si ese cierre automático falló, no como paso obligatorio.
    +   (faltan===0
         ? '<button class="mini-btn green" style="font-weight:800" onclick="this.disabled=true;_rv2Finalizar()">Cerrar el retiro</button>'
         : '<span class="small" style="color:#8b949e;align-self:center">Faltan '+faltan+' transferencia(s)</span>')
    + '</div></div>';
  el.style.display='block';
}

// Confirma UNA transferencia: registra el retiro en Chunior por esa billetera y la debita.
api._rv2Confirmar = async function(bid){
  const st = deps.withdrawalState.current; if(!st) return;
  bid = String(bid);
  const b = st.pagar.find(function(x){ return x.id===bid; });
  if(!b || st.hechas[bid]===true || st.hechas[bid]==='procesando') return;
  st.hechas[bid]='procesando'; _rv2RenderConfirmar();
  try{
    st.chuMovs = st.chuMovs || [];
    if(b.chunior){
      try{
        const _rc = await deps.registrarRetiroEnChunior(b.chunior, b.monto, st.usuario);
        if(_rc && _rc.ok && _rc.movimientoId){
          st.chuMovs.push(String(_rc.movimientoId));
          deps.toast('📋 Retiro Chunior N° '+_rc.movimientoId+' ('+b.nombre+')', 'blue');
          deps._trazaPaso('Registrado en Chunior (N° '+_rc.movimientoId+' · '+b.nombre+')', 'ok');
        } else if(_rc && _rc.ok && !_rc.movimientoId){
          deps.toast('📋 Retiro anotado en Chunior ('+b.nombre+', sin N° confirmado)', 'blue');
          deps._trazaPaso('Anotado en Chunior ('+b.nombre+')', 'ok');
        } else if(_rc && _rc.error){
          deps.toast('⚠️ Falló Chunior ('+b.nombre+'): '+_rc.error, 'red');
          deps._trazaPaso('Falló Chunior ('+b.nombre+'): '+_rc.error, 'warn');
          try{ if(deps.window.chuniorPendienteAdd) deps.window.chuniorPendienteAdd({ tipo:'RETIRO', uid:b.chunior, monto:b.monto, usuario:st.usuario, histId:null, motivo:_rc.error }); }catch(_e){}
        }
      }catch(_e){
        console.warn('[rv2] chunior', _e);
        deps.toast('⚠️ Error Chunior ('+b.nombre+'): '+(_e.message||''), 'red');
        deps._trazaPaso('Error Chunior ('+b.nombre+')', 'warn');
        try{ if(deps.window.chuniorPendienteAdd) deps.window.chuniorPendienteAdd({ tipo:'RETIRO', uid:b.chunior, monto:b.monto, usuario:st.usuario, histId:null, motivo:_e.message||'excepción' }); }catch(_e2){}
      }
    }
    try{ await deps.ajustarSaldoBilletera(b.id, -b.monto); }catch(_e){}
    st.hechas[bid]=true;
    try{ deps._trazaPaso('Transferido '+b.nombre+' · '+deps.money(b.monto),'ok'); }catch(_e){}
    deps.toast('✓ '+b.nombre+': '+deps.money(b.monto),'green');
  }catch(e){ st.hechas[bid]=false; deps.toast('Error en '+b.nombre+': '+(e.message||''),'red'); }
  _rv2RenderConfirmar();
  // CIERRE AUTOMÁTICO. Con la última billetera confirmada ya está TODO hecho: las fichas salieron,
  // los movimientos están anotados en Chunior y la plata se transfirió. Lo único que faltaba era
  // apretar "Finalizar retiro", que no decide nada — sólo registra. Y si el operador cerraba el
  // modal ahí (o se le colgaba la ventana), la plata YA se había movido pero no quedaba ni la fila
  // en el historial ni la solicitud actualizada: el retiro existía en Chunior y en ningún lado más.
  // Pasó de verdad con un parcial. Ahora cierra solo.
  if(st.pagar.every(function(x){ return st.hechas[x.id]===true; })){
    try{ await deps._rv2Finalizar(st); }catch(e){
      try{ deps.toast('⚠ Se transfirió todo pero falló el cierre: '+(e.message||'')+' — revisá el historial','red'); }catch(_e){}
    }
  }
};

// Finaliza: marca la solicitud (parcial/completa), avisa al usuario y registra el historial.
// Candado de reentrada. El botón "Cerrar el retiro" no tenía ninguno: cada clic escribía una
// fila en historial_ops y volvía a notificar al usuario. En la solicitud 84401 quedaron ONCE
// filas de $500.000 en 20 segundos —con intervalos de hasta 1 ms, imposibles para una persona—
// todas SIN número de Chunior: la transferencia fue una sola, el registro se disparó once
// veces. Si además cada clic ajustó el saldo de la billetera, ese saldo quedó mal (D-64).
let _rv2Cerrando = false;
const _rv2FinalizarInterno = async function(stCapturado){
  // El cierre automático le pasa el estado que ya tenía; el botón manual no pasa nada y usa el global.
  const st = (stCapturado && typeof stCapturado === 'object' && stCapturado.id != null)
    ? stCapturado : deps.withdrawalState.current;
  // Este return existía y era silencioso. Se llega acá DESPUÉS de haber extraído las fichas y
  // debitado la billetera: irse sin hacer nada y sin decir nada deja la plata afuera y la
  // solicitud intacta, que es como quedó el parcial de $500.000 (sol. #198680).
  if(!st){
    try{ deps._trazaPaso('Se perdió el estado del retiro antes de cerrarlo', 'err'); }catch(_e){}
    try{ deps.alert('⚠️ Se perdió el estado del retiro justo antes de cerrarlo.\n\n'
      + 'Si ya transferiste, la plata salió y la solicitud NO se actualizó.'
      + '\nRevisá el historial y cerrala desde 💸 Parciales.'); }catch(_e){}
    return;
  }
  try{ deps._trazaPaso('Cerrando la solicitud...'); }catch(_e){}
  const total = st.totalPagar;
  // Total REAL del retiro (la deuda). En modo parcial NO puede salir del objetivo: ahí el objetivo
  // es "lo que falta", y tomarlo como total cerraba el retiro con la mitad pagada.
  // En modo parcial manda st.totalReal (la deuda, editable arriba). El objetivo es "lo que falta",
  // tomarlo como total cerraba el retiro con una parte pagada.
  const montoTotal = st.modoParcial
    ? (Number(st.totalReal) || st._metaTotal || st.declarado || st.objetivo)
    : (st._metaTotal!=null ? st._metaTotal : st.objetivo);
  const pagadoAcum = (st.yaPagado||0) + total;
  const restante = Math.max(0, montoTotal - pagadoAcum);
  // Si al usuario no le quedan fichas, el retiro está terminado aunque no se haya llegado
  // al monto pedido: esa plata no existe. Antes quedaba EN_PROCESO para siempre y había
  // que cerrarlo a mano (meli1804 pidió 28.000, tenía 26.002, quedó con 0,48 de saldo).
  const _sinFichas = (st.saldoPost != null && Number(st.saldoPost) < 1);
  const completo = (restante <= 0.5) || _sinFichas;
  const listaBil = st.pagar.map(function(b){ return b.nombre+' '+deps.money(b.monto); }).join(' + ');
  // N° de movimiento de Chunior: el historial marca "⚠ Falta Chunior" cuando esta columna está
  // vacía. Se anotaba bien pero el número se descartaba. Con varias billeteras va el primero y
  // los demás quedan en las notas (la columna guarda uno solo).
  const _chuMovs = (st.chuMovs||[]).filter(Boolean);
  const _notaChu = _chuMovs.length>1 ? (' · Chunior: '+_chuMovs.join(' + ')) : '';
  let filaHist = null;
  try{
    filaHist = await deps.registrarEnHistorial({
      usuario:st.usuario, tipo:'RETIRO', monto:total,
      billetera_id: st.pagar[0]?st.pagar[0].id:null, billetera_nombre: listaBil,
      origen:'LANDING', estado:'OK',
      notas:'Retiro'+(completo?'':' PARCIAL')+' · pagado '+deps.money(total)+' desde: '+listaBil+(completo?'':(' · restan '+deps.money(restante)))+(st.obs?(' · Obs: '+st.obs):'')+_notaChu,
      // saldo_pre: las fichas que tenía ANTES de retirar (st.saldoReal, leído al abrir el modal).
      // Sin esto la columna "Saldo pre" del historial salía vacía en todos los parciales.
      saldo_pre: (st.saldoReal!=null ? st.saldoReal : null),
      saldo_post: st.saldoPost, solicitud_id: st.id,
      chunior_movimiento_id: _chuMovs[0] || null
    });
  }catch(_e){
    // Sin fila en historial_ops la operación no existe para el cotejo, para la regla de 24 h
    // ni para el jugador. Callarlo es perder el rastro de plata que ya salió.
    try{ deps._trazaPaso('No se pudo registrar en el historial: '+((_e&&_e.message)||_e), 'err'); }catch(_x){}
    try{ deps.toast('⚠ El retiro se pagó pero NO quedó en el historial · anotalo','red'); }catch(_x){}
  }
  // El titular y el CBU del retiro son el dato más fuerte que tenemos de esa persona:
  // vienen del banco. Hasta ahora quedaban sepultados en las notas y había que rescatarlos
  // con un backfill. Se guardan en el vínculo para que estén a mano en la ficha.
  // Va en try/catch y sin await bloqueante: si falla, el retiro NO se ve afectado.
  try{
    const _titRet = String(st.titular||'').trim();
    const _cbuRet = String(st.destino||st.cbu||'').replace(/\D/g,'');
    if(_titRet || _cbuRet.length >= 18){
      deps.supabaseClient.rpc('panel_guardar_datos_retiro',{
        p_secret: deps.window.PANEL_DATA_SECRET,
        p_pc_codigo:(typeof deps.pcOperativa!=='undefined'?deps.pcOperativa:'')||deps.window.pcOperativa||'',
        p_usuario: st.usuario, p_titular: _titRet||null, p_cbu: _cbuRet||null
      }).catch(function(){});
    }
  }catch(_e){}
  // Un parcial va a EN_PROCESO, NO a EN_REVISION: son bandejas distintas (EN_REVISION es "algo
  // falló / revisar") y además el portal muestra "💸 Te estamos pagando por partes" SOLO con
  // EN_PROCESO — con EN_REVISION el usuario veía "⏳ En verificación" y sin barra de progreso.
  const _estadoFinal = completo ? 'PAGADA' : 'EN_PROCESO';

  // ORDEN IMPORTANTE: primero la RPC, después el estado.
  // metadata.retiro_parcial la escribe SOLO landing_retiro_registrar_parcial, que ACUMULA sobre lo
  // que ya haya. Cuando el panel también la escribía, el pago se contaba DOS veces (pagabas 250k de
  // 500k y quedaba pagado=500k → la RPC lo daba por completo y cerraba el retiro con la mitad).
  // El panel solo la escribe como respaldo si la RPC no pudo registrar.
  let _rp = null;
  // También hay que registrar el pago que CIERRA el retiro. Con `if(!completo)` el último pago no
  // se anotaba: retiro_parcial se quedaba en el valor anterior (350.000 de 450.000) mientras
  // monto_pagado sí llegaba a 450.000 → los dos registros discrepaban y los 100.000 finales
  // figuraban como no pagos aunque estuvieran abonados.
  const _hayProgreso = (Number(st.yaPagado)||0) > 0;
  if(!completo || _hayProgreso){
    try{ _rp = await notificarRetiroParcialPortal(st.id, total, pagadoAcum, restante, montoTotal, st.saldoPost); }
    catch(e){ _rp = { ok:false, detail:(e&&e.message)||String(e) }; }
    if(!_rp || !_rp.ok){
      try{ deps.toast('⚠ Parcial PAGADO pero sin registrar el progreso · revisalo','red'); }catch(_e){}
      try{ deps.alert('⚠️ El retiro parcial SÍ se pagó ('+deps.money(total)+'), pero NO se pudo registrar el progreso.\n\n'
        + ((_rp&&_rp.detail)||'') + '\n\nEl usuario no va a ver el descuento hasta que se registre. Anotalo a mano.'); }catch(_e){}
    }
  }
  // Monto ajustado: el total quedó distinto de lo que PIDIÓ el jugador. Va la corrección con su
  // MOTIVO, que el portal le muestra debajo del progreso y se le avisa una vez por chat (D-88).
  const _decOrig = Number(st.declaradoOriginal || st.declarado || 0);
  const _ajustado = _decOrig > 0 && Math.abs(Number(montoTotal||0) - _decOrig) > 0.5;
  const _motivoAjuste = _ajustado
    ? (String(st.motivoAjuste||'').trim() || ('Pediste '+deps.money(_decOrig)+' y el retiro quedó en '+deps.money(montoTotal)+'.'))
    : '';
  try{
    const _extra = {
      etapa: completo?'RETIRO_V2_COMPLETO':'RETIRO_V2_PARCIAL',
      parcial:!completo, monto_pagado:pagadoAcum, monto_restante:restante, monto_total:montoTotal,
      operador:(deps.window.operador&&(deps.window.operador.usuario||deps.window.operador.nombre))||'panel'
    };
    if(_ajustado){
      _extra.monto_corregido = montoTotal;
      _extra.monto_declarado_original = _decOrig;
      _extra.motivo_ajuste = _motivoAjuste;
    }
    // Respaldo SOLO si la RPC falló: si no, duplicaríamos el progreso.
    if((!completo || _hayProgreso) && (!_rp || !_rp.ok)) _extra.retiro_parcial = { pagado:pagadoAcum, total:montoTotal, restante:restante };
    // Va DESPUÉS de la RPC a propósito: deja el estado correcto aunque la RPC lo haya marcado completo.
    const _ru = await deps.window.actualizarSolicitudPortal(String(st.id), _estadoFinal, _extra);
    // NO silencioso: si esto falla el retiro queda con el estado VIEJO. Un retiro ya saldado que
    // no llega a marcarse PAGADA se queda "en proceso" para siempre y nadie se entera.
    if(!_ru || _ru.error){
      try{ deps.toast('⚠ El retiro se pagó pero la solicitud quedó con el estado anterior','red'); }catch(_e){}
      try{ deps.alert('⚠️ Se pagó '+deps.money(total)+', pero la solicitud NO pasó a '+_estadoFinal+'.\n\n'
        + 'Va a seguir figurando con el estado viejo (por eso a veces un retiro ya saldado queda "en proceso").\n\n'
        + 'Cerralo desde el botón 💸 Parciales cuando puedas.'); }catch(_e){}
    }
  }catch(e){
    try{ deps.toast('⚠ El retiro se pagó pero falló actualizar la solicitud · revisalo','red'); }catch(_e){}
    try{ deps.alert('⚠️ El retiro se pagó ('+deps.money(total)+') pero falló actualizar la solicitud:\n\n'
      + ((e&&e.message)||String(e)) + '\n\nQuedó con el estado anterior — revisalo en 💸 Parciales.'); }catch(_e){}
  }
  try{
    const msg = completo
      ? '✅ Completamos tu retiro. Te transferimos '+deps.money(total)+'. ¡Listo!'
      : '💸 Te transferimos '+deps.money(total)+' de tu retiro · restan '+deps.money(restante)+'. El resto en cuanto se libere otra billetera.';
    // La solicitud ya está en su estado final (PAGADA/EN_PROCESO) → se lo pasamos explícito.
    // El motivo va UNA vez: si ya se le dijo este mismo motivo, no se repite en cada cuota.
    const _avisarAjuste = _ajustado && _motivoAjuste && _motivoAjuste !== String(st._motivoAvisado||'');
    const _pre = _avisarAjuste ? ('📝 Ajustamos tu retiro a '+deps.money(montoTotal)+'. '+_motivoAjuste+'\n') : '';
    await deps.notificarUsuarioEnChat(st.usuario, _pre+(st.obs?st.obs+'\n':'')+msg, st.id, _estadoFinal);
  }catch(_e){}
  // Canal EXTRA: push directo con título/cuerpo claros del parcial (no depende del chat_thread).
  try{ notificarRetiroParcialPush(st.usuario, total, pagadoAcum, montoTotal, completo); }catch(_e){}
  try{ deps._trazaFin('ok', filaHist?.id); }catch(_e){}
  deps.toast(completo?('✅ Retiro completo · '+deps.money(total)):('💸 Parcial '+deps.money(total)+' · restan '+deps.money(restante)), completo?'green':'yellow');
  try{ await deps.sincronizarBilleterasChunior(true); }catch(_e){}
  try{ await deps.cargarHistorial(); }catch(_e){}
  try{ deps.renderBillerasInicio(); }catch(_e){}
  try{ if(typeof deps.cargarSolicitudesPortal==='function') await deps.cargarSolicitudesPortal(true); }catch(_e){}
  deps.cerrarRetiroV2();
  try{ if(typeof deps.cerrarExpedienteSolicitud === 'function') deps.cerrarExpedienteSolicitud(); else if(deps.window.cerrarExpedienteSolicitud) deps.window.cerrarExpedienteSolicitud(); }catch(_e){}
  try{ if(typeof deps.cerrarPortalJobModal === 'function') deps.cerrarPortalJobModal(); else if(deps.window.cerrarPortalJobModal) deps.window.cerrarPortalJobModal(); }catch(_e){}
};
api._rv2Finalizar = async function(){
  if(_rv2Cerrando){
    try{ deps.toast('El retiro ya se está cerrando · esperá','yellow'); }catch(_e){}
    return;
  }
  _rv2Cerrando = true;
  try{ return await _rv2FinalizarInterno.apply(this, arguments); }
  finally{ _rv2Cerrando = false; }
};


  // Aviso de retiro parcial al usuario por PUSH (si tiene push suscripto). Reemplaza el chat, que no siempre llega.
  function notificarRetiroParcialPush(usuario, montoParcial, pagado, total, completado){
    if(!usuario || !deps.window.PUSH_API_URL) return;
    const title = completado ? "BET300 · ¡Retiro completado! 🎉" : "BET300 · Pago de tu retiro 💸";
    const body = completado
      ? ("¡Listo! Te pagamos "+deps.money(montoParcial)+". Total: "+deps.money(pagado)+". Revisá tu cuenta.")
      : ("Te transferimos "+deps.money(montoParcial)+". Vas "+deps.money(pagado)+" de "+deps.money(total)+".");
    try{
      deps.fetch(deps.window.PUSH_API_URL,{ method:"POST",
        headers:{"Content-Type":"application/json","x-push-secret":deps.window.PUSH_SECRET||""},
        // tag COMPARTIDO con la notificación local del portal ("¡Retiro procesado!"): al usar el
        // mismo tag el SO las colapsa en UNA sola en vez de mostrar dos avisos del mismo pago.
        // Se mantienen los dos canales porque el push llega aunque el portal esté cerrado.
        body:JSON.stringify({usuario:usuario, title:title, body:body, url:"/", tag:"bet300-retiro"}) }).catch(function(){});
    }catch(_e){}
  }

api.v154pRegistrarParcial = function(id){ return deps.window.abrirModalRetiroV2(id, {modoParcial:true}); };

    return { globals: api, notificarRetiroParcialPortal, _rv2LeerSaldo, notificarRetiroParcialPush, _rv2RenderConfirmar };
  }
  return Object.freeze({ create, dependencies });
});
