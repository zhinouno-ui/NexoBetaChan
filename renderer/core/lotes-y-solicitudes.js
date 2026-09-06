let _loteEnCurso = false;

function abrirCambioBilleteraLote(){
  if(!window.chunior){ toast("Chunior no disponible", "red"); return; }
  if(_loteEnCurso){ toast("Ya hay un lote en proceso.", "red"); return; }
  const ids = Array.from(_seleccionLote);
  if(!ids.length){ toast("No hay movimientos seleccionados.", "red"); return; }
  const filas = ids.map(function(id){
    return (_historialData||[]).find(function(h){ return String(h.id)===String(id); });
  }).filter(function(h){ return h && h.chunior_movimiento_id; });
  if(!filas.length){
    abrirModal('💳 Cambio de billetera en lote',
      '<div class="alert-box">Ninguno de los seleccionados tiene N° de movimiento de Chunior.</div>',
      function(){ cerrarModal(); }, 'Entendido');
    return;
  }
  const bilsConUid = (billeteras||[]).filter(function(b){ return b.CHUNIOR_UID; });
  if(!bilsConUid.length){
    abrirModal('💳 Cambio de billetera en lote',
      '<div class="alert-box">No hay billeteras con UID de Chunior. Sincronizá billeteras primero.</div>',
      function(){ cerrarModal(); }, 'Entendido');
    return;
  }
  const opciones = bilsConUid.map(function(b){
    return '<option value="'+escapeHtml(String(b.ID_BILLETERA))+'">'+
           escapeHtml(b.NOMBRE_VISIBLE||'—')+' · '+money(b.SALDO||0)+'</option>';
  }).join('');
  abrirModal(
    '💳 Cambiar billetera · '+filas.length+' movimiento'+(filas.length!==1?'s':''),
    '<div style="color:#c0cad8;font-size:13px;margin-bottom:10px">Se re-asigna la billetera de <b>'+filas.length+'</b> movimiento(s) en Chunior, uno por uno. Espera a que no haya cargas en curso.</div>'+
    '<label style="color:#c0cad8;font-size:12px;font-weight:700">NUEVA BILLETERA (para todos)</label>'+
    '<select id="loteBilSel" style="margin-top:6px">'+opciones+'</select>',
    function(){
      const sel = document.getElementById("loteBilSel");
      const bilNueva = (billeteras||[]).find(function(b){ return String(b.ID_BILLETERA)===String(sel?.value); });
      if(!bilNueva || !bilNueva.CHUNIOR_UID){ toast("Seleccioná una billetera con UID de Chunior.", "red"); return; }
      cerrarModal();
      procesarColaCambioBilletera(filas, bilNueva);
    },
    'Iniciar cola en 2° plano'
  );
}

function _panelLote(){
  let p = document.getElementById("panelColaLote");
  if(!p){
    p = document.createElement("div");
    p.id = "panelColaLote";
    p.style.cssText = "position:fixed;right:16px;bottom:16px;z-index:9999;width:300px;background:#161b26;"+
      "border:1px solid #2e3a52;border-radius:12px;box-shadow:0 8px 30px rgba(0,0,0,.5);padding:12px;font-size:13px;color:#c0cad8";
    document.body.appendChild(p);
  }
  return p;
}
function _cerrarPanelLote(){ const p=document.getElementById("panelColaLote"); if(p) p.remove(); }

