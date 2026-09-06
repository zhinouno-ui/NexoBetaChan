const JUG_STORE_KEY = 'nodo_jugadores_local_v2';
function _jugStoreAll(){
  try{ return JSON.parse(localStorage.getItem(JUG_STORE_KEY)||'{}')||{}; }catch(_e){ return {}; }
}
function _jugStoreSave(map){
  try{ localStorage.setItem(JUG_STORE_KEY, JSON.stringify(map)); }catch(_e){}
}
// Normaliza un CBU/CVU/alias para comparar (case/espacios/puntos no cambian el destino).
function _jugNormCbu(v){ return String(v||'').toLowerCase().replace(/[\s.\-]/g,'').trim(); }

// ══════════════════════════════════════════════════════════════════════════════
// TITULARES BLOQUEADOS (portado de NexoBetaChan · rama unificacion)
// Sale de la auditoría de multicuenta: encontramos 52 redes de titulares que
// cobran a varias cuentas, pero no había forma de ACTUAR sobre ellas. Esto es
// esa acción: marcar un titular para que la próxima solicitud quede señalada.
//
// DIFERENCIA con la versión del colega: la de ellos bloquea por par
// usuario+titular. Para nuestro caso no alcanza — "rodrigo ismael flores" opera
// con 7 usuarios distintos, así que habría que bloquearlo 7 veces y bastaría
// una cuenta nueva para esquivarlo. Se agrega el bloqueo GLOBAL (clave "*"),
// que es el que sirve contra las redes.
//
// Es LOCAL (localStorage) igual que la base de jugadores: no se comparte entre
// PCs. Bloquear en P2 no bloquea en P4.
// ══════════════════════════════════════════════════════════════════════════════
const _RECH_KEY = 'nodo_titulares_rechazados';
function _rechStore(){ try{ return JSON.parse(localStorage.getItem(_RECH_KEY)||'{}')||{}; }catch(_e){ return {}; } }
function _rechSave(m){ try{ localStorage.setItem(_RECH_KEY, JSON.stringify(m)); }catch(_e){} }
function _normNombre(v){
  return String(v||'').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'')
    .replace(/[^a-z0-9]+/g,' ').trim();
}
window._normNombre = _normNombre;
function _rechClave(usuario, titular){ return String(usuario||'').toLowerCase().trim()+'|'+_normNombre(titular); }
function _rechClaveGlobal(titular){ return '*|'+_normNombre(titular); }

// Devuelve null, {global:false} o {global:true} — el llamador decide cómo mostrarlo.
window.titularBloqueado = function(usuario, titular){
  if(!titular) return null;
  const m = _rechStore();
  const g = m[_rechClaveGlobal(titular)];
  if(g) return { global:true,  motivo:g.motivo||'', fecha:g.fecha||'' };
  const u = m[_rechClave(usuario, titular)];
  if(u) return { global:false, motivo:u.motivo||'', fecha:u.fecha||'' };
  return null;
};
window.titularYaRechazado = function(usuario, titular){ return !!window.titularBloqueado(usuario, titular); };

// usuario === '*' → bloqueo global (para TODAS las cuentas).
window.marcarTitularRechazado = function(usuario, titular, motivo){
  if(!titular) return;
  const m = _rechStore();
  const k = (usuario === '*') ? _rechClaveGlobal(titular) : _rechClave(usuario, titular);
  m[k] = { motivo:motivo||'', fecha:new Date().toISOString(), titular:String(titular||''), usuario:String(usuario||'') };
  const ks = Object.keys(m); if(ks.length > 500) delete m[ks[0]];   // tope: no crece para siempre
  _rechSave(m);
};
window.desmarcarTitularRechazado = function(usuario, titular){
  const m = _rechStore();
  delete m[_rechClave(usuario, titular)];
  delete m[_rechClaveGlobal(titular)];        // desbloquear siempre limpia los dos
  _rechSave(m);
};
window.titularesBloqueadosTodos = function(){
  const m = _rechStore();
  return Object.keys(m).map(function(k){
    return { clave:k, global:k.indexOf('*|')===0, titular:m[k].titular||'', usuario:m[k].usuario||'',
             motivo:m[k].motivo||'', fecha:m[k].fecha||'' };
  }).sort(function(a,b){ return String(b.fecha).localeCompare(String(a.fecha)); });
};

