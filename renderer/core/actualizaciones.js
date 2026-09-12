function _updaterForzarVisible(){
  try{
    const box=document.getElementById("updaterBox"), chip=document.getElementById("updaterMiniChip");
    if(box){ box.style.display="flex"; box.style.borderColor="#3fb950"; }
    if(chip) chip.style.display="none";
  }catch(_e){}
}
function nodoUpdaterStatus(payload){
  const el=document.getElementById("updaterStatusTxt");
  if(!el || !payload) return;
  const st=payload.state;
  if(st==="available" || st==="downloaded") _updaterForzarVisible();
  if(st==="checking") el.innerHTML="Buscando actualización...";
  else if(st==="not-available") el.innerHTML="✅ Ya tenés la última versión";
  else if(st==="available") el.innerHTML="🆕 v"+escapeHtml(payload.version||"")+" disponible — <a href=\"javascript:void 0\" onclick=\"nodoDescargarActualizacion()\" style=\"color:#58a6ff\">Descargar</a>";
  else if(st==="downloading") el.innerHTML="⬇️ Descargando... "+(payload.percent||0)+"%";
  else if(st==="downloaded") el.innerHTML="✅ Lista v"+escapeHtml(payload.version||"")+" — <a href=\"javascript:void 0\" onclick=\"nodoInstalarActualizacion()\" style=\"color:#3fb950;font-weight:700\">Reiniciar e instalar</a>";
  else if(st==="error") el.innerHTML='<span style="color:#f85149">Error: '+escapeHtml(payload.message||"")+"</span>";
}
// Canal de actualización (portado de NexoBetaChan): alpha = repo oficial nuestro · beta = repo del colega (pruebas).
function nodoGetCanal(){ try{ return localStorage.getItem("nodo_update_channel")==="beta" ? "beta" : "alpha"; }catch(_e){ return "alpha"; } }
function nodoAplicarIconoCanal(){
  try{
    const beta = nodoGetCanal()==="beta";
    const box = document.getElementById("updaterBox"); if(box) box.style.borderColor = beta ? "rgba(34,197,94,.6)" : "#272b36"; // verde = beta
    const sel = document.getElementById("updaterCanal"); if(sel) sel.value = nodoGetCanal();
  }catch(_e){}
}
function nodoSetCanal(c){
  const canal = c==="beta" ? "beta" : "alpha";
  try{ localStorage.setItem("nodo_update_channel", canal); }catch(_e){}
  nodoAplicarIconoCanal();
  try{ toast("Canal: "+(canal==="beta"?"β Beta (repo del colega · pruebas)":"α Alpha (oficial · nuestro)")+" · tocá 🔄 para buscar en ese canal", "blue"); }catch(_e){}
}
async function nodoInitUpdater(){
  try{
    if(!window.updaterAPI){ const b=document.getElementById("updaterBox"); if(b) b.style.display="none"; return; }
    nodoAplicarIconoCanal();
    const v = await window.updaterAPI.getVersion();
    const el=document.getElementById("updaterVersionTxt");
    if(el && v && v.version) el.textContent = "v"+v.version;
    const mv=document.getElementById("updaterMiniVer");
    if(mv && v && v.version) mv.textContent = "v"+v.version;   // el plegado también dice la versión
    // Mostrar el botón "Volver" solo si la función existe (app instalada con updater).
    const rb=document.getElementById("updaterRollbackBtn"); if(rb) rb.style.display="";
    window.updaterAPI.onStatus(nodoUpdaterStatus);
    // Restaurar si el operador lo había dejado minimizado.
    try{ if(localStorage.getItem("nodo_updater_min")==="1") nodoUpdaterMinimizar(true); }catch(_e){}
    // Buscar SOLO. Antes esto no existía: la única forma de enterarse de que había una
    // versión nueva era apretar 🔄 por las dudas, así que no se enteraba nadie — la 1.1.81
    // salió y dos días después seguía sin instalarse en ninguna oficina, con máquinas
    // cuatro versiones atrás. Ahora chequea al arrancar y cada 3 horas.
    // Sigue SIN instalar por su cuenta: instalar reinicia la app y en medio del turno eso
    // corta la operación. Avisar es del panel, decidir cuándo cortar es del operador.
    setTimeout(nodoAutoBuscar, 20000);                 // dar tiempo al login
    setInterval(nodoAutoBuscar, 3*60*60*1000);
  }catch(_e){}
}
function nodoAutoBuscar(){
  try{
    if(window.updaterAPI && window.updaterAPI.check) window.updaterAPI.check({ channel: nodoGetCanal() });
  }catch(_e){}
}
// Arriba a la derecha, pero apoyado en el borde izquierdo del panel de chat: ahí está el hueco
// que queda arriba del botón "Rechequear". Se mide del DOM, así sigue bien si el chat se minimiza.
function _updaterAnclar(){
  try{
    const chat=document.getElementById("viewChat");
    let right=12;
    // En la pantalla de LOGIN el chat está tapado (el login ocupa toda la pantalla) pero sigue
    // midiendo: el cartel se enganchaba a su borde y quedaba flotando en el MEDIO del login. Juan
    // lo pidió dos veces; la primera se entendió mal y se movió la tira de proceso en vez de esto.
    // Sin el chat a la vista, el cartel va a la esquina.
    const login=document.getElementById("loginView");
    let enLogin=false;
    try{ enLogin=!!(login && !login.classList.contains("hidden") && getComputedStyle(login).display!=="none"); }catch(_e){}
    if(chat && !enLogin){
      const r=chat.getBoundingClientRect();
      if(r.width>0 && r.right>window.innerWidth-60) right=Math.round(window.innerWidth-r.left)+14;
    }
    ["updaterBox","updaterMiniChip"].forEach(function(id){
      const el=document.getElementById(id);
      if(el){ el.style.top="10px"; el.style.bottom="auto"; el.style.left="auto"; el.style.right=right+"px"; }
    });
  }catch(_e){}
}
window._updaterAnclar=_updaterAnclar;
try{
  addEventListener("resize", _updaterAnclar);
  setTimeout(_updaterAnclar, 1200);
  setInterval(_updaterAnclar, 5000);   // el panel de chat se minimiza/restaura sin avisar
}catch(_e){}
function nodoUpdaterMinimizar(min){
  try{
    const box=document.getElementById("updaterBox"), chip=document.getElementById("updaterMiniChip");
    if(box) box.style.display = min ? "none" : "flex";
    if(chip) chip.style.display = min ? "inline-flex" : "none";
    localStorage.setItem("nodo_updater_min", min ? "1" : "0");
  }catch(_e){}
}
async function nodoVolverVersionAnterior(){
  if(!window.updaterAPI || !window.updaterAPI.openReleases){ toast&&toast("No disponible en este entorno.","yellow"); return; }
  if(!confirm("¿Volver a una versión anterior?\n\nSe va a abrir la página de descargas en el navegador. Bajá el instalador de la versión que quieras (por ejemplo la anterior a esta) y ejecutalo — reemplaza la actual y conserva tu configuración.")) return;
  try{ await window.updaterAPI.openReleases(); }catch(_e){}
}
async function nodoBuscarActualizacion(){
  const el=document.getElementById("updaterStatusTxt");
  if(!window.updaterAPI){ if(el) el.textContent="No disponible en este entorno."; return; }
  const r = await window.updaterAPI.check({ channel: nodoGetCanal() });
  if(!r || !r.ok){
    if(el) el.textContent = (r&&r.reason==="dev-mode") ? "Solo disponible en la app instalada." : "No se pudo buscar actualización.";
  }
}
async function nodoDescargarActualizacion(){
  const el=document.getElementById("updaterStatusTxt");
  if(el) el.textContent="⬇️ Descargando...";
  try{ await window.updaterAPI.download(); }catch(_e){ if(el) el.textContent="Error al descargar."; }
}
async function nodoInstalarActualizacion(){
  try{ await window.updaterAPI.install(); }catch(_e){}
}
document.addEventListener("DOMContentLoaded", nodoInitUpdater);
if(document.readyState !== "loading") nodoInitUpdater();

// ── Crear nuevo usuario en el casino ─────────────────────────────────────────