async function procesarColaCambioBilletera(filas, bilNueva){
  if(_loteEnCurso) return;
  _loteEnCurso = true;
  let ok = 0, fail = 0;
  const total = filas.length;
  const fallidos = [];
  const p = _panelLote();
  function pintar(i, estadoTxt){
    p.innerHTML =
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">'+
        '<b style="color:#c1b3ff">💳 Cambio de billetera</b>'+
        '<span class="small" style="color:var(--muted)">2° plano</span>'+
      '</div>'+
      '<div class="small" style="margin-bottom:6px">Procesando '+i+'/'+total+' · ✅ '+ok+' · ❌ '+fail+'</div>'+
      '<div style="height:8px;background:#0e1525;border-radius:6px;overflow:hidden">'+
        '<div style="height:100%;width:'+Math.round((i/total)*100)+'%;background:#7c3aed;transition:width .3s"></div>'+
      '</div>'+
      (estadoTxt?'<div class="small" style="margin-top:6px;color:var(--muted)">'+escapeHtml(estadoTxt)+'</div>':'');
  }
  pintar(0, "Iniciando...");
  toast('💳 Cola de cambio de billetera iniciada en 2° plano ('+total+' movimientos).', 'blue');
  for(let i=0; i<filas.length; i++){
    const h = filas[i];
    const tEspera = Date.now() + 30000;
    while(_watchdog && _watchdog.busy > 0 && Date.now() < tEspera){
      pintar(i, "⏳ Operación en curso, esperando...");
      await new Promise(function(r){ setTimeout(r, 800); });
    }
    _wdLock();
    pintar(i, "Mov. N° "+h.chunior_movimiento_id+" → "+bilNueva.NOMBRE_VISIBLE);
    try {
      const r = await _cambiarBilleteraChunior(h.chunior_movimiento_id, bilNueva.CHUNIOR_UID);
      if(r && r.ok){
        ok++;
        // La billetera anterior se guarda ANTES del update, que la pisa.
        const _bilAntesId     = h.billetera_id;
        const _bilAntesNombre = h.billetera_nombre;
        try {
          await supabaseClient.from("historial_ops")
            .update({ billetera_id: bilNueva.ID_BILLETERA, billetera_nombre: bilNueva.NOMBRE_VISIBLE })
            .eq("id", h.id);
        } catch(eUpd){ console.warn("update historial_ops lote:", eUpd); }
        await _asentarCambioBilletera({
          movId: h.chunior_movimiento_id,
          historialId: h.id,
          solicitudId: h.solicitud_id || null,
          monto: h.monto || 0,
          bilAnteriorId: _bilAntesId,
          bilAnteriorNombre: _bilAntesNombre,
          bilNuevaId: bilNueva.ID_BILLETERA,
          bilNuevaNombre: bilNueva.NOMBRE_VISIBLE,
          origen: 'MANUAL_LOTE'
        });
        h.billetera_id = bilNueva.ID_BILLETERA;
        h.billetera_nombre = bilNueva.NOMBRE_VISIBLE;
      } else {
        fail++; fallidos.push({ mov:h.chunior_movimiento_id, err:(r&&r.error)||'sin detalle' });
      }
    } catch(e){
      fail++; fallidos.push({ mov:h.chunior_movimiento_id, err:e.message||'excepción' });
    } finally { _wdUnlock(); }
    pintar(i+1, null);
    await new Promise(function(r){ setTimeout(r, 500); });
  }
  _loteEnCurso = false;
  _seleccionLote.clear();
  p.innerHTML =
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">'+
      '<b style="color:'+(fail===0?'#7ee07e':'#ffb86b')+'">'+(fail===0?'✅ Lote terminado':'⚠️ Lote con errores')+'</b>'+
      '<button class="mini-btn gray" style="font-size:10px" onclick="_cerrarPanelLote()">✕</button>'+
    '</div>'+
    '<div class="small">'+ok+' cambiada(s)'+(fail?', '+fail+' con error':'')+'.</div>'+
    (fallidos.length?'<div class="small" style="margin-top:6px;color:var(--muted);max-height:80px;overflow:auto">Fallaron: '+
      fallidos.map(function(f){ return 'N°'+escapeHtml(String(f.mov))+' ('+escapeHtml(String(f.err))+')'; }).join(', ')+'</div>':'');
  toast(fail===0?('✅ '+ok+' billetera(s) cambiada(s)'):('⚠️ '+ok+' ok · '+fail+' con error'), fail===0?'green':'red');
  actualizarBarraLote();
  await cargarHistorial();
}

function renderSolicitudes(){
  if(window.V154P && Array.isArray(window.V154P.solicitudes) && window.V154P.solicitudes.length && typeof window.v154pRenderSolicitudesPortalCompleto === "function"){
    window.v154pRenderSolicitudesPortalCompleto();
    return;
  }
  renderHistorialUnificado();
}
function tablaSolicitudesHTML(lista){
  if(!lista.length)return`<div class="alert-box">No hay solicitudes para mostrar.</div>`;
  let html=`<div class="table-wrap"><table><thead><tr><th>Fecha</th><th>Tipo</th><th>Usuario</th><th>Billetera</th><th>Monto</th><th>Estado</th><th>Acción</th></tr></thead><tbody>`;
  lista.forEach(s=>{
    const id=s.ID||s.SOLICITUD_ID||s.ID_SOLICITUD||"";
    const tipo=normalizar(s.TIPO_SOLICITUD||s.TIPO);
    html+=`<tr>
      <td>${formatFecha(s.FECHA_CREACION||s.FECHA)}</td>
      <td>${tipo}</td>
      <td><b>${s.USUARIO||s.USUARIO_JUGADOR||"-"}</b><br><span class="small">${s.NOMBRE_COMPLETO||""}</span><br>${scoreBadge(s.USUARIO||s.USUARIO_JUGADOR||"")}</td>
      <td>${s.BILLETERA_NOMBRE||s.NOMBRE_BILLETERA||s.ID_BILLETERA||"-"}</td>
      <td>${money(s.MONTO_REAL||s.MONTO_DECLARADO||s.MONTO||0)}</td>
      <td>${estadoBadge(s.ESTADO)}</td>
      <td>
        ${esPendiente(s)?
          tipo==="CAMBIO_CLAVE"
            ? `${window.ctrlElectron?`<button class="mini-btn purple" onclick="ejecutarAutoClave('${id}')">▶ Auto</button>`:""}
               <button class="mini-btn red" onclick="abrirRechazarSolicitud('${id}')">Rechazar</button>`
            : `<button class="mini-btn blue" onclick="tomarSolicitud('${id}')">Tomar</button>
               ${tipo==="RETIRO"
                  ? `${window.ctrlElectron?`<button class="mini-btn purple" onclick="ejecutarAutoRetiro('${id}')">▶ Auto</button>`:""}
                     <button class="mini-btn green" onclick="abrirCerrarRetiro('${id}')">Cerrar retiro</button>`
                  : `${window.ctrlElectron?`<button class="mini-btn purple" onclick="ejecutarAutoCarga('${id}')">▶ Auto</button>`:""}
                     <button class="mini-btn green" onclick="abrirAprobarSolicitud('${id}')">Cargar</button>`}
               <button class="mini-btn red" onclick="abrirRechazarSolicitud('${id}')">Rechazar</button>`
          :normalizar(s.ESTADO)==="APROBADA_MANUAL"&&tipo==="CARGA"&&window.ctrlElectron?`
            <button class="mini-btn purple" onclick="ejecutarAutoCarga('${id}')">▶ Auto</button>
          `:"-"}
      </td>
    </tr>`;
  });
  html+=`</tbody></table></div>`;
  return html;
}

