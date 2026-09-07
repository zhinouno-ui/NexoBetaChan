// DESTRABAR DE VERDAD. Antes soltaba cuatro cosas y dejaba tomadas otras cuatro — entre ellas el
// guard del portal, que es el que contesta "hay una operación en curso". Por eso se apretaba
// Destrabar, decía "destrabado", y el panel seguía sin dejar operar. Ahora se sueltan TODOS los
// candados: si el operador pide destrabar, es porque ya no hay nada corriendo.
window.liberarLockAgentes = function(){
  const m = window._drexGlobalBusyMotivo || (window._drexCola && window._drexCola.activo && window._drexCola.activo.nombre);
  try{ if(typeof _drexGlobalUnlock==='function') _drexGlobalUnlock(); }catch(_e){}
  try{ if(typeof _wdForceUnlock==='function') _wdForceUnlock(); }catch(_e){}
  try{ window._v154pParcialBusy = false; }catch(_e){}
  try{ window._retiroSaldoLastRun = 0; }catch(_e){}
  // Los que faltaban:
  try{ window._portalSolicitudOperacionEnCurso = false; }catch(_e){}   // el que decía "operación portal en curso"
  try{ window._operacionManualEnCurso = false; }catch(_e){}
  try{ window._cotejoDeclarando = false; }catch(_e){}
  try{ window._drexSinSesion = false; }catch(_e){}                     // el cortacircuitos de sesión
  try{ if(window._drexCola){ window._drexCola.activo = null; window._drexCola.pendientes = 0; } }catch(_e){}
  try{ document.body.classList.remove('op-portal-en-curso'); delete document.body.dataset.opSolicitud; }catch(_e){}
  try{ if(typeof _wdUnlock==='function'){ let g=0; while(typeof _watchdog!=='undefined' && _watchdog && _watchdog.busy>0 && g++<20) _wdUnlock(); } }catch(_e){}
  try{ _agentesBadgePintar(); }catch(_e){}
  try{ toast('🔓 Agente destrabado'+(m?(' · lo tenía: '+m):'')+'. Ya podés reintentar.', 'green'); }catch(_e){}
  console.log('[lock] destrabado a mano · todos los candados liberados');
};
// Reiniciar Chunior cuando muestra 403/CSRF. Recargar NO sirve (re-envía el POST fallido → mismo
// 403); esto NAVEGA a la base (GET) → token CSRF fresco. hard=true limpia las cookies de Chunior
// (NO Supabase) y fuerza un login nuevo.
window.reiniciarChunior = async function(hard){
  if(!window.chunior || !window.chunior.reset){ try{ toast('Solo disponible en la app de escritorio.','yellow'); }catch(_e){} return; }
  try{ toast(hard?'🧹 Reiniciando Chunior con login limpio…':'🔄 Recuperando Chunior…','blue'); }catch(_e){}
  try{
    await window.chunior.reset(hard?{hard:true}:undefined);
    try{ if(window.chunior.focus) window.chunior.focus(); }catch(_e){}
    try{ toast('✅ Chunior recargado desde la base. Si pide login, ingresá de nuevo.','green'); }catch(_e){}
  }catch(e){ try{ toast('No se pudo reiniciar Chunior: '+(e.message||e),'red'); }catch(_e){} }
};
async function verificarSaldoRetiroOcioso(){
  try{
    try{ if(localStorage.getItem('nodo_saldo_ocioso_off')==='1') return; }catch(_e){}
    if(window._drexGlobalBusy) return; // candado maestro: cualquier operación lo toma
    if(typeof _loteEnCurso!=='undefined' && _loteEnCurso) return;
    if(typeof _operacionManualEnCurso!=='undefined' && _operacionManualEnCurso) return;
    if(typeof _watchdog!=='undefined' && _watchdog && _watchdog.busy>0) return;
    if(window._v154pParcialBusy) return;
    if(typeof colaPendientesAll==='function' && colaPendientesAll().length>0) return;
    if(!window.ctrlElectron) return;
    // Cooldown global: como mucho UNA verificación cada 4 min. Sin esto, con varios retiros abiertos el
    // scanner entraba a Agentes una y otra vez (bucle) y dejaba el agente ocupado → el panel no operaba.
    if(window._retiroSaldoLastRun && (Date.now()-window._retiroSaldoLastRun) < 4*60*1000) return;
    const _MAX_EDAD_MS = 2*60*60*1000; // solo auto-escaneamos retiros RECIENTES (últimas 2 h); los viejos los maneja el operador
    window._retiroSaldoDone = window._retiroSaldoDone || {};
    const pend = ((window.V154P&&window.V154P.solicitudes)||[]).filter(function(s){
      const tipo = String(s.TIPO||s.TIPO_SOLICITUD||'').toUpperCase();
      if(tipo!=='RETIRO') return false;
      if(window._estadoYaCerrado && window._estadoYaCerrado(s.ESTADO)) return false;
      // Retiro YA en curso / parcial en progreso → lo maneja el operador; NO re-escanear
      // (si no, mientras un parcial queda EN_PROCESO el scanner re-entraba al agente y lo trababa).
      if(/EN_PROCESO|EN_REVISION|PROCESANDO|TOMAD/.test(String(s.ESTADO||'').toUpperCase())) return false;
      // Con CUALQUIER pago parcial hecho, el retiro NO se auto-rechaza: la plata ya salió y el
      // usuario está esperando el resto. Se miran TODAS las claves donde puede quedar el progreso
      // (retiro_parcial / retiro_progreso / progreso / monto_pagado suelto): mirando solo una,
      // un retiro con 250k ya pagados terminó AUTO_RECHAZADO.
      try{
        const m=(typeof s.METADATA==='object'?s.METADATA:JSON.parse(s.METADATA||'{}'))||{};
        const _rp = m.retiro_parcial || m.retiro_progreso || m.progreso || {};
        const _pag = Number(_rp.pagado!=null ? _rp.pagado
                          : (_rp.acumulado!=null ? _rp.acumulado
                          : (m.monto_pagado!=null ? m.monto_pagado
                          : (m.pagado_parcial!=null ? m.pagado_parcial : 0)))) || 0;
        if(_pag > 0) return false;
      }catch(_e){}
      return true;
    });
    const objetivo = pend.find(function(s){
      const sid = String(s.ID||s.SOLICITUD_ID||s.ID_SOLICITUD||'');
      const u = String(s.USUARIO||'').toLowerCase();
      if(!u || !sid) return false;
      const fc = Date.parse(s.FECHA_CREACION||s.created_at||s.FECHA||'') || 0;
      if(fc && (Date.now()-fc) > _MAX_EDAD_MS) return false;        // retiro VIEJO → no auto-escanear (corta el bucle)
      const d = window._retiroSaldoDone[sid];
      if(d && d.confiable) return false;                           // ya verificado BIEN → una sola vez, nunca más
      if(d && d.intentos>=3) return false;                         // 3 lecturas fallidas → basta, lo ve el operador
      if(d && (Date.now()-d.ts) < 5*60*1000) return false;         // espaciar reintentos de lecturas fallidas
      return true;
    });
    if(!objetivo) return;
    const usuario = String(objetivo.USUARIO||'');
    const sid = String(objetivo.ID||objetivo.SOLICITUD_ID||objetivo.ID_SOLICITUD||'');
    const monto = Math.abs(Number(objetivo.MONTO_REAL||objetivo.MONTO_DECLARADO||0));
    if(!_drexGlobalLock('retiro-saldo-check')) return;
    window._retiroSaldoLastRun = Date.now();
    // Registrar el intento YA (aunque la lectura falle) para no reintentar en bucle.
    { const _p = window._retiroSaldoDone[sid] || {intentos:0}; window._retiroSaldoDone[sid] = {confiable:false, intentos:_p.intentos+1, ts:Date.now()}; }
    _wdLock();
    try{
      const b = await callDrex('buscarUsuario', usuario, { skipBalance:false });
      if(b && b.exists && typeof b.balance?.value === 'number'){
        const saldo = b.balance.value;
        const saldoConfiable = /\d/.test(String(b.balance.raw||'')) && Number.isFinite(saldo); // se leyó DE VERDAD (no un 0 por lectura fallida/lenta)
        const suficiente = saldo + 0.5 >= monto;
        window._retiroSaldoCheck[usuario.toLowerCase()] = { saldo:saldo, monto:monto, suficiente:suficiente, confiable:saldoConfiable, ts:Date.now(), raw:(b.balance.raw||'').trim() };
        try{ if(window._retiroSaldoDone && window._retiroSaldoDone[sid]) window._retiroSaldoDone[sid].confiable = saldoConfiable; }catch(_e){} // lectura confiable → no re-escanear este retiro
        try{ if(typeof window.v154pRenderSolicitudesPortalEnInicio==='function') window.v154pRenderSolicitudesPortalEnInicio(); }catch(_e){}
        // Auto-rechazo ANTI-FRAUDE — SOLO el caso INEQUÍVOCO: el usuario NO tiene fichas (saldo ~0).
        // ⚠ Antes rechazábamos con "saldo < $5.000 y < monto": eso rechazaba a un usuario que SÍ tenía
        // fichas (ej. 4.000 fichas pidiendo 50.000) tratándolo como falso. MAL: si tiene ALGUNAS fichas,
        // corresponde un retiro PARCIAL, no un rechazo. Ahora solo se rechaza si está prácticamente
        // vacío (< _PISO_SIN_FICHAS) y ADEMÁS lo confirmamos con una 2ª lectura independiente (descarta
        // el 0 transitorio por proxy lento). Con fichas reales ⇒ NUNCA se auto-rechaza.
        const _PISO_SIN_FICHAS = 500; // por debajo de esto no hay fichas reales ni para un parcial
        if(saldoConfiable && saldo < _PISO_SIN_FICHAS && saldo < monto){
          // 2ª lectura de confirmación: re-entra a Agentes y vuelve a leer. Solo rechazamos si TAMBIÉN
          // la ve casi vacía. Si la 2ª no confirma (o no se pudo leer), NO se rechaza.
          let confirmado = false, saldo2 = saldo, raw2 = (b.balance.raw||'').trim();
          try{
            const b2 = await callDrex('buscarUsuario', usuario, { skipBalance:false });
            if(b2 && b2.exists && typeof b2.balance?.value === 'number' && /\d/.test(String(b2.balance.raw||''))){
              saldo2 = b2.balance.value; raw2 = (b2.balance.raw||'').trim();
              confirmado = Number.isFinite(saldo2) && saldo2 < _PISO_SIN_FICHAS;
            }
          }catch(_e){ confirmado = false; }
          if(confirmado){
            const sid = objetivo.ID || objetivo.SOLICITUD_ID || objetivo.ID_SOLICITUD;
            const _saldoTxt = (raw2||money(saldo2)).trim();
            try{
              await window.actualizarSolicitudPortal(sid, 'RECHAZADA', {
                etapa: 'AUTO_RECHAZO_SIN_SALDO',
                motivo: 'Sin fichas para retirar (saldo '+_saldoTxt+', confirmado x2)'
              });
              // Al historial. Antes esto sólo salía como toast: se veía tres segundos y se perdía,
              // y después no había forma de saber por qué se le habia rechazado el retiro a alguien.
              try{ await registrarEnHistorial({
                usuario: usuario, tipo:'RETIRO', monto: Number(objetivo.MONTO_REAL||objetivo.MONTO_DECLARADO||0),
                origen:'AUTO', estado:'RECHAZADA', solicitud_id: sid,
                // Con TODO el detalle: qué pidió, qué tenía, cómo se leyó, y qué se le dijo. Un
                // "rechazado" a secas obliga a reconstruir el caso de memoria cuando el cliente
                // reclama tres días después.
                notas:'AUTO-RECHAZO · SIN FICHAS'
                  + ' · pidió '+money(Number(objetivo.MONTO_REAL||objetivo.MONTO_DECLARADO||0))
                  + ' · saldo leído '+_saldoTxt+' (2 lecturas: "'+((b.balance&&b.balance.raw)||'').trim()+'" y "'+raw2+'")'
                  + ' · piso '+money(_PISO_SIN_FICHAS)
                  + (objetivo.TITULAR?(' · titular declarado: '+objetivo.TITULAR):'')
                  + ' · se le avisó por el chat'
              }); }catch(_e){}
              try{ await notificarUsuarioEnChat(usuario, '❌ No pudimos procesar tu retiro: no figurás con fichas disponibles para retirar. Si creés que es un error, escribinos por acá.'); }catch(_e){}
              toast('❌ Retiro de '+usuario+' rechazado · SIN fichas (saldo '+_saldoTxt+', confirmado x2)', 'red');
            }catch(_e){}
          } else {
            toast('⚠ '+usuario+': 1ª lectura casi vacía ('+ (b.balance.raw||'').trim() +') NO confirmada en 2ª ('+raw2+') · NO auto-rechazo', 'yellow');
          }
        } else if(!saldoConfiable){
          toast('⚠ No pude leer bien el saldo de '+usuario+' — NO auto-rechazo. Revisalo a mano.', 'yellow');
        } else {
          toast((suficiente?'✓':'⚠')+' Retiro '+usuario+': saldo '+(b.balance.raw||money(saldo)).trim()+(suficiente?' (alcanza)':' · tiene fichas pero menos que lo pedido → retiro PARCIAL'), suficiente?'blue':'red');
        }
      }
    }catch(_e){}
    finally{ _wdUnlock(); _drexGlobalUnlock(); }
  }catch(_e){}
}
window.verificarSaldoRetiroOcioso = verificarSaldoRetiroOcioso;
// Trigger conservador cada 90s (gated por TODOS los guards + 5 min por usuario).
try{ setInterval(function(){ try{ verificarSaldoRetiroOcioso(); }catch(_e){} }, 90000); }catch(_e){}

