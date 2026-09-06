function abrirModalCrearUsuario(){
  if(!window.ctrlElectron){ alert("Solo disponible en la app de escritorio."); return; }
  abrirModal(
    '➕ Crear nuevo usuario',
    '<div style="color:#c0cad8;font-size:13px;margin-bottom:12px">Se crea en el casino y queda <b>validado y agendado</b> en el mismo paso.</div>' +
    '<label style="color:#c0cad8;font-size:12px;font-weight:700">USUARIO (alias)</label>' +
    '<input id="nuevoJugUsuario" type="text" placeholder="ej: martin2024" autocomplete="off" style="margin-bottom:8px">' +
    // El teléfono es lo que ata la cuenta a la persona: sin él la cuenta nace suelta y cuando
    // entra al portal el cotejo no cierra — termina en soporte pidiendo que la validen a mano,
    // por algo que ya sabíamos en el momento de crearla.
    '<label style="color:#c0cad8;font-size:12px;font-weight:700">TELÉFONO <span style="font-weight:400;text-transform:none;color:#777">(con código de área, sin 0 ni 15)</span></label>' +
    '<input id="nuevoJugTelefono" type="tel" inputmode="tel" placeholder="ej: 11 2345 6789" autocomplete="off" style="margin-bottom:8px">' +
    '<label style="color:#c0cad8;font-size:12px;font-weight:700">CLAVE INICIAL <span style="font-weight:400;text-transform:none;color:#777">(mín 6 caracteres)</span></label>' +
    '<input id="nuevoJugClave" type="text" placeholder="12345a" value="12345a" autocomplete="off" style="margin-bottom:4px">' +
    '<div id="nuevoJugRes" style="min-height:16px;margin-top:4px"></div>',
    null,
    'Crear y copiar'
  );
  // Asignar handlers DESPUÉS de que abrirModal renderizó el overlay (evita contaminación de flujos anteriores)
  setTimeout(function(){
    const btn = document.getElementById('modalSaveBtn');
    if(btn){ btn.onclick = _ejecutarCrearUsuario; }
    const cancelBtn = document.querySelector('#modalOverlay .btn-gray');
    if(cancelBtn){ cancelBtn.onclick = function(){ cerrarModal(); }; }
    document.getElementById("nuevoJugUsuario")?.focus();
  }, 30);
}