function getBilleraLanding(){
  const lista = (billeteras||[]).filter(function(b){
    return normalizar(b.ACTIVA)==="SI" && normalizar(b.ESTADO||"ACTIVA") !== "FUSIONADA";
  });
  return lista.find(b=>normalizar(b.SELECCIONADA_MANUAL)==="SI") || lista[0];
}

// Verifica la configuración del "EN PORTAL" sin tener que abrir la landing del jugador.
// Devuelve {ok, tipo:'ok'|'warn'|'err', mensaje, billetera}.
function verificarConfigLanding(){
  if(!billeteras || !billeteras.length){
    return { ok:false, tipo:'warn', mensaje:'No hay billeteras configuradas para esta oficina.' };
  }
  const enLanding = billeteras.filter(b => normalizar(b.SELECCIONADA_MANUAL)==='SI');

  if(enLanding.length === 0){
    return { ok:false, tipo:'warn', mensaje:'⚠️ Ninguna billetera marcada como EN PORTAL. El jugador no ve a dónde transferir.' };
  }
  if(enLanding.length > 1){
    const nombres = enLanding.map(b => b.NOMBRE_VISIBLE || '?').join(', ');
    return { ok:false, tipo:'err', mensaje:'❌ Hay '+enLanding.length+' billeteras marcadas como EN PORTAL (debe ser solo 1): '+nombres };
  }

  const b = enLanding[0];

  if(normalizar(b.ACTIVA) !== 'SI'){
    return { ok:false, tipo:'err', mensaje:'❌ La billetera EN PORTAL ('+(b.NOMBRE_VISIBLE||'?')+') está PAUSADA. El jugador no puede usarla.', billetera:b };
  }

  // Campos mínimos que la landing necesita mostrar al jugador
  const faltantes = [];
  if(!b.NOMBRE_VISIBLE) faltantes.push('Nombre');
  if(!b.CBU_ALIAS)      faltantes.push('CBU/Alias');
  if(!b.TITULAR)        faltantes.push('Titular');
  if(!b.TIPO)           faltantes.push('Tipo');
  if(faltantes.length){
    return { ok:false, tipo:'warn', mensaje:'⚠️ La billetera EN PORTAL ('+escapeHtml(b.NOMBRE_VISIBLE||'?')+') no tiene completos: <b>'+faltantes.join(', ')+'</b>. La landing va a mostrar incompleto.', billetera:b };
  }

  return {
    ok: true,
    tipo: 'ok',
    mensaje: '✅ Landing OK · <b>'+escapeHtml(b.NOMBRE_VISIBLE)+'</b> ('+escapeHtml(b.TIPO)+') · Titular: '+escapeHtml(b.TITULAR)+' · CBU/Alias: <code style="background:#0c1018;padding:2px 6px;border-radius:4px">'+escapeHtml(b.CBU_ALIAS)+'</code>',
    billetera: b
  };
}

function renderEstadoLanding(){
  const r = verificarConfigLanding();
  const claseBox = r.tipo === 'ok' ? 'ok-box' : (r.tipo === 'err' ? 'err-box' : 'alert-box');

  // Vista billeteras: cartel completo arriba del grid
  const elFull = document.getElementById("estadoLanding");
  if(elFull){
    elFull.innerHTML = '<div class="'+claseBox+'" style="margin-top:8px;padding:12px;font-size:13px;line-height:1.4">'+r.mensaje+'</div>';
  }

  // Inicio: indicador compacto arriba de las billeteras
  const elMini = document.getElementById("estadoLandingInicio");
  if(elMini){
    // Versión corta para el inicio
    let mensajeCorto = r.mensaje;
    if(r.tipo === 'ok' && r.billetera){
      mensajeCorto = '✅ Landing OK · <b>'+escapeHtml(r.billetera.NOMBRE_VISIBLE)+'</b>';
    }
    elMini.innerHTML = '<div class="'+claseBox+'" style="margin-bottom:10px;padding:8px 12px;font-size:12px;line-height:1.3">'+mensajeCorto+'</div>';
  }
}