function abrirModalTransferirBilleteras(){
  if(!window.chunior){ toast("Chunior no disponible", "red"); return; }
  const bilsConUid = billeteras.filter(function(b){ return b.CHUNIOR_UID && normalizar(b.ACTIVA)==='SI' && normalizar(b.ESTADO||'ACTIVA') !== 'FUSIONADA'; });
  if(!bilsConUid.length){
    abrirModal('🔀 Transferir entre billeteras',
      '<div class="err-box">No hay billeteras con UID de Chunior. Sincronizá primero.</div>',
      function(){ cerrarModal(); }, 'Entendido');
    return;
  }

  function buildOpts(){
    return bilsConUid.map(function(b){
      return '<option value="' + escapeHtml(String(b.ID_BILLETERA)) + '">' +
             escapeHtml(b.NOMBRE_VISIBLE || '—') + ' · ' + money(b.SALDO || 0) +
             '</option>';
    }).join('');
  }

  abrirModal(
    '🔀 Transferir entre billeteras',
    '<div style="color:#c0cad8;font-size:13px;margin-bottom:10px">Mover fichas de una billetera a otra (útil para corregir cargas que quedaron en la billetera ERROR).</div>' +
    '<label style="color:#c0cad8;font-size:12px;font-weight:700">BILLETERA ORIGEN (sale plata)</label>' +
    '<select id="transferOrigen"><option value="">— Elegí origen —</option>' + buildOpts() + '</select>' +
    '<label style="color:#c0cad8;font-size:12px;font-weight:700">BILLETERA DESTINO (entra plata)</label>' +
    '<select id="transferDestino"><option value="">— Elegí destino —</option>' + buildOpts() + '</select>' +
    '<label style="color:#c0cad8;font-size:12px;font-weight:700">MONTO</label>' +
    '<input id="transferMonto" type="number" placeholder="ej: 5000" style="margin-bottom:6px">' +
    '<label style="color:#c0cad8;font-size:12px;font-weight:700">NOTAS (opcional)</label>' +
    '<textarea id="transferNotas" rows="2" placeholder="Ej: corrección de carga al usuario juan777"></textarea>' +
    '<div id="transferRes" style="min-height:16px;margin-top:6px"></div>',
    async function(){
      const origenId  = document.getElementById("transferOrigen")?.value;
      const destinoId = document.getElementById("transferDestino")?.value;
      const monto     = Number(document.getElementById("transferMonto")?.value || 0);
      const notas     = (document.getElementById("transferNotas")?.value || "").trim();
      const resEl     = document.getElementById("transferRes");
      const btn       = document.getElementById("modalSaveBtn");

      if(!origenId || !destinoId){
        if(resEl) resEl.innerHTML = '<span style="color:var(--red);font-size:12px">Elegí origen y destino.</span>'; return;
      }
      if(origenId === destinoId){
        if(resEl) resEl.innerHTML = '<span style="color:var(--red);font-size:12px">Origen y destino no pueden ser la misma billetera.</span>'; return;
      }
      if(!monto || monto <= 0){
        if(resEl) resEl.innerHTML = '<span style="color:var(--red);font-size:12px">Monto inválido.</span>'; return;
      }

      const bilOrigen  = billeteras.find(function(b){ return String(b.ID_BILLETERA) === String(origenId); });
      const bilDestino = billeteras.find(function(b){ return String(b.ID_BILLETERA) === String(destinoId); });
      if(!bilOrigen?.CHUNIOR_UID || !bilDestino?.CHUNIOR_UID){
        if(resEl) resEl.innerHTML = '<span style="color:var(--red);font-size:12px">Alguna billetera no tiene UID de Chunior.</span>'; return;
      }

      if(btn){ btn.disabled = true; btn.textContent = "Transfiriendo..."; }
      if(resEl) resEl.innerHTML = '<span class="small">Aplicando en Chunior...</span>';

      try {
        const r = await _transferirEntreBilleterasChunior(bilOrigen.CHUNIOR_UID, bilDestino.CHUNIOR_UID, monto, notas);
        if(r.ok){
          // Los saldos NO se tocan a mano: Chunior es la fuente de verdad y los repinta al
          // sincronizar. (Antes había acá dos llamadas a ajustarSaldoBilletera que no hacían
          // nada — la función está inerte desde que se sacó el contador paralelo.)

          // ASIENTO. Esto faltaba: la plata se movía en Chunior y de este lado no quedaba
          // rastro de quién la movió, entre qué billeteras ni por qué. Mismo formato que
          // tenían los MOV_BILLETERA del 8/8 ("ORIGEN → DESTINO"), más el N° de Chunior.
          // Va en try: si falla el registro, la transferencia ya se hizo y no se toca.
          try{
            await registrarEnHistorial({
              usuario: 'MOV BILLETERA',
              tipo: 'MOV_BILLETERA',
              monto: monto,
              billetera_id: bilOrigen.ID_BILLETERA || null,       // de dónde salió
              billetera_nombre: (bilOrigen.NOMBRE_VISIBLE||'?') + ' → ' + (bilDestino.NOMBRE_VISIBLE||'?'),
              origen: 'MANUAL',
              estado: 'OK',
              notas: 'Transferencia entre billeteras'
                     + (notas ? (' · ' + notas) : '')
                     + (bilDestino.ID_BILLETERA ? (' · destino_id=' + bilDestino.ID_BILLETERA) : '')
                     + (r.movimientoId ? (' · Chunior N° ' + r.movimientoId) : ' [SIN_N_CHUNIOR]'),
              chunior_movimiento_id: r.movimientoId || null
            });
          }catch(eHist){ console.warn('registrar MOV_BILLETERA:', eHist); }

          toast("✅ Transferencia OK · " + money(monto) + " · " + bilOrigen.NOMBRE_VISIBLE + " → " + bilDestino.NOMBRE_VISIBLE, "green");
          cerrarModal();
          renderBillerasInicio();
        } else {
          if(resEl) resEl.innerHTML = '<div class="err-box" style="padding:10px;font-size:12px;margin-top:6px">❌ ' + escapeHtml(r.error || 'Error') + '</div>';
          if(btn){ btn.disabled = false; btn.textContent = "Transferir"; }
        }
      } catch(e){
        if(resEl) resEl.innerHTML = '<div class="err-box" style="padding:10px;font-size:12px;margin-top:6px">❌ ' + escapeHtml(e.message || 'sin detalle') + '</div>';
        if(btn){ btn.disabled = false; btn.textContent = "Transferir"; }
      }
    },
    'Transferir'
  );
}