async function _ejecutarCrearUsuario(){
  const usuario = (document.getElementById("nuevoJugUsuario")?.value || "").trim().toLowerCase().replace(/\s+/g, "");
  const clave   = (document.getElementById("nuevoJugClave")?.value   || "").trim() || "12345a";
  const telefono= (document.getElementById("nuevoJugTelefono")?.value|| "").trim();
  const resEl   = document.getElementById("nuevoJugRes");
  const btn     = document.getElementById("modalSaveBtn");
  if(!usuario){ if(resEl) resEl.innerHTML = '<span style="color:var(--red);font-size:12px">Ingresá un usuario.</span>'; return; }
  if(String(telefono).replace(/\D/g,"").length < 6){ if(resEl) resEl.innerHTML = '<span style="color:var(--red);font-size:12px">Ingresá el teléfono: sin él la cuenta nace sin vincular y no va a poder operar en el portal.</span>'; return; }
  if(clave.length < 6){ if(resEl) resEl.innerHTML = '<span style="color:var(--red);font-size:12px">La clave debe tener al menos 6 caracteres.</span>'; return; }
  if(btn){ btn.disabled = true; btn.textContent = "Creando..."; }
  if(resEl) resEl.innerHTML = '<span style="color:#c0cad8;font-size:12px">Procesando...</span>';
  try {
    if(!await ensureDrexSession()){ if(btn){btn.disabled=false;btn.textContent='Crear y copiar';} return; }
    const r = await callDrex("crearUsuario", usuario, clave);
    if(r && r.ok !== false){
      const aliasFinal = r.alias || usuario;
      const claveFinal = r.password || clave;
      const texto = "Usuario: " + aliasFinal + "\nClave: " + claveFinal;
      try { await navigator.clipboard.writeText(texto); } catch(_){}
      toast("Usuario " + aliasFinal + " creado · vinculando el teléfono...", "green");
      // Auto-registrar el usuario recién creado en NODO en segundo plano
      _autoregistrarUsuarioSiFalta(aliasFinal);
      // Se sacó la pantalla de resultado propia del alta: repetía —peor— lo que ya hace la de
      // validación. Aquella sólo copiaba texto; ésta además vincula el teléfono, agenda en el
      // CRM, dispara Nexo, avisa por el chat del portal Y ofrece el enlace de WhatsApp que
      // deja a la persona adentro ya validada. Eran dos pantallas para el mismo momento, y la
      // buena quedaba escondida detrás de otro flujo.
      // La clave recién elegida viaja por acá porque ejecutarVincular no la conoce y el modal
      // de resultado, si no, ofrece copiar el mensaje con "12345a" fijo — que sería mentira
      // cuando el operador puso otra.
      try{ window._altaClaveNueva = claveFinal; }catch(_e){}
      try{ cerrarModal(); }catch(_e){}
      await ejecutarVincular(aliasFinal, telefono, false);
      return;
    } else if(r?.error === 'duplicado'){
      // Alias duplicado → buscar y proponer alternativas que NO estén usadas
      if(resEl) resEl.innerHTML = '<div class="err-box" style="padding:10px;margin-top:8px">❌ El alias <b>'+escapeHtml(usuario)+'</b> ya existe.<br><span class="small">Buscando alternativas disponibles...</span></div>';
      if(btn){ btn.disabled = false; btn.textContent = 'Crear y copiar'; }
      const libres = await _generarAlternativasAlias(usuario, 6);
      let extra = '';
      if(libres.length){
        extra = '<div style="margin-top:8px;font-size:12px;color:#c0cad8">Alternativas libres en NODO (click para usar):</div>' +
                '<div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:6px">' +
                  libres.map(function(a){
                    return '<button class="mini-btn blue" style="font-size:12px" onclick="_usarAlternativaAlias(\''+escapeHtml(a)+'\')">'+escapeHtml(a)+'</button>';
                  }).join('') +
                '</div>';
      } else {
        extra = '<div style="margin-top:8px;font-size:12px;color:var(--muted)">No se generaron alternativas libres. Probá con otra base.</div>';
      }
      if(resEl) resEl.innerHTML = '<div class="err-box" style="padding:10px;margin-top:8px">❌ El alias <b>'+escapeHtml(usuario)+'</b> ya existe en el casino.'+extra+'</div>';
    } else {
      const msg = r?.message || "No se pudo crear el usuario.";
      if(resEl) resEl.innerHTML = '<div class="err-box" style="margin-top:8px">❌ ' + escapeHtml(msg) + '</div>';
      if(btn){ btn.disabled = false; btn.textContent = 'Crear y copiar'; }
    }
  } catch(e){
    if(resEl) resEl.innerHTML = '<div class="err-box" style="margin-top:8px">Error: ' + escapeHtml(e.message||'sin detalle') + '</div>';
    if(btn){ btn.disabled = false; btn.textContent = 'Crear y copiar'; }
  }
}

// Genera N variantes del alias y descarta las que ya están en nuestra base de usuarios.
// Estrategias: número creciente (1..99), sufijos comunes, año actual.
async function _generarAlternativasAlias(base, cantidad){
  const limpio = String(base||'').toLowerCase().replace(/[^a-z0-9]/g, '');
  if(!limpio) return [];
  const ano = new Date().getFullYear();
  const candidatos = [];
  // Números crecientes
  for(let i = 1; i <= 30; i++){
    candidatos.push(limpio + i);
  }
  // Sufijos
  const sufijos = ['ok','ar','mp','bet','777','999','x', String(ano), String(ano).slice(-2)];
  for(const s of sufijos){
    candidatos.push(limpio + s);
  }
  // Filtrar los que YA existen en nuestra base local (cualquier oficina, indistinto)
  const unicos = [...new Set(candidatos)];
  try {
    const { data } = await supabaseClient
      .from('usuarios')
      .select('usuario')
      .in('usuario', unicos);
    const existentes = new Set((data||[]).map(function(u){ return u.usuario; }));
    return unicos.filter(function(c){ return !existentes.has(c); }).slice(0, cantidad);
  } catch(_){
    return unicos.slice(0, cantidad);
  }
}

// Pone una alternativa elegida en el input del modal
function _usarAlternativaAlias(alias){
  const input = document.getElementById("nuevoJugUsuario");
  if(input){ input.value = alias; input.focus(); }
}

async function _resetClaveManual(usuario, clave){
  // Compatibilidad: ahora se usa blanquearClaveManual() desde el botón
  try {
    toast("Cambiando clave de "+usuario+"...","blue");
    const r = await callDrex("cambiarClave", clave);
    await registrarEnHistorial({usuario, tipo:'RESET_CLAVE', monto:0, origen:'MANUAL', estado:(r&&r.ok!==false)?'OK':'ERROR', notas:'clave → '+clave});
    toast("Clave cambiada OK","green");
  } catch(e) { toast("Error al cambiar clave: "+(e.message||""),"red"); }
}

// ── Historial de operaciones ───────────────────────────────────────────────────