// ¿El "titular" que declaró es en realidad un dato NUESTRO? El portal le muestra al cliente el
// titular/alias de la billetera para que transfiera, y copiarlo y pegarlo ahí es gratis: quedaba
// guardado en su ficha como si fuera un titular real. No va nada hardcodeado — sale de las
// billeteras vivas, así que si mañana cambia una, esto se entera solo.
window.esDatoPropioBilletera = function(valor){
  const v = _normNombre(valor);
  const vCbu = _jugNormCbu(valor);
  if(v.length < 4 && vCbu.length < 6) return null;    // muy corto para afirmar nada
  let hit = null;
  try{
    (window.billeteras||[]).forEach(function(b){
      if(hit) return;
      [['titular', b.TITULAR],
       ['nombre',  b.NOMBRE_VISIBLE || b.NOMBRE_CHUNIOR || b.BILLETERA_NOMBRE],
       ['alias',   b.CBU_ALIAS || b.CBU_CVU]].forEach(function(par){
        if(hit || !par[1]) return;
        const pN = _normNombre(par[1]), pC = _jugNormCbu(par[1]);
        if((pN.length>=4 && pN===v) || (pC.length>=6 && pC===vCbu)){
          hit = { billetera:String(b.NOMBRE_VISIBLE||b.NOMBRE_CHUNIOR||'—'), campo:par[0], valor:String(par[1]) };
        }
      });
    });
  }catch(_e){}
  return hit;
};