// Modal NODO para cambiar la billetera de un movimiento ya registrado.
// El operador NUNCA ve Chunior — toda la maniobra se hace en background.

// ── Asiento del cambio de billetera ──────────────────────────────────────────
// Cambiar billetera SOBRESCRIBE: en Chunior pisa la cuenta destino del mismo N° de
// movimiento, y acá hace un update sobre historial_ops. La billetera anterior se perdía
// para siempre — no quedaba desde cuál se cambió, ni quién, ni cuándo.
//
// Esta función NO cambia nada de eso: solo deja el asiento aparte, antes de pisar.
// El update sigue igual. Va en try porque un fallo del registro nunca debe frenar una
// corrección que el operador necesita hacer.
async function _asentarCambioBilletera(datos){
  try{
    const desde = datos.bilAnteriorNombre || (datos.bilAnteriorId ? ('id ' + datos.bilAnteriorId) : '—');
    const hacia = datos.bilNuevaNombre || (datos.bilNuevaId ? ('id ' + datos.bilNuevaId) : '—');
    await registrarEnHistorial({
      usuario: 'CAMBIO BILLETERA',
      tipo: 'CAMBIO_BILLETERA',
      monto: Number(datos.monto || 0),
      billetera_id: datos.bilAnteriorId || null,     // la que estaba mal anotada
      billetera_nombre: desde + ' → ' + hacia,
      origen: datos.origen || 'MANUAL',
      estado: 'OK',
      notas: 'Cambio de billetera'
             + (datos.movId ? (' · Chunior N° ' + datos.movId) : ' · sin N° de Chunior')
             + (datos.bilNuevaId ? (' · destino_id=' + datos.bilNuevaId) : '')
             + (datos.historialId ? (' · historial_id=' + datos.historialId) : '')
             + (datos.solicitudId ? (' · solicitud=' + datos.solicitudId) : ''),
      chunior_movimiento_id: datos.movId || null
    });
  }catch(e){ console.warn('asentar CAMBIO_BILLETERA:', e); }
}

