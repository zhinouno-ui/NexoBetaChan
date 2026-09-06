const _HIST_FULL_MAX = 5000;
function _histFullKey(){ return "nodo_historial_full_"+(pcOperativa||"sin_pc"); }
function _archivoHistorialCargar(){
  try{ const raw = localStorage.getItem(_histFullKey()); const o = raw?JSON.parse(raw):null; return (o && Array.isArray(o.rows)) ? o.rows : []; }
  catch(_e){ return []; }
}
function _archivoHistorialGuardar(rows){
  try{ localStorage.setItem(_histFullKey(), JSON.stringify({ ts:Date.now(), rows: rows.slice(0, _HIST_FULL_MAX) })); }
  catch(_e){
    try{ localStorage.setItem(_histFullKey(), JSON.stringify({ ts:Date.now(), rows: rows.slice(0, Math.floor(_HIST_FULL_MAX/2)) })); }catch(_e2){}
  }
}
function _movStoreToHistRows(){
  try{
    if(typeof _movStoreAll !== 'function') return [];
    const map = _movStoreAll();
    return Object.keys(map).map(function(k){
      const m = map[k] || {};
      return {
        id: (m.id!=null ? m.id : ('mov_'+k)),
        usuario: m.usuario||'', tipo: m.tipo||'', monto: m.monto!=null?m.monto:0,
        billetera_id: null, billetera_nombre: m.billeteraNombre||null,
        origen: m.origen||'MANUAL', estado: m.estado||'OK',
        notas: m.notas||null, chunior_movimiento_id: m.chuniorId||null,
        saldo_pre: (m.saldoPre!=null?m.saldoPre:null), saldo_post: (m.saldoPost!=null?m.saldoPost:null),
        operador: m.operador||null, solicitud_id: m.solicitudId||null,
        created_at: m._fecha || (m._ts?new Date(m._ts).toISOString():null)
      };
    }).filter(function(r){ return r.usuario || r.monto; });
  }catch(_e){ return []; }
}
function _archivoHistorialMerge(nuevas){
  const map = {};
  _archivoHistorialCargar().forEach(function(r){ if(r && r.id!=null) map[String(r.id)] = r; });
  (nuevas||[]).forEach(function(r){ if(r && r.id!=null) map[String(r.id)] = r; });
  const arr = Object.values(map).sort(function(a,b){ return new Date(b.created_at||0)-new Date(a.created_at||0); });
  _archivoHistorialGuardar(arr);
  return arr;
}
// Resumen compacto del árbol de un usuario (para embeber en el modal de retiro parcial):
// totales + últimas operaciones. Devuelve '' si no hay historial.
function _arbolResumenHtml(usuario){
  try{
    if(typeof arbolUsuario!=='function') return '';
    const arbol = arbolUsuario(usuario);
    if(!arbol.length) return '';
    let totC=0, totR=0;
    arbol.forEach(function(o){ const m=Math.abs(Number(o.monto||0)); const t=String(o.tipo||'').toUpperCase(); if(t==='CARGA')totC+=m; else if(t==='RETIRO')totR+=m; });
    const ult = arbol.slice(0,6).map(function(o){
      const t=String(o.tipo||'').toUpperCase(); const ico=t==='CARGA'?'⬆️':t==='RETIRO'?'⬇️':'•';
      return '<div style="display:flex;justify-content:space-between;font-size:11px;padding:2px 0;color:#94a3b8"><span>'+ico+' '+escapeHtml(t||'—')+' · '+formatFecha(o.fecha)+'</span><span style="font-weight:700;color:'+(t==='RETIRO'?'#fb923c':'#22c55e')+'">'+money(Math.abs(Number(o.monto||0)))+'</span></div>';
    }).join('');
    return '<div style="margin-top:10px;padding:8px 10px;background:#0d1117;border:1px solid #21262d;border-radius:9px">'
      + '<div style="display:flex;justify-content:space-between;gap:6px;font-size:11px;margin-bottom:4px;flex-wrap:wrap"><b style="color:#c9d1d9">🌳 '+arbol.length+' ops</b><span style="color:#22c55e">⬆️ '+money(totC)+'</span><span style="color:#fb923c">⬇️ '+money(totR)+'</span><span style="color:#e6edf3">neto <b>'+money(totC-totR)+'</b></span></div>'
      + ult + '</div>';
  }catch(_e){ return ''; }
}
// Progreso de un retiro PARCIAL: cuánto se pagó ya (metadata.retiro_parcial.pagado) y cuánto resta.
// Se usa para que la tarjeta y el modal muestren el RESTANTE (no el total original) a medida que se paga.
// ── Cuánto se pagó REALMENTE de un retiro ────────────────────────────────────────────────────
// Se SUMA DEL HISTORIAL, no se lee de un contador. Cada transferencia real escribe su fila con
// solicitud_id, monto y billetera: ese es el libro, y es el único registro que existe porque
// hubo plata moviéndose. metadata.monto_pagado es un acumulado que se le suma a ciegas en cada
// pago — se conto doble una vez y quedaron solicitudes diciendo "pagado 450.000" cuando habian
// salido 250.000, sin forma de corregirlo desde el panel (la RPC solo suma, no fija).
// Derivarlo del historial lo hace AUTOCORREGIBLE: si el numero guardado esta podrido, el proximo
// pago lo pisa con la suma real. Mismo criterio que con Chunior y el saldo de las billeteras:
// la verdad es el registro de los movimientos, no un contador paralelo.
window._retiroPagadoDelHistorial = function(solicitudId){
  const sid = String(solicitudId||''); if(!sid) return null;
  let filas = [];
  try{ filas = (typeof _historialData!=='undefined' && Array.isArray(_historialData)) ? _historialData
             : (Array.isArray(window._historialData) ? window._historialData : []); }catch(_e){ return null; }
  if(!filas.length) return null;                       // historial no cargado → no afirmamos nada
  let suma = 0, n = 0;
  filas.forEach(function(h){
    if(!h || String(h.solicitud_id||'')!==sid) return;
    if(normalizar(h.tipo)!=='RETIRO') return;
    if(normalizar(h.estado)!=='OK') return;            // sólo las efectivas
    suma += Math.abs(Number(h.monto||0)) || 0; n++;
  });
  return n ? { pagado:suma, filas:n } : null;          // sin filas → todavía no se pagó nada
};