async function ajustarSaldoBilletera(id, delta){
  // ── CONTADOR INTERNO DE BILLETERAS DESACTIVADO ──────────────────────────────────────────────
  // Chunior es la FUENTE DE VERDAD del saldo: se refleja al sincronizar billeteras
  // (sincronizarBilleterasChunior). Antes el panel llevaba su propio contador paralelo (RPC
  // panel_billetera_ajustar_saldo + b.SALDO local) que se desincronizaba de Chunior. Se deja
  // INERTE (no-op): los ~15 callers siguen invocando pero ya no ajustan nada.
  return;
}

function renderBilleteras(){
  // Crear/editar billeteras (CBU/alias/titular/tipo) se hace SOLO en el admi (encargados).
  // El operativo solo ve, transfiere, elige "en portal" y pausa.
  let html=``;
  if(!billeteras.length){html+=`<div class="alert-box">No hay billeteras configuradas para esta oficina. Se crean al sincronizar con Chunior; los datos los completa el encargado en el panel administrativo.</div>`;setBox("walletsGrid",html);renderEstadoLanding();return}
  billeteras.forEach(b=>{
    const activa=normalizar(b.ACTIVA)==="SI";
    const seleccionada=normalizar(b.SELECCIONADA_MANUAL)==="SI";
    html+=`<div class="wallet-card ${activa?"ok":"paused"} ${seleccionada?"selected":""}">
      <div class="wallet-name">💳 ${b.NOMBRE_VISIBLE||b.ID_BILLETERA}</div>
      <div class="wallet-type">${b.TIPO||""} · ${b.PC||pcOperativa}</div>
      ${b.CBU_ALIAS?`<div class="small" style="margin-top:4px;color:var(--muted);font-family:monospace">${b.CBU_ALIAS}</div>`:""}
      ${b.TITULAR?`<div class="small" style="color:var(--muted)">${b.TITULAR}</div>`:""}
      <div style="margin-top:10px;font-size:22px;font-weight:900">${money(b.SALDO||0)}</div>
      <div style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap">
        ${activa?'<span class="badge badge-ok">ACTIVA</span>':'<span class="badge badge-danger">PAUSADA</span>'}
        ${seleccionada?'<span class="badge badge-blue">EN PORTAL</span>':''}
      </div>
      <div class="wallet-actions">
        <button class="mini-btn blue" onclick="seleccionarBilleteraSeguro('${b.ID_BILLETERA}','${b.CHUNIOR_UID||''}')">En portal</button>
        ${activa
          ?`<button class="mini-btn red" onclick="cambiarEstadoBilletera('${b.ID_BILLETERA}','NO')">Pausar</button>`
          :`<button class="mini-btn green" onclick="cambiarEstadoBilletera('${b.ID_BILLETERA}','SI')">Activar</button>`}
      </div>
    </div>`;
  });
  setBox("walletsGrid",html);
  renderEstadoLanding();
}

function abrirEditarBilletera(id){
  const b=billeteras.find(x=>String(x.ID_BILLETERA)===String(id));
  if(!b) return;
  abrirModal("Editar billetera",`
    <label>Nombre / Titular</label>
    <input id="ebNombre" value="${escapeHtml(b.NOMBRE_VISIBLE||"")}" placeholder="Ej: Juan García">
    <label>CBU / CVU / Alias</label>
    <input id="ebCbu" value="${escapeHtml(b.CBU_ALIAS||"")}" placeholder="Ej: 0000003100...">
    <label>Tipo (MP, Ualá, NJX, PP, transferencia…)</label>
    <input id="ebTipo" value="${escapeHtml((b.BANCO&&!/chunior|^p\d|general/i.test(b.BANCO))?b.BANCO:(typeof detectarTipoBilletera==='function'?detectarTipoBilletera(b):''))}" placeholder="Ej: MercadoPago">
    <label>Saldo actual (ajuste manual)</label>
    <input id="ebSaldo" type="number" value="${b.SALDO||0}">
  `,async()=>{
    const {error}=await supabaseClient.rpc("panel_billetera_update",{p_secret:window.PANEL_DATA_SECRET,p_id:Number(id),p_patch:{
      nombre_visible:val("ebNombre"),
      cbu_alias:val("ebCbu"),
      titular:val("ebNombre"),
      banco:val("ebTipo"),
      saldo:Number(val("ebSaldo")||0)
    }});
    if(error){alert(error.message);return}
    cerrarModal();
    toast("Billetera actualizada","green");
    await cargarBilleteras();
  },"Guardar");
}