function cambiarBilleteraHistorialLocal(historialId, currentBilId, solicitudId){
  const bils = billeteras.filter(function(b){
    return normalizar(b.ACTIVA)==='SI' && normalizar(b.ESTADO||'ACTIVA') !== 'FUSIONADA';
  });
  const opciones = bils.map(function(b){
    const sel = String(b.ID_BILLETERA) === String(currentBilId) ? ' selected' : '';
    return '<option value="' + escapeHtml(String(b.ID_BILLETERA)) + '"' + sel + '>' +
           escapeHtml(b.NOMBRE_VISIBLE || '—') + ' · ' + money(b.SALDO || 0) +
           '</option>';
  }).join('');

  if(!historialId && !solicitudId){
    abrirModal('💳 Cambiar billetera',
      '<div class="err-box">No se pudo identificar la operación.</div>',
      function(){ cerrarModal(); }, 'Entendido');
    return;
  }
  if(!bils.length){
    abrirModal('💳 Cambiar billetera',
      '<div class="err-box">No hay billeteras activas disponibles.</div>',
      function(){ cerrarModal(); }, 'Entendido');
    return;
  }

  abrirModal(
    '💳 Cambiar billetera · Historial',
    '<div class="alert-box" style="padding:10px;font-size:12px">Esta operación no tiene N° de movimiento Chunior. Se corrige la billetera en NODO / historial / portal. Si también hubo movimiento en Chunior, corregilo desde Chunior o usá la fila con N°.</div>' +
    '<label style="color:#c0cad8;font-size:12px;font-weight:700">NUEVA BILLETERA</label>' +
    '<select id="cambioBilLocalSel">' + opciones + '</select>' +
    '<div id="cambioBilLocalRes" style="min-height:16px;margin-top:6px"></div>',
    async function(){
      const sel   = document.getElementById("cambioBilLocalSel");
      const resEl = document.getElementById("cambioBilLocalRes");
      const btn   = document.getElementById("modalSaveBtn");
      const nuevoBilId = sel?.value;
      const bilNueva = billeteras.find(function(b){ return String(b.ID_BILLETERA) === String(nuevoBilId); });
      if(!bilNueva){
        if(resEl) resEl.innerHTML = '<span style="color:var(--red);font-size:12px">Seleccioná una billetera.</span>';
        return;
      }
      if(btn){ btn.disabled = true; btn.textContent = "Guardando..."; }
      // UUID validation: historial_ops.id is uuid — reject numeric/non-uuid strings
      const historialIdUUID = (historialId && /^[0-9a-f-]{32,}$/i.test(historialId) && historialId.includes('-')) ? historialId : '';
      try{
        let _antesLocal = null;
        if(historialIdUUID){
          // Leer antes de pisar, igual que en el camino con N° de Chunior.
          try{
            const q = await supabaseClient.from("historial_ops")
              .select("monto,billetera_id,billetera_nombre")
              .eq("id", historialIdUUID).maybeSingle();
            _antesLocal = (q && q.data) ? q.data : null;
          }catch(_e){}
          const upd = await supabaseClient.from("historial_ops")
            .update({ billetera_id: nuevoBilId, billetera_nombre: bilNueva.NOMBRE_VISIBLE })
            .eq("id", historialIdUUID);
          if(upd.error) throw new Error(upd.error.message || 'No se pudo actualizar historial_ops');
        }
        await _asentarCambioBilletera({
          movId: null,                                  // este camino es el que NO tiene N°
          historialId: historialIdUUID || null,
          solicitudId: solicitudId || null,
          monto: _antesLocal ? _antesLocal.monto : 0,
          bilAnteriorId: _antesLocal ? _antesLocal.billetera_id : (currentBilId || null),
          bilAnteriorNombre: _antesLocal ? _antesLocal.billetera_nombre : null,
          bilNuevaId: nuevoBilId,
          bilNuevaNombre: bilNueva.NOMBRE_VISIBLE,
          origen: 'MANUAL_LOCAL'
        });

        if(solicitudId){
          try{
            const metaPatch = {
              billetera_id: nuevoBilId,
              billetera_nombre: bilNueva.NOMBRE_VISIBLE,
              billetera_alias: bilNueva.CBU_ALIAS || bilNueva.ALIAS || '',
              billetera_cbu: bilNueva.CBU || '',
              billetera_banco: bilNueva.TIPO || '',
              billetera_cambiada_panel: true
            };
            const solRow = await supabaseClient.from("landing_solicitudes").select("metadata").eq("id", solicitudId).maybeSingle();
            const metaActual = (solRow && solRow.data && solRow.data.metadata) ? solRow.data.metadata : {};
            await supabaseClient.from("landing_solicitudes")
              .update({ metadata: {...metaActual, ...metaPatch} })
              .eq("id", solicitudId);
          }catch(eMeta){ console.warn("update landing_solicitudes metadata local:", eMeta); }
        }

        toast("✅ Billetera actualizada en historial", "green");
        cerrarModal();
        await cargarHistorial();
      }catch(e){
        if(resEl) resEl.innerHTML = '<div class="err-box" style="padding:10px;font-size:12px;margin-top:6px">❌ ' + escapeHtml(e.message || 'Error') + '</div>';
        if(btn){ btn.disabled = false; btn.textContent = "Guardar"; }
      }
    },
    'Guardar'
  );
}