window._retiroParcialInfo = function(s){
  const total = Number((s&&(s.MONTO_REAL||s.MONTO_DECLARADO||s.MONTO))||0);
  let pagado = 0, pagadoAlt = 0;
  try{
    let m = (s&&(s.METADATA!==undefined?s.METADATA:s.metadata))||{};
    if(typeof m==='string'){ try{ m=JSON.parse(m); }catch(_e){ m={}; } }
    const rp = (m&&(m.retiro_parcial||m.retiro_progreso||m.progreso))||{};
    pagado = Math.abs(Number((rp.pagado!=null?rp.pagado:(rp.acumulado!=null?rp.acumulado:(m.pagado_parcial!=null?m.pagado_parcial:0))))||0);
    // El progreso vive en DOS lugares: retiro_parcial (lo escribe la RPC) y monto_pagado suelto (lo
    // escribe el panel). Si un pago quedó registrado en uno solo, los números no coinciden y el
    // retiro se ve "a medio pagar" aunque esté saldado. Guardamos el otro para poder avisarlo.
    pagadoAlt = Math.abs(Number(m.monto_pagado!=null ? m.monto_pagado : pagado)||0);
  }catch(_e){}
  if(total>0 && pagado>total) pagado=total;
  const _alt = (total>0 && pagadoAlt>total) ? total : pagadoAlt;
  return {
    total:total, pagado:pagado, restante:Math.max(0,total-pagado), hasProg:(pagado>0.5||_alt>0.5),
    // Segunda fuente + si discrepan: NO se decide por una, se avisa al operador para que resuelva.
    pagadoAlt:_alt,
    discrepa: Math.abs(_alt - pagado) > 1,
    saldadoPorAlguna: (total>0 && (pagado >= total-0.5 || _alt >= total-0.5))
  };
};
// Un RETIRO con progreso PARCIAL (se pagó algo pero NO todo) sigue PENDIENTE hasta cobrar el total,
// aunque la RPC lo haya marcado PAGADA/completo. Solo debe desaparecer si se retiró por COMPLETO
// (pagado >= total) o si es un cierre deliberado (RECHAZADA/CANCELADA). Red de seguridad del panel.
// Caja de retiros pagándose por partes. Portado de la línea de la encargada (5405ff9): los
// parciales salían mezclados con las solicitudes nuevas y se perdían de vista — de hecho pasamos
// media sesión peleando con uno que "desaparecía". La lista la arma el render del Inicio en
// window._parcialesEnProceso.
window.verRetirosParciales = function(){
  const arr = (window._parcialesEnProceso || []).slice();
  if(!arr.length){ try{ toast('No hay retiros pagándose por partes.','blue'); }catch(_e){} return; }
  const filas = arr.map(function(s){
    const id  = Number(s.ID || s.SOLICITUD_ID || 0);
    const pp  = window._retiroParcialInfo ? window._retiroParcialInfo(s) : {total:0,pagado:0,restante:0};
    const pct = pp.total > 0 ? Math.min(100, Math.round(pp.pagado * 100 / pp.total)) : 0;
    const usuario = escapeHtml(String(s.USUARIO || s.USUARIO_JUGADOR || ''));
    const titular = escapeHtml(String(s.TITULAR || s.NOMBRE_COMPLETO || ''));
    const fecha   = s.FECHA_CREACION || s.created_at || s.FECHA || '';
    return '<div style="background:#161b22;border:1px solid #30363d;border-left:3px solid #7c3aed;border-radius:10px;padding:10px 12px;margin-bottom:8px">'
      + '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;flex-wrap:wrap">'
      +   '<div style="min-width:0"><b style="font-size:15px;color:#f0f6fc">'+usuario+'</b>'
      +     (titular ? '<div class="small" style="color:#8b949e">'+titular+'</div>' : '') + '</div>'
      +   '<div style="text-align:right"><div style="font-weight:900;font-size:15px;color:#a78bfa">falta '+money(pp.restante)+'</div>'
      +     '<div class="small" style="color:#8b949e">'+money(pp.pagado)+' de '+money(pp.total)+'</div></div>'
      + '</div>'
      + '<div style="height:6px;background:#0d1117;border-radius:999px;overflow:hidden;margin-top:8px">'
      +   '<div style="height:100%;width:'+pct+'%;background:linear-gradient(90deg,#7c3aed,#a78bfa)"></div></div>'
      + '<div style="display:flex;justify-content:space-between;align-items:center;margin-top:8px;gap:8px">'
      +   '<span class="small" style="color:#8b949e">#'+id+(fecha ? ' · '+escapeHtml(String(formatFecha(fecha))) : '')+'</span>'
      +   '<button class="mini-btn" style="background:#7c3aed;color:#fff;border:none;font-size:11px" '
      +     'onclick="cerrarModal();v154pRegistrarParcial('+id+')">💸 Pagar más</button>'
      + '</div></div>';
  }).join('');
  abrirModal('💸 Retiros pagándose por partes · '+arr.length, filas, null, '');
};