function abrirNuevaBilletera(){
  abrirModal("Nueva billetera",`
    <label>Nombre / Titular</label>
    <input id="nbNombre" placeholder="Ej: Juan García">
    <label>CBU / CVU / Alias</label>
    <input id="nbCbu" placeholder="Ej: 0000003100...">
    <label>Tipo (MP, Ualá, NJX, PP, transferencia…)</label>
    <input id="nbTipo" placeholder="Ej: MercadoPago">
    <label>Saldo inicial</label>
    <input id="nbSaldo" type="number" value="0">
  `,async()=>{
    const nombre=val("nbNombre");
    if(!nombre){alert("El nombre es obligatorio.");return}
    const {error}=await supabaseClient.rpc("panel_billetera_insert",{p_secret:window.PANEL_DATA_SECRET,p_patch:{
      nombre_visible:nombre,
      cbu_alias:val("nbCbu"),
      titular:nombre,
      banco:val("nbTipo"),
      saldo:Number(val("nbSaldo")||0),
      pc_codigo:pcOperativa,
      activa:true,
      seleccionada_manual:false
    }});
    if(error){alert(error.message);return}
    cerrarModal();
    toast("Billetera creada","green");
    await cargarBilleteras();
  },"Crear");
}

async function tomarSolicitud(id){
  const r = await actualizarSolicitudSupabase(id, {
    operador_usuario: operador.usuario || operador.nombre || "",
    estado: "PENDIENTE"
  });

  if(!r.ok){
    alert(r.error || "Error");
    return;
  }

  toast("Solicitud tomada","green");
  await refrescarTodo(false);
}
function abrirAprobarSolicitud(id){
  const s = solicitudes.find(x=>String(x.ID||x.SOLICITUD_ID)===String(id));
  if(!s) return;

  const tieneElectron = !!window.ctrlElectron;
  abrirModal("Aprobar carga",`
    <div class="ok-box"><b>${escapeHtml(s.USUARIO||"")}</b> · ${money(s.MONTO_DECLARADO||s.MONTO_REAL||0)}</div>
    <label>Monto real confirmado</label>
    <input id="apMonto" type="number" value="${s.MONTO_REAL||s.MONTO_DECLARADO||""}">
    <label>Observaciones (opcional, se envían al usuario)</label>
    <textarea id="apObs" placeholder="Ej: tu transferencia llegó correctamente"></textarea>
    ${tieneElectron?'<div class="alert-box" style="margin-top:8px;font-size:12px">⚡ Se ejecutará automáticamente en el casino al confirmar.</div>':'<div class="alert-box" style="margin-top:8px;font-size:12px">⚠️ Sin automatización disponible: se registrará como aprobada pendiente de ejecución manual.</div>'}
  `,async()=>{
    const montoFinal = Number(val("apMonto") || s.MONTO_DECLARADO || 0);
    const obs = val("apObs");
    const usuario = s.USUARIO || s.USUARIO_JUGADOR || "";

    // 1. Registrar monto real confirmado por el operador
    const rAprobada = await actualizarSolicitudSupabase(id, {
      estado: "APROBADA_MANUAL",
      monto: montoFinal,
      operador_usuario: operador.usuario || operador.nombre || ""
    });
    if(!rAprobada.ok){ alert(rAprobada.error || "Error al aprobar"); return; }

    cerrarModal();

    // 2. Si hay Electron disponible: ejecutar en el casino y marcar ACREDITADA para que el portal lo reciba
    if(tieneElectron && usuario && montoFinal > 0){
      toast("Aprobada · ejecutando carga en backoffice...","blue");
      try{
        if(!await ensureDrexSession()){ toast("Sesión de backoffice requerida.","red"); await refrescarTodo(false); return; }

        _wdLock();
        let busqueda;
        try{
          busqueda = await callDrex("buscarUsuario", usuario, {skipBalance:true});
        }finally{ _wdUnlock(); }

        if(!busqueda || !busqueda.exists){
          await actualizarSolicitudPortal(id, "ERROR_OPERATIVO", {etapa:"USUARIO_NO_ENCONTRADO_POST_APROBADA", monto_aprobado:montoFinal});
          await notificarUsuarioEnChat(usuario, `❌ Tu carga de $${montoFinal.toLocaleString("es-AR")} no pudo procesarse: el usuario "${escapeHtml(usuario)}" no se encontró en el casino. Contactanos para resolverlo.`);
          toast(`Usuario "${usuario}" no encontrado · quedó en APROBADA_MANUAL para revisión`,"red");
          await refrescarTodo(false);
          return;
        }

        _wdLock();
        let resultado;
        try{
          resultado = await callDrex("cargarSaldo", montoFinal);
        }catch(e){
          resultado = {ok:false, message: e.message || "Error en Agentes"};
        }finally{ _wdUnlock(); }

        if(!resultado.ok && resultado.ok !== undefined){
          // Error técnico: queda en APROBADA_MANUAL para que operador use ▶ Auto
          await notificarUsuarioEnChat(usuario, `⚠️ Tu carga de $${montoFinal.toLocaleString("es-AR")} fue aprobada pero hubo un error técnico al ejecutarla. Ya lo estamos revisando.${obs?`\n📝 ${obs}`:""}`);
          toast("Error al ejecutar carga · quedó como APROBADA_MANUAL · usar ▶ Auto para reintentar","red");
          await refrescarTodo(false);
          return;
        }

        // ── CONFIRMACIÓN de la carga del PORTAL (mismo criterio simple que la carga manual) ──
        // Confiamos en que el script corrió (sin re-leer saldo: eso demoraba y disparaba 403).
        // Solo frenamos ante un RECHAZO CLARO del casino (modal apareció y dijo que NO).
        const _saldoPreCasinoAp = (typeof resultado?.previousBalance?.value === 'number' && !resultado?.previousBalance?.unchanged) ? resultado.previousBalance.value : null;
        const _saldoPostLeidoAp = (typeof resultado?.newBalance?.value === 'number' && !resultado?.newBalance?.unchanged) ? resultado.newBalance.value : null;
        const _rechazoCasinoAp = resultado && resultado.exito === false; // modal apareció y NO confirmó → rechazo CLARO
        const _confirmadaAp = !_rechazoCasinoAp;
        // saldo_post para el historial: el LEÍDO si lo hay; si no, estimado pre+monto. saldo_pre: el real del modal.
        // NO re-derivar pre desde post (post-monto): un post "0" puede ser una lectura espuria
        // transitoria (PC lenta) y da un pre NEGATIVO falso. Sin dato confiable → null (se ve "—").
        const _saldoPostAp = _saldoPostLeidoAp !== null ? _saldoPostLeidoAp : (_saldoPreCasinoAp !== null ? _saldoPreCasinoAp + montoFinal : null);
        const _saldoPreAp = _saldoPreCasinoAp;
        const _bilLandingAp = getBilleraLanding();
        if(!_confirmadaAp){
          await registrarEnHistorial({
            usuario, tipo:'CARGA', monto:montoFinal, origen:'PANEL', estado:'ERROR',
            notas:(obs?obs+' · ':'')+'El casino NO confirmó "Operación correcta" (rechazo) · NO acreditada', solicitud_id:id,
            billetera_id: s.ID_BILLETERA || (_bilLandingAp ? _bilLandingAp.ID_BILLETERA : null),
            billetera_nombre: s.BILLETERA_NOMBRE || (_bilLandingAp ? _bilLandingAp.NOMBRE_VISIBLE : null),
            saldo_pre: _saldoPreAp, saldo_post: _saldoPostAp
          });
          await notificarUsuarioEnChat(usuario, `⚠️ Tu carga de $${montoFinal.toLocaleString("es-AR")} fue rechazada por el casino. Ya lo estamos revisando.${obs?`\n📝 ${obs}`:""}`);
          toast('❌ Carga del portal RECHAZADA por el casino · queda APROBADA_MANUAL · usá ▶ Auto','red');
          await refrescarTodo(false);
          return;
        }
        await registrarEnHistorial({
          usuario, tipo:'CARGA', monto:montoFinal, origen:'PANEL', estado:'OK',
          notas:obs||null, solicitud_id:id,
          billetera_id: s.ID_BILLETERA || (_bilLandingAp ? _bilLandingAp.ID_BILLETERA : null),
          billetera_nombre: s.BILLETERA_NOMBRE || (_bilLandingAp ? _bilLandingAp.NOMBRE_VISIBLE : null),
          saldo_pre: _saldoPreAp, saldo_post: _saldoPostAp
        });

        // Actualizar estado en solicitudes → el portal detecta ACREDITADA en su próximo poll
        await actualizarSolicitudSupabase(id, { estado: "ACREDITADA" });

        // RPC del portal (enriquece metadata y recarga en panel); no bloquea si falla
        try{
          const apFn = typeof actualizarSolicitudPortal === "function"
            ? actualizarSolicitudPortal
            : (typeof window.actualizarSolicitudPortal === "function" ? window.actualizarSolicitudPortal : null);
          if(apFn) await apFn(id, "ACREDITADA", {etapa:"PANEL_APROBADA_EJECUTADA", monto_aprobado:montoFinal, obs:obs||null});
        }catch(_eAP){ console.warn("actualizarSolicitudPortal:", _eAP); }

        const bilLanding = getBilleraLanding();
        if(bilLanding) await ajustarSaldoBilletera(bilLanding.ID_BILLETERA, montoFinal);

        await notificarUsuarioEnChat(usuario, `✅ Tu carga de $${montoFinal.toLocaleString("es-AR")} fue acreditada. ¡Ya podés jugar!${obs?`\n📝 ${obs}`:""}`);
        toast(`Carga aprobada y acreditada · ${usuario} · ${money(montoFinal)}`, "green");

        try{ await window.ctrlElectron.navigateAgent(); }catch(_e){}
        renderBillerasInicio();
        poblarManualBilletera();

      }catch(e){
        toast("Error inesperado al aprobar: "+(e.message||"")+" · La solicitud quedó en APROBADA_MANUAL", "red");
      }finally{
        await refrescarTodo(false);
      }

    } else {
      // Sin Electron: solo registra la aprobación manual y notifica al usuario
      if(usuario){
        await notificarUsuarioEnChat(usuario,
          `✅ Tu carga de $${montoFinal.toLocaleString("es-AR")} fue aprobada. Estamos procesándola en el sistema de juego.${obs?`\n📝 ${obs}`:""}`);
      }
      toast("Carga aprobada (pendiente de ejecución manual)", "green");
      await registrarEnHistorial({usuario, tipo:'CARGA', monto:montoFinal, origen:'PANEL', estado:'OK', notas:obs||null, solicitud_id:id});
      await refrescarTodo(false);
    }
  },"Cargar");
}
async function abrirCerrarRetiro(id){
  const s = solicitudes.find(x=>String(x.ID||x.SOLICITUD_ID)===String(id));

  if(!s) return;

  const usuario = s.USUARIO || s.USUARIO_JUGADOR || "";
  if(usuario){
    const check = await verificarRetiro24h(usuario);
    if(check.bloqueado){
      const proceder = await confirmarRetiroDuplicado(check);
      if(!proceder) return;
    }
  }

  await cargarBilleteras(false);
  const montoSol = Number(s.MONTO_REAL||s.MONTO_DECLARADO||0);
  const bilOpts = billeteras.map(b=>{
    const saldoOk = Number(b.SALDO||0) >= montoSol;
    const sel = normalizar(b.SELECCIONADA_MANUAL)==="SI" ? " selected" : "";
    return `<option value="${b.ID_BILLETERA}"${sel}>${b.NOMBRE_VISIBLE} — ${money(b.SALDO||0)}${saldoOk?"":" ⚠️"}</option>`;
  }).join("");

  abrirModal("Cerrar retiro",`
    <div class="ok-box"><b>${s.USUARIO||""}</b> · ${money(montoSol)}</div>
    <label>Billetera desde donde se paga</label>
    <select id="retBilletera"${!bilOpts?' disabled':''}>
      ${bilOpts||'<option value="">Sin billeteras</option>'}
    </select>
    <div id="retSaldoInfo" class="small" style="margin-top:-8px;margin-bottom:12px"></div>
    <label>Monto final</label>
    <input id="retMonto" type="number" value="${montoSol||""}">
    <label>Observaciones (opcional, se envían al usuario)</label>
    <textarea id="retObs" placeholder="Ej: transferimos a tu CBU/CVU"></textarea>
  `,async()=>{
    const montoFinal = Number(val("retMonto") || s.MONTO_DECLARADO || 0);
    const obs = val("retObs");
    const bilId = val("retBilletera");

    const r = await actualizarSolicitudSupabase(id, {
      estado:"PAGADA",
      monto: montoFinal,
      operador_usuario:operador.usuario || operador.nombre || "",
      billetera_id: bilId || null
    });

    if(!r.ok){ alert(r.error || "Error"); return; }

    if(bilId) await ajustarSaldoBilletera(bilId, -montoFinal);

    const usuario = s.USUARIO || s.USUARIO_JUGADOR || "";
    if(usuario){
      await notificarUsuarioEnChat(usuario,
        `✅ Tu retiro de $${montoFinal.toLocaleString("es-AR")} fue pagado.${obs?`\n📝 ${obs}`:""}`);
    }

    cerrarModal();
    toast("Retiro cerrado","green");
    const bilObjR = billeteras.find(function(b){ return String(b.ID_BILLETERA)===String(bilId); }) || {};
    let movChuniorP = null;
    if(bilObjR.CHUNIOR_UID && usuario){
      try {
        const rChu = await registrarRetiroEnChunior(bilObjR.CHUNIOR_UID, montoFinal, usuario);
        if(rChu.ok && rChu.movimientoId) movChuniorP = rChu.movimientoId;
        else if(rChu.error) toast('⚠️ Retiro OK pero falló en Chunior: '+rChu.error, 'red');
      } catch(e){ toast('⚠️ Error en Chunior: '+(e.message||''), 'red'); }
    }
    await registrarEnHistorial({usuario, tipo:'RETIRO', monto:montoFinal, billetera_id:bilId||null, billetera_nombre:bilObjR.NOMBRE_VISIBLE||null, origen:'PANEL', estado:'OK', notas:obs||null, solicitud_id:id, chunior_movimiento_id:movChuniorP});
    // Comparamos fichas solo si Chunior confirmó
    if(movChuniorP) _watchdogTrigger(1500);
    await refrescarTodo(false);
  },"Pagar retiro");

  // actualiza el indicador de saldo al cambiar billetera o monto
  setTimeout(()=>{
    const sel  = document.getElementById("retBilletera");
    const info = document.getElementById("retSaldoInfo");
    const montoInput = document.getElementById("retMonto");
    const update = ()=>{
      if(!sel||!info) return;
      const b = billeteras.find(x=>String(x.ID_BILLETERA)===String(sel.value));
      const saldo  = b ? Number(b.SALDO||0) : 0;
      const monto  = Number(montoInput?.value||montoSol||0);
      const ok     = saldo >= monto;
      info.textContent = b ? `Saldo disponible: ${money(saldo)} ${ok?"✅":"⚠️ insuficiente"}` : "";
      info.style.color = ok ? "var(--green)" : "var(--red)";
    };
    sel?.addEventListener("change", update);
    montoInput?.addEventListener("input", update);
    update();
  }, 80);
}
function abrirRechazarSolicitud(id){
  const s = solicitudes.find(x=>String(x.ID||x.SOLICITUD_ID)===String(id));

  abrirModal("Rechazar solicitud",`
    <label>Motivo (se le envía al usuario)</label>
    <textarea id="rechObs" placeholder="Ej: no nos llegó tu transferencia / comprobante repetido"></textarea>
  `,async()=>{
    const motivo = val("rechObs") || "Rechazada por el operador";

    const r = await actualizarSolicitudSupabase(id, {
      estado:"RECHAZADA",
      operador_usuario:operador.usuario || operador.nombre || ""
    });

    if(!r.ok){ alert(r.error || "Error"); return; }

    const usuario = s?.USUARIO || s?.USUARIO_JUGADOR || "";
    const tipoEs = s ? normalizar(s.TIPO_SOLICITUD||s.TIPO) : "";
    if(usuario){
      const accion = tipoEs==="RETIRO"?"retiro":tipoEs==="CARGA"?"carga":tipoEs==="CAMBIO_CLAVE"?"cambio de clave":"solicitud";
      await notificarUsuarioEnChat(usuario, `❌ Tu ${accion} fue rechazada.\n📝 Motivo: ${motivo}`);
    }

    cerrarModal();
    toast("Solicitud rechazada","red");
    await refrescarTodo(false);
  },"Rechazar");
}