function cambiarBilleteraMovimiento(movId, historialId, currentBilId){
  if(!window.chunior){ toast("Chunior no disponible", "red"); return; }
  if(!movId){ toast("Esta operación no tiene movimiento de Chunior", "red"); return; }

  // Construir opciones del select: solo billeteras con CHUNIOR_UID configurado
  const bilsConUid = billeteras.filter(function(b){ return b.CHUNIOR_UID && normalizar(b.ACTIVA)==='SI' && normalizar(b.ESTADO||'ACTIVA') !== 'FUSIONADA'; });
  const opciones = bilsConUid.map(function(b){
    const sel = String(b.ID_BILLETERA) === String(currentBilId) ? ' selected' : '';
    return '<option value="' + escapeHtml(String(b.ID_BILLETERA)) + '"' + sel + '>' +
           escapeHtml(b.NOMBRE_VISIBLE || '—') + ' · ' + money(b.SALDO || 0) +
           '</option>';
  }).join('');

  if(!bilsConUid.length){
    abrirModal('💳 Cambiar billetera',
      '<div class="err-box">No hay billeteras configuradas con UID de Chunior. Sincronizá billeteras primero.</div>',
      function(){ cerrarModal(); }, 'Entendido');
    return;
  }

  abrirModal(
    '💳 Cambiar billetera · Mov. N° ' + escapeHtml(String(movId)),
    '<div style="color:#c0cad8;font-size:13px;margin-bottom:10px">Elegí la nueva billetera destino. Se actualiza en Chunior y en el historial automáticamente.</div>' +
    '<label style="color:#c0cad8;font-size:12px;font-weight:700">NUEVA BILLETERA</label>' +
    '<select id="cambioBilSel">' + opciones + '</select>' +
    '<div id="cambioBilRes" style="min-height:16px;margin-top:6px"></div>',
    async function(){
      const sel   = document.getElementById("cambioBilSel");
      const resEl = document.getElementById("cambioBilRes");
      const btn   = document.getElementById("modalSaveBtn");
      const nuevoBilId = sel?.value;
      if(!nuevoBilId){
        if(resEl) resEl.innerHTML = '<span style="color:var(--red);font-size:12px">Seleccioná una billetera.</span>';
        return;
      }
      const bilNueva = billeteras.find(function(b){ return String(b.ID_BILLETERA) === String(nuevoBilId); });
      if(!bilNueva || !bilNueva.CHUNIOR_UID){
        if(resEl) resEl.innerHTML = '<span style="color:var(--red);font-size:12px">La billetera no tiene UID de Chunior.</span>';
        return;
      }
      if(btn){ btn.disabled = true; btn.textContent = "Cambiando..."; }
      if(resEl) resEl.innerHTML = '<span class="small">Aplicando cambio en Chunior...</span>';
      try {
        const r = await _cambiarBilleteraChunior(movId, bilNueva.CHUNIOR_UID);
        if(r.ok){
          // Leer la fila ANTES de pisarla: el update borra la billetera anterior y el
          // monto, que son justo los datos que hacen falta para auditar el cambio.
          let _antes = null;
          if(historialId){
            try{
              const q = await supabaseClient.from("historial_ops")
                .select("monto,billetera_id,billetera_nombre,solicitud_id")
                .eq("id", historialId).maybeSingle();
              _antes = (q && q.data) ? q.data : null;
            }catch(_e){}
          }
          // Actualizar la fila en historial_ops
          if(historialId){
            try {
              await supabaseClient.from("historial_ops")
                .update({ billetera_id: nuevoBilId, billetera_nombre: bilNueva.NOMBRE_VISIBLE })
                .eq("id", historialId);
            } catch(eUpd){ console.warn("update historial_ops:", eUpd); }
          }
          await _asentarCambioBilletera({
            movId: movId,
            historialId: historialId,
            solicitudId: _antes ? _antes.solicitud_id : null,
            monto: _antes ? _antes.monto : 0,
            bilAnteriorId: _antes ? _antes.billetera_id : (currentBilId || null),
            bilAnteriorNombre: _antes ? _antes.billetera_nombre : null,
            bilNuevaId: nuevoBilId,
            bilNuevaNombre: bilNueva.NOMBRE_VISIBLE
          });
          const tagMov = r.movId ? ' (N° ' + r.movId + ')' : '';
          toast("✅ Billetera cambiada · " + bilNueva.NOMBRE_VISIBLE + tagMov, "green");
          cerrarModal();
          await cargarHistorial();
        } else {
          if(resEl) resEl.innerHTML = '<div class="err-box" style="padding:10px;font-size:12px;margin-top:6px">❌ ' + escapeHtml(r.error || 'Error') + '</div>';
          if(btn){ btn.disabled = false; btn.textContent = "Cambiar billetera"; }
        }
      } catch(e){
        if(resEl) resEl.innerHTML = '<div class="err-box" style="padding:10px;font-size:12px;margin-top:6px">❌ ' + escapeHtml(e.message || 'sin detalle') + '</div>';
        if(btn){ btn.disabled = false; btn.textContent = "Cambiar billetera"; }
      }
    },
    'Cambiar billetera'
  );
}