window.pjBloquearTitular = function(usuario, titular){
  if(!usuario || !titular) return;
  const glob = confirm('Bloquear el titular:\n\n  "'+titular+'"\n\n'
    + 'Aceptar  → bloquearlo para TODAS las cuentas (sirve contra redes de multicuenta)\n'
    + 'Cancelar → elegir solo para «'+usuario+'»');
  if(!glob){
    if(!confirm('Bloquear "'+titular+'" solo para el usuario «'+usuario+'»?')) return;
  }
  try{
    window.marcarTitularRechazado(glob ? '*' : usuario, titular, glob ? 'BLOQUEADO_GLOBAL_FICHA' : 'BLOQUEADO_DESDE_FICHA');
    toast('🚫 "'+titular+'" bloqueado'+(glob?' para TODAS las cuentas':' para '+usuario), 'yellow');
    if(typeof abrirPerfilJugador==='function') abrirPerfilJugador(usuario);   // repintar sin cerrar
  }catch(e){ toast('No se pudo bloquear: '+(e.message||''), 'red'); }
};
window.pjDesbloquearTitular = function(usuario, titular){
  if(!usuario || !titular) return;
  if(!confirm('Desbloquear el titular "'+titular+'"?')) return;
  try{
    window.desmarcarTitularRechazado(usuario, titular);
    toast('✅ "'+titular+'" desbloqueado', 'green');
    if(typeof abrirPerfilJugador==='function') abrirPerfilJugador(usuario);
  }catch(e){ toast('No se pudo desbloquear: '+(e.message||''), 'red'); }
};
window.jugadorRegistrarDato = function(usuario, dato){
  const u = String(usuario||'').toLowerCase().trim();
  if(!u || !dato) return;
  try{
    const map = _jugStoreAll();
    const j = map[u] || { usuario:u, telefonos:{}, cbus:{}, titulares:{}, bonos:[], creado:new Date().toISOString() };
    const fecha = dato.fecha || new Date().toISOString();
    if(dato.telefono){
      const t = String(dato.telefono).replace(/\D/g,'');
      if(t){ const p = j.telefonos[t]||{veces:0,primera:fecha}; p.veces++; p.ultima=fecha; if(dato.verificado) p.verificado=true; j.telefonos[t]=p; }
    }
    // No guardamos en la ficha del jugador datos que son NUESTROS (titular/alias de una billetera
    // propia). Antes entraban como un titular más y la identidad quedaba con "Juan Carlos Matrelo
    // ×4" colgando de un cliente cualquiera.
    const _propioTit = dato.titular ? window.esDatoPropioBilletera(dato.titular) : null;
    const _propioCbu = dato.cbu     ? window.esDatoPropioBilletera(dato.cbu)     : null;
    if(_propioTit || _propioCbu){
      const p = _propioTit || _propioCbu;
      try{ console.warn('[jugadores] '+u+' declaró un dato NUESTRO ('+p.campo+' de '+p.billetera+'): "'+p.valor+'" — no se registra en su ficha'); }catch(_e){}
      j.datosPropios = Array.isArray(j.datosPropios) ? j.datosPropios : [];
      j.datosPropios.push({ campo:p.campo, billetera:p.billetera, valor:String(dato.titular||dato.cbu||''), fecha:fecha });
      if(j.datosPropios.length>20) j.datosPropios = j.datosPropios.slice(-20);
      if(_propioTit) dato = Object.assign({}, dato, { titular:'' });
      if(_propioCbu) dato = Object.assign({}, dato, { cbu:'' });
    }
    const cbuN = _jugNormCbu(dato.cbu);
    if(cbuN){
      const c = j.cbus[cbuN] || { raw:String(dato.cbu).trim(), veces:0, primera:fecha };
      c.veces++; c.ultima = fecha;
      if(dato.titular) c.titular = String(dato.titular).trim();
      if(dato.instrumentoVerificado) c.verificado = true; // retiro OK real a ese destino
      j.cbus[cbuN] = c;
    }
    if(dato.bono){
      j.bonos = Array.isArray(j.bonos) ? j.bonos : [];
      j.bonos.push({ estado:String(dato.bono.estado||''), pct:dato.bono.pct||null, monto:dato.bono.monto||null, fecha:fecha });
      if(j.bonos.length>20) j.bonos = j.bonos.slice(-20);
    }
    if(dato.titular){
      const tt = String(dato.titular).trim().toLowerCase();
      if(tt){ const p = j.titulares[tt]||{raw:String(dato.titular).trim(),veces:0,primera:fecha}; p.veces++; p.ultima=fecha; j.titulares[tt]=p; }
    }
    j.ultimaAct = fecha;
    map[u] = j;
    _jugStoreSave(map);
  }catch(_e){}
};
// ¿Este destino es conocido para el usuario? → para resaltar destinos NUEVOS en el retiro.
// También compara el TITULAR: si el usuario siempre retiró a cuentas de un titular y ahora
// llega otro nombre → advertencia (posible cuenta ajena). Cruza MANUAL + PORTAL porque la
// base se alimenta de guardarMovimientoLocal, que captura ambos flujos.
window.jugadorCbuCheck = function(usuario, cbu, titular){
  try{
    const u = String(usuario||'').toLowerCase().trim();
    const j = _jugStoreAll()[u];
    const cbuN = _jugNormCbu(cbu);
    if(!j || !cbuN) return { datos:false };
    const conocidos = Object.values(j.cbus||{});
    const este = (j.cbus||{})[cbuN];
    const titN = String(titular||'').trim().toLowerCase();
    const titsConocidos = Object.keys(j.titulares||{});
    const ultimo = conocidos.slice().sort(function(a,b){ return String(b.ultima||'').localeCompare(String(a.ultima||'')); })[0] || null;
    return {
      datos: conocidos.length>0,
      conocido: !!este,
      veces: este ? este.veces : 0,
      otros: conocidos.filter(function(c){ return _jugNormCbu(c.raw)!==cbuN; }).map(function(c){ return c.raw; }),
      ultimo: ultimo,
      titularNuevo: !!(titN && titsConocidos.length && !titsConocidos.includes(titN)),
      titularesConocidos: titsConocidos.map(function(k){ return (j.titulares[k]||{}).raw || k; })
    };
  }catch(_e){ return { datos:false }; }
};
// Semilla one-shot: si la base está vacía, reconstruirla desde el store de movimientos
// (que ya venía guardando titular/cbu/destino por operación) — así arranca con historia.
try{
  if(!localStorage.getItem(JUG_STORE_KEY)){
    const all = _movStoreAll();
    Object.keys(all).forEach(function(k){
      const m = all[k]||{};
      const esRet = String(m.tipo||'').toUpperCase()==='RETIRO';
      if(m.usuario && ((esRet && (m.cbu||m.destino)) || m.titular))
        jugadorRegistrarDato(m.usuario, { cbu: esRet ? (m.cbu||m.destino) : '', titular:m.titular, fecha:m._fecha });
    });
  }
}catch(_e){}