// ¿Este retiro cerrado lo cerró el operador A MANO desde la caja de Parciales?
// cerrarRetiroSaldado deja esa marca en la metadata. Es una decisión explícita y manda.
function _retiroCerradoAMano(s){
  try{
    let m = (s&&(s.METADATA!==undefined?s.METADATA:s.metadata))||{};
    if(typeof m==='string'){ try{ m=JSON.parse(m); }catch(_e){ m={}; } }
    return String((m&&m.etapa)||'').toUpperCase()==='RETIRO_CIERRE_MANUAL';
  }catch(_e){ return false; }
}
window._retiroParcialSigueAbierto = function(s){
  try{
    if(String(s.TIPO||s.TIPO_SOLICITUD||'').toUpperCase()!=='RETIRO') return false;
    const est = String(s.ESTADO||'').toUpperCase();
    if(/RECHAZ|CANCEL/.test(est)) return false;   // cierre deliberado del operador → respetar
    // Cerrado a mano ("✔ ya cobró todo"). Sin esto el retiro volvía a la caja en el
    // siguiente refresco: se podía cerrar infinitas veces y el contador nunca bajaba de 1.
    if(_retiroCerradoAMano(s)) return false;
    const pp = window._retiroParcialInfo ? window._retiroParcialInfo(s) : null;
    if(!pp) return false;
    // Si CUALQUIERA de las dos fuentes del progreso dice que ya está pago, no se reabre.
    // Es el MISMO criterio con el que la caja imprime "✔ saldado" — antes esta función usaba
    // otro (sólo retiro_parcial.pagado) y las dos mitades del panel se contradecían: la caja
    // decía "saldado" y este filtro lo devolvía a la lista.
    if(pp.saldadoPorAlguna) return false;
    return !!(pp.hasProg && pp.total>0 && pp.pagado < pp.total - 0.5);
  }catch(_e){ return false; }
};
// Modal de los retiros que se están pagando POR PARTES. Salen de "Solicitudes pendientes" (podían
// quedar abiertos días y tapaban las solicitudes nuevas) y se agrupan acá, con su progreso y el
// botón para seguir pagando. La lista la arma el render del Inicio en window._parcialesEnProceso.
window.verRetirosParciales = function(){
  const arr = (window._parcialesEnProceso || []).slice();
  if(!arr.length){ try{ toast('No hay retiros pagándose por partes.','blue'); }catch(_e){} return; }
  const filas = arr.map(function(s){
    const id  = Number(s.ID || s.SOLICITUD_ID || 0);
    const pp  = window._retiroParcialInfo ? window._retiroParcialInfo(s) : {total:0,pagado:0,restante:0};
    const pct = pp.total > 0 ? Math.min(100, Math.round(pp.pagado * 100 / pp.total)) : 0;
    const usuario = escapeHtml(String(s.USUARIO || s.USUARIO_JUGADOR || ''));
    const titular = escapeHtml(String(s.TITULAR || s.NOMBRE_COMPLETO || ''));
    const fecha   = s.FECHA_CREACION || s.created_at || s.FECHA || '';
    // Ya cobró todo pero la solicitud quedó abierta → se ofrece cerrarla, no pagar más.
    // "saldadoPorAlguna": una de las dos fuentes del progreso dice que ya está pago.
    const saldado = pp.restante <= 0.5 || pp.saldadoPorAlguna;
    const acento  = saldado ? '#22c55e' : '#7c3aed';
    return '<div style="background:#161b22;border:1px solid #30363d;border-left:3px solid '+acento+';border-radius:10px;padding:10px 12px;margin-bottom:8px">'
      + '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;flex-wrap:wrap">'
      +   '<div style="min-width:0"><b style="font-size:15px;color:#f0f6fc">'+usuario+'</b>'
      +     (titular ? '<div class="small" style="color:#8b949e">'+titular+'</div>' : '') + '</div>'
      +   '<div style="text-align:right"><div style="font-weight:900;font-size:15px;color:'+acento+'">'
      +       (saldado ? '✔ saldado' : 'falta '+money(pp.restante))+'</div>'
      +     '<div class="small" style="color:#8b949e">'+money(pp.pagado)+' de '+money(pp.total)+'</div></div>'
      + '</div>'
      + '<div style="height:6px;background:#0d1117;border-radius:999px;overflow:hidden;margin-top:8px">'
      +   '<div style="height:100%;width:'+pct+'%;background:'+(saldado?'#22c55e':'linear-gradient(90deg,#7c3aed,#a78bfa)')+'"></div></div>'
      // Las dos fuentes del progreso no coinciden → no se decide por una: se muestran las dos y el
      // operador elige (cobró todo → Cerrar · falta → Pagar más).
      + (pp.discrepa
          ? ('<div style="margin-top:8px;padding:6px 9px;border-radius:8px;background:rgba(245,197,24,.10);border:1px solid rgba(245,197,24,.35);font-size:11.5px;color:#fde68a">'
             + '⚠ El progreso no coincide entre los dos registros: <b>'+money(pp.pagado)+'</b> vs <b>'+money(pp.pagadoAlt)+'</b>. '
             + 'Fijate en el historial cuánto cobró y elegí.</div>')
          : '')
      + '<div style="display:flex;justify-content:space-between;align-items:center;margin-top:8px;gap:8px;flex-wrap:wrap">'
      +   '<span class="small" style="color:#8b949e">#'+id+(fecha ? ' · '+escapeHtml(String(formatFecha(fecha))) : '')+'</span>'
      +   '<span style="display:flex;gap:6px">'
      // El "Cerrar" está SIEMPRE disponible: sin esa salida, un retiro con el progreso mal
      // registrado quedaba trabado en la bandeja sin forma de sacarlo.
      +     '<button class="mini-btn" style="background:'+(saldado?'#12b76a':'transparent')+';color:'+(saldado?'#fff':'#8b949e')+';border:'+(saldado?'none':'1px solid #30363d')+';font-size:11px" title="Marcar la solicitud como pagada (no mueve fichas ni plata)" onclick="cerrarRetiroSaldado('+id+')">✔ Cerrar'+(saldado?' · ya cobró todo':'')+'</button>'
      +     (saldado ? '' : '<button class="mini-btn" style="background:#7c3aed;color:#fff;border:none;font-size:11px" onclick="cerrarModal();v154pRegistrarParcial('+id+')">💸 Pagar más</button>')
      +   '</span>'
      + '</div></div>';
  }).join('');
  const _sald = arr.filter(function(s){ const p=window._retiroParcialInfo?window._retiroParcialInfo(s):null; return p && p.restante<=0.5; }).length;
  abrirModal('💸 Retiros pagándose por partes · '+arr.length
    + (_sald ? ' <span style="font-size:12px;color:#22c55e">('+_sald+' ya saldado'+(_sald>1?'s':'')+')</span>' : ''), filas, null, '');
};
// Cierra un retiro que YA cobró el total pero quedó abierto (típico: el último pago no llegó a
// marcarlo PAGADA). No mueve fichas ni plata: solo pone la solicitud en su estado final.
window.cerrarRetiroSaldado = async function(id){
  const s = (window._parcialesEnProceso||[]).find(function(x){ return String(x.ID||x.SOLICITUD_ID||0)===String(id); });
  const pp = (s && window._retiroParcialInfo) ? window._retiroParcialInfo(s) : null;
  if(!confirm('Cerrar el retiro #'+id+' como PAGADO.\n\n'
    + (pp ? ('Ya cobró '+money(pp.pagado)+' de '+money(pp.total)+'.\n\n') : '')
    + 'Esto NO transfiere ni retira nada: solo marca la solicitud como terminada.')) return;
  try{
    await window.actualizarSolicitudPortal(String(id), 'PAGADA', {
      etapa:'RETIRO_CIERRE_MANUAL',
      operador:(window.operador&&(window.operador.usuario||window.operador.nombre))||'panel'
    });
    try{ cerrarModal(); }catch(_e){}
    toast('✔ Retiro #'+id+' cerrado','green');
    try{ await cargarSolicitudesPortal(true); }catch(_e){}
  }catch(e){ toast('No se pudo cerrar: '+(e.message||e),'red'); }
};
// Copiar CBU/alias al portapapeles (usado por el detalle del árbol).
// Copiar el CBU/alias. El bug que tenía: navigator.clipboard.writeText() falla en Electron sobre
// file:// (no es contexto seguro), el .catch() se comía el error EN SILENCIO, y aun así pintaba
// el ✅ y toasteaba "Copiado". El operador pegaba y no había nada — o peor, quedaba lo anterior
// del portapapeles, que puede ser el alias de OTRO retiro. Ahora: si el modo moderno falla, cae
// al textarea + execCommand, y sólo se canta "copiado" cuando de verdad se copió.
function portalCopiarCbu(btn){
  const val = (btn && btn.getAttribute('data-valor')) || '';
  if(!val){ if(typeof toast==='function') toast('No hay alias/CBU para copiar','red'); return; }
  const ok = function(){
    try{
      const ico = btn.querySelector('.pcopy-ico');
      if(ico){ const prev=ico.textContent; ico.textContent='✅'; setTimeout(function(){ ico.textContent=prev; }, 1200); }
    }catch(_e){}
    if(typeof toast==='function') toast('Copiado: '+val,'green');
  };
  const fallo = function(){
    // El alias va en el aviso: si no se pudo copiar, al menos se puede leer y tipear.
    if(typeof toast==='function') toast('No se pudo copiar — copialo a mano: '+val,'red');
  };
  const porTextarea = function(){
    try{
      const ta=document.createElement('textarea');
      ta.value=val;
      // Fuera de pantalla pero SELECCIONABLE: un textarea display:none no se puede copiar.
      ta.setAttribute('readonly','');
      ta.style.cssText='position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;padding:0;border:0';
      document.body.appendChild(ta);
      ta.focus(); ta.select(); ta.setSelectionRange(0, val.length);
      let r=false; try{ r=document.execCommand('copy'); }catch(_e){}
      document.body.removeChild(ta);
      r ? ok() : fallo();
    }catch(_e){ fallo(); }
  };
  try{
    if(navigator.clipboard && navigator.clipboard.writeText){
      navigator.clipboard.writeText(val).then(ok).catch(porTextarea);
    } else porTextarea();
  }catch(_e){ porTextarea(); }
}

// ══════════════════════════════════════════════════════════════════════════