async function _crearBilleterasNuevasChunior(nuevas){
  let _err=null;
  for(const w of nuevas){
    const { error } = await supabaseClient.rpc('panel_billetera_insert',{p_secret:window.PANEL_DATA_SECRET,p_patch:{
      nombre_visible: w.nombre,
      chunior_uid: String(w.uid),
      saldo: w.saldo,
      pc_codigo: pcOperativa,
      activa: true,
      cbu_alias: '',
      titular: '',
      tipo: ''
    }});
    if(error) _err=error;
  }
  if(_err){
    toast('Error al crear billeteras: '+_err.message, 'red');
    return;
  }
  toast('🆕 '+nuevas.length+' billetera(s) agregada(s). Completá CBU, titular y alias en Administrar billeteras.', 'blue');
  // Mostrar también una notificación más visible
  const alertas = document.getElementById('alertas');
  if(alertas){
    const lista = nuevas.map(function(w){ return escapeHtml(w.nombre); }).join(', ');
    alertas.innerHTML += '<div class="alert-box" style="background:#1a3a5a;color:#cde0ff">⚠️ Nuevas billeteras de Chunior: <b>'+lista+'</b>. Falta cargar CBU, titular y alias en Administrar billeteras.</div>';
  }
}

function chuniorNav(path){
  if(window.chunior) window.chunior.navigate(CHUNIOR_BASE + path);
}

// ── Macros del chat ───────────────────────────────────────────────────────────
