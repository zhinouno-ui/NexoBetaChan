/* Portal: requests-view. Factories are inert until create(deps); legacy handlers are returned in globals. */
(function(root, define){
  const api = define();
  if(typeof module === 'object' && module.exports) module.exports = api;
  else root.NodoPortalRequestsView = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function(){
  'use strict';
  const dependencies = Object.freeze(["V154P","document","esc","estadoCerrado","fecha","money","renderHistorialUnificado","window"]);
  function create(deps){
const api = {};
  function renderSolicitudesPortalEnInicio(){
    const box = deps.document.getElementById("tablaSolicitudesInicio");
    if(!box) return;

    const all = (deps.V154P.solicitudes || []).slice();
    // INICIO: solo muestra CARGA y RETIRO pendientes. SOPORTE va al chat inbox, no acá.
    const abiertas = all.filter(s => (!deps.estadoCerrado(s.ESTADO) || (deps.window._retiroParcialSigueAbierto && deps.window._retiroParcialSigueAbierto(s))) && String(s.TIPO||s.TIPO_SOLICITUD||"").toUpperCase()!=="SOPORTE");
    // Los retiros que se están pagando POR PARTES salen de la lista principal y se agrupan en su
    // propio botón: son trabajo en curso (a veces por días) y tapaban las solicitudes nuevas.
    // Al botón 💸 van los retiros CON PROGRESO parcial, estén a medio pagar o ya saldados pero sin
    // cerrar (esos últimos quedaban tapando la lista principal sin forma de sacarlos).
    const _esParc = function(s){
      try{
        if(String(s.TIPO||s.TIPO_SOLICITUD||'').toUpperCase()!=='RETIRO') return false;
        if(/RECHAZ|CANCEL/.test(String(s.ESTADO||'').toUpperCase())) return false;
        const pp = deps.window._retiroParcialInfo ? deps.window._retiroParcialInfo(s) : null;
        return !!(pp && pp.hasProg && pp.total>0);
      }catch(_e){ return false; }
    };
    const parciales = [], pendientes = [];
    for(const solicitud of abiertas){
      (_esParc(solicitud) ? parciales : pendientes).push(solicitud);
    }
    deps.window._parcialesEnProceso = parciales;
    try{
      const bp = deps.document.getElementById("btnParcialesEnProceso");
      const bc = deps.document.getElementById("btnParcialesCount");
      if(bc) bc.textContent = String(parciales.length);
      if(bp) bp.style.display = parciales.length ? "" : "none";
    }catch(_e){}
    const visibles = pendientes.slice(0,8);

    try{
      const stat = deps.document.getElementById("statPendientes");
      if(stat) stat.textContent = String(pendientes.length);
      const badge = deps.document.getElementById("badgeSolicitudes");
      if(badge){
        if(pendientes.length){ badge.classList.remove("hidden"); badge.textContent = String(pendientes.length); }
        else badge.classList.add("hidden");
      }
      const sub = deps.document.getElementById("statRetiros");
      if(sub){
        const retiros = pendientes.filter(s => String(s.TIPO || s.TIPO_SOLICITUD || "").toUpperCase()==="RETIRO").length;
        sub.textContent = "Retiros: " + retiros;
      }
    }catch(e){}

    let html = "";
    if(!visibles.length){
      html = '<div class="alert-box">No hay solicitudes Portal pendientes.</div>';
    }else{
      html = `<div class="small" style="margin:0 0 8px;color:#98a2b3">Mostrando ${pendientes.length} solicitud/es pendiente/s del portal.</div>` + visibles.map(s => {
        const id = Number(s.ID || s.SOLICITUD_ID || 0);
        const tomada = ["EN_REVISION","EN_PROCESO"].includes(String(s.ESTADO||"").toUpperCase());
        const _esRet = String(s.TIPO||s.TIPO_SOLICITUD||"").toUpperCase()==="RETIRO";
        // Los enums de la base no le dicen nada al operador ("¿ERROR_OPERATIVO qué es?"). Se
        // traducen a lo que significan para él. Lo que no esté mapeado se muestra tal cual, en
        // minúscula, para que se note que falta traducir en vez de gritarle en mayúsculas.
        function _estadoLegible(e){
          const k = String(e||'').toUpperCase().trim();
          // EN_PROCESO es el estado GENERAL de "tomada y trabajándose" — no significa parcial.
          // Sólo se dice "por partes" cuando esta solicitud REALMENTE tiene pagos parciales.
          if(k==='EN_PROCESO'){
            try{
              const pp = deps.window._retiroParcialInfo ? deps.window._retiroParcialInfo(s) : null;
              if(pp && pp.hasProg && pp.restante > 0.5) return 'Pagando por partes';
            }catch(_e){}
            return 'En proceso';
          }
          const M = { PENDIENTE:'Sin tomar', NUEVA:'Sin tomar', EN_ESPERA:'Sin tomar',
                      TOMADA:'Tomada', TOMADO:'Tomada', EN_REVISION:'En revisión',
                      PROCESANDO:'Procesando',
                      ERROR_OPERATIVO:'Falló · reintentar', PAGADA:'Pagada', ACREDITADA:'Acreditada',
                      APROBADA:'Aprobada', RECHAZADA:'Rechazada', CANCELADA:'Cancelada' };
          return M[k] || (k ? k.toLowerCase().replace(/_/g,' ') : '—');
        }
        const _saldoChk = (deps.window._retiroSaldoCheck||{})[String(s.USUARIO||"").toLowerCase()];
        const _esRetiroS = String(s.TIPO||s.TIPO_SOLICITUD||"").toUpperCase()==="RETIRO";
        const _accS = _esRetiroS ? '#fb923c' : (String(s.TIPO||s.TIPO_SOLICITUD||"").toUpperCase()==="CARGA" ? '#22c55e' : ''); // 🟠 retiro · 🟢 carga
        // Si declaró MÁS de lo que tiene pero igual hay fichas retirables, ofrecemos el retiro por
        // lo que HAY (típico: un cero de más) → abre el modal de parcial ya ajustado al saldo real.
        const _sugS = (_esRetiroS && _saldoChk && !_saldoChk.suficiente && _saldoChk.confiable && deps.window._retiroMontoSugerido)
          ? deps.window._retiroMontoSugerido(Number(s.MONTO_REAL||s.MONTO_DECLARADO||0), Number(_saldoChk.saldo||0)) : null;
        const _saldoBadge = (_esRetiroS && _saldoChk) ? `<div style="font-size:10px;font-weight:800;margin-top:2px;color:${_saldoChk.suficiente?'#22c55e':'#ef4444'}">saldo ${deps.esc(_saldoChk.raw||"")}${_saldoChk.suficiente?' ✓':' ⚠ no alcanza'}</div>`
          + (_sugS ? `<button class="mini-btn" style="margin-top:3px;background:#ea580c;color:#fff;font-weight:800;font-size:10px" onclick="_retiroAjustarASaldo(${id})" title="${_sugS.motivo==='ceros'?'Declaró con '+_sugS.ceros+' cero(s) de más — quiso este monto':'No alcanza: retirar todo lo que tiene'}">✔ Retirar ${deps.esc(deps.money(_sugS.monto))}</button>` : "") : "";
        const _pp = (deps.window._retiroParcialInfo ? deps.window._retiroParcialInfo(s) : {restante:Number(s.MONTO_REAL||s.MONTO_DECLARADO||0),pagado:0,total:Number(s.MONTO_REAL||s.MONTO_DECLARADO||0),hasProg:false});
        const _montoCell = (_esRetiroS && _pp.hasProg)
          ? `${deps.money(_pp.restante)}<div style="font-size:10px;font-weight:800;margin-top:2px;color:#a78bfa">parcial · pagado ${deps.money(_pp.pagado)} de ${deps.money(_pp.total)}</div>`
          : deps.money(s.MONTO_REAL || s.MONTO_DECLARADO || 0);
        // Avisos de bono sin liberar / CBU compartido. Informativos: no tocan los botones.
        const _alertaHtml = (_esRetiroS && deps.window._alertaRetiroHtml)
          ? deps.window._alertaRetiroHtml(id, { monto: (_pp.hasProg ? _pp.restante : Number(s.MONTO_REAL || s.MONTO_DECLARADO || 0)) })
          : "";
        // ── CAMBIO DE CLAVE ──────────────────────────────────────────────────
        // No es una carga ni un retiro: no hay monto, no hay billetera, no hay "Tomar" ni
        // "Parcial". Lo único que el operador necesita es QUIÉN pidió, QUÉ clave, y un botón
        // para hacerlo. Todo lo demás en esta tarjeta sería ruido.
        // Normalmente ya se ejecutó sola (ver _claveAutoTick en automatizaciones.js): si llegó
        // hasta acá es porque el operador la bloqueó o porque la automática falló.
        if(String(s.TIPO||s.TIPO_SOLICITUD||"").toUpperCase()==="CAMBIO_CLAVE"){
          const _clave = s.PASSWORD_NUEVO || "12345a";
          const _bloq  = !!(deps.window._clavesBloqueadas && deps.window._clavesBloqueadas[String(id)]);
          return `<div class="v154p-card">
            <div>
              <div class="v154p-main">${deps.esc(s.USUARIO || "-")}</div>
              <div class="v154p-small">#${id} · ${deps.fecha(s.FECHA_CREACION)} · ${deps.esc(s.ORIGEN || "PORTAL")}</div>
              <div class="v154p-small" style="color:#c0cad8">pidió cambio de clave</div>
            </div>
            <div><span class="v154p-badge" style="background:#7c3aed22;color:#a78bfa;border:1px solid #7c3aed66">🔑 CLAVE</span></div>
            <div class="v154p-main" style="color:#a78bfa;font-family:ui-monospace,monospace">${deps.esc(_clave)}</div>
            <div><span class="v154p-badge">${_bloq ? "⏸ En pausa" : deps.esc(_estadoLegible(s.ESTADO))}</span></div>
            <div class="v154p-actions">
              <button class="v154p-btn green" onclick="ejecutarAutoClave(${id})">▶ Realizar</button>
            </div>
          </div>`;
        }
        // El jugador no refrescó el portal y transfirió a la billetera anterior. Tiene que
        // verse ACÁ, en la tarjeta, sin desplegar nada: es lo que decide a qué billetera
        // mirar antes de aprobar.
        const _bv = deps.window._billeteraVieja ? deps.window._billeteraVieja(s) : null;
        // ¿Ya está en la cola de carga? Se dice ACÁ y las acciones cambian. Antes la aprobabas,
        // la tarjeta quedaba EXACTAMENTE igual que antes, y se aprobaba de nuevo pensando que el
        // clic se había perdido. Lo único que tiene que cambiar al aceptar es cómo se presenta.
        const _cola = (deps.window._colaCargaEstado || {})[String(id)] || null;
        const _colaCorre = !!(_cola && _cola.estado === 'corriendo');
        const _colaCol = _colaCorre ? '#22c55e' : '#7cc4ff';
        const _borde = _cola
          ? ` style="border-color:${_colaCol};box-shadow:inset 3px 0 0 ${_colaCol}"`
          : (_bv ? ' style="border-color:#f59e0b;box-shadow:inset 3px 0 0 #f59e0b"' : '');
        // "Ya cargada" NO va en la tarjeta: ya tiene cinco botones y es un caso raro (124 en 30
        // días). Vive dentro del modal de rechazo, que es cuando el operador se da cuenta.
        const _acciones = _cola
          ? ((_colaCorre
                ? `<button class="v154p-btn" disabled style="opacity:.55;cursor:default">⚙ Cargando…</button>`
                : `<button class="v154p-btn" onclick="colaCargaQuitar('${_cola.cid}')" style="background:transparent;border:1px solid #7f1d1d;color:#fca5a5">Sacar de la cola</button>`)
             + `<button class="v154p-btn" onclick="v154pDetalleSolicitud(${id})">Ver</button>`)
          : ((tomada ? `<button class="v154p-btn yellow" disabled>Tomada</button>`
                     : `<button class="v154p-btn yellow" onclick="v154pTomarSolicitud(${id})">Tomar</button>`)
             + `<button class="v154p-btn green" onclick="v154pCrearJobSolicitud(${id})">Aprobar</button>`
             + (_esRet ? `<button class="v154p-btn blue" onclick="v154pRegistrarParcial(${id})">💸 Parcial</button>` : "")
             + `<button class="v154p-btn" onclick="v154pDetalleSolicitud(${id})">Ver</button>`
             + `<button class="v154p-btn red" onclick="v154pRechazarSolicitud(${id})">Rechazar</button>`);
        return `<div class="v154p-card" id="v154pCard${id}"${_borde}>
          <div>
            <div class="v154p-main">${deps.esc(s.USUARIO || "-")}</div>
            ${_bv ? `<div style="margin:3px 0;font-size:10.5px;font-weight:900;color:#fbbf24;background:rgba(245,158,11,.12);border:1px solid #f59e0b55;border-radius:6px;padding:2px 6px;display:inline-block">⚠ Transfirió a ${deps.esc(_bv.vieja)} · ahora ${deps.esc(_bv.actual)}</div>` : ""}

            <div class="v154p-small">#${id} · ${deps.fecha(s.FECHA_CREACION)} · ${deps.esc(s.ORIGEN || "PORTAL")}</div>
            ${s.TITULAR ? `<div class="v154p-small" style="color:#fde68a">Titular: ${deps.esc(s.TITULAR)}${(function(){
              // Si ese titular está bloqueado (ficha del jugador), que se vea ACÁ, que es donde
              // el operador decide. Informa: no deshabilita ni rechaza nada por su cuenta.
              try{
                const b = deps.window.titularBloqueado ? deps.window.titularBloqueado(s.USUARIO||'', s.TITULAR) : null;
                if(!b) return '';
                return ' <span title="'+deps.esc(b.motivo||'')+'" style="background:#7f1d1d;color:#fecaca;border-radius:999px;padding:1px 7px;font-size:9px;font-weight:900">🚫 '+(b.global?'BLOQUEADO · TODAS':'BLOQUEADO')+'</span>';
              }catch(_e){ return ''; }
            })()}</div>` : ""}
          </div>
          <div><span class="v154p-badge"${_accS?` style="background:${_accS}22;color:${_accS};border:1px solid ${_accS}66"`:``}>${deps.esc(s.TIPO || "-")}</span></div>
          <div class="v154p-main"${_accS?` style="color:${_accS}"`:``}>${_montoCell}${_saldoBadge}</div>
          <div>${_cola
            ? `<span class="v154p-badge" style="background:${_colaCorre?'rgba(34,197,94,.15)':'rgba(124,196,255,.12)'};color:${_colaCol};border:1px solid ${_colaCorre?'rgba(34,197,94,.35)':'rgba(124,196,255,.35)'}">${_colaCorre?'⚙ Cargando…':'🕒 '+_cola.pos+'º en la cola'}</span>`
            : `<span class="v154p-badge">${deps.esc(_estadoLegible(s.ESTADO))}</span>`}</div>
          <div class="v154p-actions">${_acciones}</div>
          ${_alertaHtml ? `<div style="grid-column:1/-1">${_alertaHtml}</div>` : ""}
        </div>`;
      }).join("");
    }

    // No repintar si el HTML no cambió: evita el parpadeo de intervalos/realtime.
    if(deps.V154P.solicitudesLastHtml !== html){
      box.innerHTML = html;
      deps.V154P.solicitudesLastHtml = html;
      deps.V154P.solicitudesLastRenderAt = Date.now();
    }
  }

  function renderSolicitudesPortalCompleto(){
    const box = deps.document.getElementById("tablaSolicitudesCompleta");
    if(!box) return;
    // ⛔ La tabla propia de solicitudes SE INTERPONÍA al Historial completo: cada poll del portal
    // re-pintaba este contenedor con la vista vieja (Titular + Ver) pisando la tabla unificada
    // (con multi-select + cambio de billetera en lote). Las PENDIENTES ya viven en el Inicio →
    // acá SIEMPRE delegamos en el historial unificado (portado de NexoBetaChan · "tal cual mi nodo").
    try{ if(typeof deps.renderHistorialUnificado === 'function'){ deps.renderHistorialUnificado(); return; } }catch(_e){}
    return;
  }


// Cartel de "esto está viejo". Vive FUERA de la tabla porque la tabla se repinta entera
// y se lo llevaría puesto. Se define acá arriba porque la primera carga puede fallar
// antes de que el render haya corrido una sola vez — y ese es justo el caso que importa.
api._v154pAvisoDesfasaje = function(motivo){
  const box = deps.document.getElementById("tablaSolicitudesInicio");
  if(!box || !box.parentNode) return;
  let av = deps.document.getElementById("v154pDesfasaje");
  if(!motivo){ if(av) av.remove(); return; }
  if(!av){
    av = deps.document.createElement("div");
    av.id = "v154pDesfasaje";
    av.style.cssText = "background:rgba(240,136,62,.12);border:1px solid #f0883e55;"
      + "border-radius:7px;padding:7px 10px;margin-bottom:8px;font-size:12.5px;color:#f0883e";
    box.parentNode.insertBefore(av, box);
  }
  const desde = (deps.window.V154P && (deps.V154P.solicitudesOkAt || deps.V154P.solicitudesLastRenderAt)) || 0;
  const min = desde ? Math.round((Date.now()-desde)/60000) : null;
  av.innerHTML = "⚠ <b>Esta lista está desactualizada</b>"
    + (min!=null ? " — última actualización hace "+(min<1?"menos de un minuto":(min+" min")) : "")
    + ". No la tomes como la foto de ahora. "
    + '<button class="mini-btn gray" style="margin-left:6px" onclick="cargarSolicitudesPortal(false)">Reintentar</button>';
};

    return { globals: api, renderSolicitudesPortalEnInicio, renderSolicitudesPortalCompleto };
  }
  return Object.freeze({ create, dependencies });
});