// ── UI de la base de jugadores + PERFIL (portado de NexoBetaChan 1.0.85) ─────────
window.mostrarBaseLocalJugadores = function(filtro){
  const map = _jugStoreAll();
  const q = String(filtro||'').toLowerCase().trim();
  let lista = Object.values(map);
  const total = lista.length;
  if(q) lista = lista.filter(function(j){
    return (j.usuario+' '+Object.keys(j.telefonos||{}).join(' ')+' '
      +Object.values(j.cbus||{}).map(function(c){return c.raw;}).join(' ')+' '
      +Object.values(j.titulares||{}).map(function(t){return t.raw;}).join(' ')).toLowerCase().includes(q);
  });
  lista.sort(function(a,b){ return String(b.ultimaAct||'').localeCompare(String(a.ultimaAct||'')); });
  const filas = lista.slice(0,400).map(function(j){
    const tels = Object.keys(j.telefonos||{});
    const cbus = Object.values(j.cbus||{});
    const tits = Object.values(j.titulares||{});
    const bonos = Array.isArray(j.bonos)?j.bonos:[];
    const ultBono = bonos.length?bonos[bonos.length-1]:null;
    const bonosTxt = !bonos.length ? '<span style="color:#5a6474">—</span>'
      : (ultBono.estado==='APLICADO'
          ? '<span style="color:#22c55e;font-weight:700">🎁 aplicado'+(ultBono.pct?(' '+ultBono.pct+'%'):'')+'</span>'
          : '<span style="color:#f5c518;font-weight:700">⏳ pendiente'+(ultBono.pct?(' '+ultBono.pct+'%'):'')+'</span>')
        + '<div class="small" style="color:#8b949e">'+bonos.length+' bono/s</div>';
    return '<tr style="border-top:1px solid rgba(255,255,255,.07)">'
      + '<td style="padding:7px 8px;vertical-align:top"><b>'+escapeHtml(j.usuario)+'</b>'
      +   '<div class="small" style="color:#8b949e">'+escapeHtml(formatFecha(j.ultimaAct||''))+'</div></td>'
      + '<td style="padding:7px 8px;vertical-align:top;font-family:ui-monospace,monospace;font-size:12px">'+(tels.length?tels.map(function(t){ return escapeHtml(t)+((j.telefonos[t]||{}).verificado?' <span title="Verificado al vincular" style="color:#22c55e">✓</span>':''); }).join('<br>'):'<span style="color:#5a6474">—</span>')+'</td>'
      + '<td style="padding:7px 8px;vertical-align:top;font-size:12px">'+(cbus.length?cbus.map(function(c){ return '<div style="font-family:ui-monospace,monospace">'+escapeHtml(c.raw)+' <span style="color:#8b949e">×'+c.veces+'</span>'+(c.verificado?' <span title="Ya cobró en este destino (retiro OK)" style="color:#22c55e">✓</span>':'')+'</div>'; }).join(''):'<span style="color:#5a6474">—</span>')+'</td>'
      + '<td style="padding:7px 8px;vertical-align:top;font-size:12px">'+(tits.length?tits.map(function(t){ return escapeHtml(t.raw); }).join('<br>'):'<span style="color:#5a6474">—</span>')+'</td>'
      + '<td style="padding:7px 8px;vertical-align:top;font-size:12px">'+bonosTxt+'</td>'
      + '<td style="padding:7px 8px;vertical-align:top"><button class="mini-btn blue" style="font-size:10px" onclick="abrirPerfilJugador(\''+escapeHtml(j.usuario)+'\')" title="Perfil completo del jugador">🌳</button></td>'
      + '</tr>';
  }).join('');
  const body =
      '<div style="display:flex;gap:10px;align-items:center;margin-bottom:8px;flex-wrap:wrap">'
    +   '<input id="jugLocalBuscar" placeholder="Buscar usuario / teléfono / CBU / titular…" value="'+escapeHtml(q)+'" oninput="mostrarBaseLocalJugadoresRefiltrar(this.value)" style="flex:1;min-width:200px">'
    +   '<span class="small">👥 <b>'+lista.length+'</b>'+(q?(' de '+total):'')+' jugador/es con datos</span>'
    + '</div>'
    + '<div style="max-height:56vh;overflow:auto;border:1px solid rgba(255,255,255,.08);border-radius:10px">'
    +   '<table style="width:100%;border-collapse:collapse;font-size:13px"><thead>'
    +     '<tr style="position:sticky;top:0;background:#161b26;z-index:1"><th style="padding:8px;text-align:left">Usuario</th><th style="padding:8px;text-align:left">Teléfonos</th><th style="padding:8px;text-align:left">Destinos (CBU/alias)</th><th style="padding:8px;text-align:left">Titulares</th><th style="padding:8px;text-align:left">Bonos</th><th></th></tr>'
    +   '</thead><tbody>'+(filas||'<tr><td colspan="6" style="padding:14px;color:#8b949e">Sin datos todavía. La base se llena sola: verificaciones (teléfono) y retiros (destino/titular), tanto manuales como del portal.</td></tr>')+'</tbody></table>'
    + '</div>';
  // "abierto" = el buscador existe Y es visible (si el modal se cerró, el nodo puede quedar
  // en el DOM oculto → antes el botón actualizaba un modal invisible y parecía roto).
  const _inpPrev = document.getElementById('jugLocalBuscar');
  const yaAbierto = !!(_inpPrev && _inpPrev.offsetParent !== null);
  if(yaAbierto){
    const mb = document.getElementById('modalBody') || document.querySelector('#modal .modal-body');
    if(mb){ mb.innerHTML = body; const inp=document.getElementById('jugLocalBuscar'); if(inp){ inp.focus(); inp.setSelectionRange(inp.value.length,inp.value.length); } }
  } else {
    abrirModal('📇 Base local de jugadores', body, null, 'Cerrar');
    try{ const b=document.getElementById('modalSaveBtn'); if(b) b.style.display='none'; }catch(_e){}
  }
};
// Modal de DESTINOS del usuario: todos sus cbu/alias en tarjetas copiables (un toque = copiar),
// ordenados por último uso — para transferir cómodo y revisar el último usado si metió uno nuevo
// por error (y cerrar el retiro ANTES de transferir).
window.mostrarDestinosUsuario = function(usuario){
  const u = String(usuario||'').toLowerCase().trim();
  const j = _jugStoreAll()[u] || {};
  const cbus = Object.values(j.cbus||{}).sort(function(a,b){ return String(b.ultima||'').localeCompare(String(a.ultima||'')); });
  const titsSet = Object.values(j.titulares||{}).map(function(t){ return String(t.raw).toLowerCase().trim(); });
  const filas = cbus.map(function(c,i){
    const ajeno = c.titular && titsSet.length && titsSet.indexOf(String(c.titular).toLowerCase().trim())===-1;
    return '<button type="button" onclick="portalCopiarCbu(this)" data-valor="'+escapeHtml(c.raw)+'" title="Tocá para copiar" '
      + 'style="display:flex;align-items:center;justify-content:space-between;gap:10px;width:100%;text-align:left;cursor:pointer;background:#161b22;border:1.5px solid '+(ajeno?'rgba(239,68,68,.55)':(i===0?'rgba(245,197,24,.5)':'#30363d'))+';border-radius:10px;padding:9px 12px;color:#e6edf3;margin-bottom:7px">'
      + '<span style="min-width:0;flex:1">'
      +   '<span style="display:block;font-size:10px;font-weight:800;text-transform:uppercase;color:#8b949e">'+(i===0?'⭐ último usado':'destino')+(c.verificado?' · ✓ ya cobró acá':' · ● nunca cobró')+(ajeno?' · 🚨 TITULAR DISTINTO':'')+'</span>'
      +   '<span style="display:block;font-family:ui-monospace,monospace;font-size:15px;font-weight:800;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:'+(ajeno?'#fca5a5':'#e6edf3')+'">'+escapeHtml(c.raw)+'</span>'
      +   '<span class="small" style="color:#8b949e">'+(c.titular?escapeHtml(c.titular)+' · ':'')+'×'+c.veces+(c.ultima?(' · últ. '+escapeHtml(formatFecha(c.ultima))):'')+'</span>'
      + '</span><span class="pcopy-ico" style="flex-shrink:0;font-size:16px">📋</span></button>';
  }).join('');
  abrirModal('📇 Destinos de '+escapeHtml(usuario),
    (filas || '<div class="small" style="color:#8b949e;padding:10px">Sin destinos registrados para este usuario.</div>')
    + '<div class="small" style="color:#8b949e;margin-top:6px">Un toque copia el CBU/alias. Si el que llegó en el retiro no coincide con estos, revisá con el usuario y cerrá el retiro ANTES de transferir.</div>',
    null, 'Cerrar');
  try{ const b=document.getElementById('modalSaveBtn'); if(b) b.style.display='none'; }catch(_e){}
};

let _jugRefiltroT = null;
window.mostrarBaseLocalJugadoresRefiltrar = function(v){
  clearTimeout(_jugRefiltroT);
  _jugRefiltroT = setTimeout(function(){ mostrarBaseLocalJugadores(v); }, 250);
};

// ══════════════════════════════════════════════════════════════════════════