async function seleccionarBilletera(id){
  // SAFE: el rail puede mostrar billeteras detectadas desde Chunior con id sintético "CH_1170".
  // Para marcarla en PORTAL/LANDING primero resolvemos el id real de Supabase por chunior_uid.
  const rawId = String(id || '').trim();
  const local = (billeteras || []).find(x =>
    String(x.ID_BILLETERA) === rawId ||
    String(x.CHUNIOR_UID || '') === rawId.replace(/^CH_/i,'')
  );

  let realId = rawId;
  let uid = '';
  if(/^CH_/i.test(rawId)) uid = rawId.replace(/^CH_/i,'');
  if(!uid && local && local.CHUNIOR_UID) uid = String(local.CHUNIOR_UID);

  // Si el id no es numérico, buscar billetera real por UID en Supabase.
  if(!/^\d+$/.test(String(realId))){
    if(!uid){
      alert('No pude identificar el UID real de esta billetera. Sincronizá nuevamente.');
      return;
    }
    const {data, error} = await supabaseClient
      .from('billeteras')
      // SAFE: no pedimos oficina_id por REST porque en algunas instalaciones PostgREST
      // todavía no refrescó esa columna y rompe con "column billeteras.oficina_id does not exist".
      .select('id,nombre_visible,chunior_uid,pc_codigo,activa')
      .eq('chunior_uid', uid)
      .eq('activa', true)
      .order('seleccionada_manual',{ascending:false})
      .limit(1);
    if(error){ alert(error.message || 'Error buscando billetera real'); return; }
    if(!data || !data.length){
      alert('Esta billetera viene de Chunior pero todavía no tiene registro real activo en NODO. Revisá la sincronización.');
      return;
    }
    realId = String(data[0].id);
  }

  // Reset seguro sin oficina_id: limpiamos por TODOS los alias de la oficina actual (pcAliasesHist,
  // el mismo mecanismo que ya usa el resto del panel para agrupar nombres viejos/nuevos de una
  // misma oficina, ej. P1 = P1/PC1/XGENERALENUSO/XGENERAL/GENERAL/OFI_1) + por IDs visibles en
  // pantalla. Antes tenía además un reset hardcodeado a pc_codigo='P1' fijo que se ejecutaba
  // SIEMPRE sin importar qué oficina operara — cualquier oficina que pusiera SU billetera en
  // portal le apagaba de paso el "EN PORTAL" de P1. Sacado: debe ser solo la oficina actual (con
  // sus alias), para que valga igual para todas, existentes y futuras.
  if(pcOperativa){
    try{
      const _aliasesReset = (typeof pcAliasesHist === 'function') ? pcAliasesHist() : [pcOperativa];
      await supabaseClient.from('billeteras').update({seleccionada_manual:false}).in('pc_codigo', _aliasesReset);
    }catch(_e){}
  }
  try{
    const idsVisibles = (billeteras||[])
      .map(x=>String(x.ID_BILLETERA||x.id||''))
      .filter(x=>/^\d+$/.test(x));
    if(idsVisibles.length){
      await supabaseClient.from('billeteras').update({seleccionada_manual:false}).in('id', idsVisibles);
    }
  }catch(_e){}

  const {error}=await supabaseClient
    .from('billeteras')
    .update({seleccionada_manual:true, activa:true})
    .eq('id', realId);

  if(error){alert(error.message||'Error');return}
  toast('Billetera puesta en portal','green');
  await cargarBilleteras();
  try{ await refrescarTodo(false); }catch(_e){}
}

async function cambiarEstadoBilletera(id,estado){
  const {error}=await supabaseClient.rpc("panel_billetera_update",{p_secret:window.PANEL_DATA_SECRET,p_id:Number(id),p_patch:{activa:estado==="SI"}});
  if(error){alert(error.message||"Error");return}
  await cargarBilleteras();
}

