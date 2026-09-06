
/* ============================================================
   NODO · CHAT MACROS RAPIDAS SAFE
   Agrega macros tipo Whaticket al chat.
   No toca historial, billeteras, motor, worker ni Supabase.
   ============================================================ */
(function(){
  function S(v){return String(v??"")}
  function E(v){
    try{return escapeHtml(S(v))}catch(_e){
      return S(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    }
  }

  const MACROS_BASE = [
    {
      id:"saludo",
      label:"👋 Saludo",
      text:"Hola 👋 ¿Cómo estás? Ya estamos revisando tu consulta."
    },
    {
      id:"comprobante",
      label:"📎 Pedir comprobante",
      text:"Enviame el comprobante por acá y lo verificamos."
    },
    {
      id:"revision",
      label:"🕓 En revisión",
      text:"Tu solicitud quedó en revisión. Apenas esté confirmada te avisamos por este chat."
    },
    {
      id:"acreditado",
      label:"✅ Acreditado",
      text:"Listo ✅ Tu carga fue acreditada. Ya podés revisar tus fichas/saldo."
    },
    {
      id:"retiro",
      label:"🏧 Retiro",
      text:"Tu retiro quedó en revisión. Vamos a verificar saldo y datos de destino."
    },
    {
      id:"usuario",
      label:"👤 Pedir usuario",
      text:"Pasame tu usuario de plataforma así puedo verificarlo."
    },
    {
      id:"demora",
      label:"⏳ Demora",
      text:"Estamos con demora operativa, pero tu consulta ya quedó tomada. Te respondemos apenas se procese."
    },
    {
      id:"datos",
      label:"📝 Datos incompletos",
      text:"Necesito que me confirmes: usuario, monto y titular para poder revisarlo correctamente."
    },
    {
      id:"cierre",
      label:"🙌 Cierre",
      text:"Gracias por escribirnos. Cualquier otra consulta, avisame por acá."
    }
  ];

  function inputChat(){
    return document.getElementById("chatInput") || document.getElementById("v15ChatInput");
  }

  function insertText(text){
    const input=inputChat();
    if(!input){alert("No encontré el campo de respuesta.");return}
    const current=S(input.value);
    input.value = current ? (current.trimEnd()+"\n"+text) : text;
    input.focus();
    input.dispatchEvent(new Event("input",{bubbles:true}));
  }

  function detectarTipoBilletera(b){
    if(!b) return "";
    // 1) Si el operador definió un tipo real (no "Chunior/Px/General"), respetarlo.
    const exp = S(b.banco || b.tipo || b.BANCO || b.TIPO || "").trim();
    if(exp && !/chunior|^p\d|general/i.test(exp)) return exp;
    // 2) Autodetección por nombre/alias/cbu.
    const s = (S(b.nombre_visible||b.nombre||b.NOMBRE_VISIBLE||"")+" "+S(b.alias||b.ALIAS||b.cbu_alias||b.CBU_ALIAS||"")+" "+S(b.cbu||b.CBU||"")).toLowerCase();
    if(/\.mp\b|mercado\s?pago|\bmp\b/.test(s))   return "MercadoPago";
    if(/ual[aá]/.test(s))                         return "Ualá";
    if(/njx|naranja/.test(s))                     return "Naranja X";
    if(/\bpp\b|prex/.test(s))                     return "PP";
    if(/brubank/.test(s))                         return "Brubank";
    return ""; // sin señal: mejor no poner tipo que poner "Chunior"
  }
  function getWalletPortalText(){
    // Preferencia 1: lo que muestra Inicio.
    const nombre = S(document.getElementById("statBilletera")?.textContent || "").trim();
    const tipo = S(document.getElementById("statBilleteraTipo")?.textContent || "").trim();

    // Preferencia 2: billetera marcada en portal si existe en arrays globales.
    let b = null;
    try{
      const arr = Array.isArray(window.billeteras) ? window.billeteras :
                  Array.isArray(window._billeteras) ? window._billeteras :
                  (window.V154P && Array.isArray(V154P.billeteras) ? V154P.billeteras : []);
      b = arr.find(x => x.en_portal || x.seleccionada_manual || x.en_landing || x.portal_activa) || null;
    }catch(_e){}

    const n = S(b?.nombre_visible || b?.nombre || nombre || "").trim();
    const alias = S(b?.alias || "").trim();
    const cbu = S(b?.cbu || b?.cvu || "").trim();
    const titular = S(b?.titular || "").trim();
    const t = detectarTipoBilletera(b) || (/chunior|^p\d|general/i.test(S(tipo)) ? "" : S(tipo).trim());

    let msg = "Te paso los datos para transferir:";
    if(n && n !== "-" && n !== "—") msg += "\nBilletera: " + n;
    if(t && t !== "-" && t !== "—") msg += "\nTipo: " + t;
    if(titular) msg += "\nTitular: " + titular;
    if(alias) msg += "\nAlias: " + alias;
    if(cbu) msg += "\nCBU/CVU: " + cbu;

    if(msg === "Te paso los datos para transferir:"){
      msg = "Te paso los datos de la billetera en portal. Si no los ves actualizados, aguardá un momento que lo revisamos.";
    }
    return msg;
  }

  function macroRapida(id){
    if(id==="billetera"){
      insertText(getWalletPortalText());
      return;
    }
    const m = MACROS_BASE.find(x=>x.id===id);
    if(m) insertText(m.text);
  }

  function renderMacrosPanel(){
    const panel=document.getElementById("macrosPanel");
    if(!panel)return;

    let html = `
      <button class="macro-btn bil" onclick="nodoMacroRapida('billetera')">💳 Billetera portal<br><small>Inserta datos disponibles</small></button>
    `;
    MACROS_BASE.forEach(m=>{
      html += `<button class="macro-btn" onclick="nodoMacroRapida('${m.id}')">${E(m.label)}<br><small>${E(m.text).slice(0,54)}${m.text.length>54?"...":""}</small></button>`;
    });
    html += `
      <div class="macro-edit-row">
        <button class="mini-btn gray" onclick="nodoCerrarMacros()">Cerrar macros</button>
      </div>
    `;
    panel.innerHTML = html;
  }

  function ensureMacroButton(){
    const row = document.querySelector("#viewChat .chat-row");
    if(!row || document.getElementById("nodoMacroBtnSafe"))return;

    // Si ya hay botón de macros original, lo mantenemos. Solo aseguramos que llame bien.
    const oldButtons = row.querySelectorAll("button");
    let macroBtn = Array.from(oldButtons).find(b => S(b.textContent).includes("📋"));
    if(macroBtn){
      macroBtn.onclick = function(ev){toggleMacrosPanel(ev)};
      macroBtn.title = "Macros rápidos";
      macroBtn.id = "nodoMacroBtnSafe";
      return;
    }

    const btn=document.createElement("button");
    btn.id="nodoMacroBtnSafe";
    btn.className="mini-btn gray";
    btn.type="button";
    btn.title="Macros rápidos";
    btn.textContent="📋";
    btn.onclick=function(ev){toggleMacrosPanel(ev)};
    row.insertBefore(btn,row.firstChild);
  }

  function installCss(){
    if(document.getElementById("nodoMacrosSafeCss"))return;
    const st=document.createElement("style");
    st.id="nodoMacrosSafeCss";
    st.textContent=`
      #macrosPanel{
        max-height:330px!important;
        overflow:auto!important;
        grid-template-columns:1fr 1fr!important;
      }
      #macrosPanel .macro-btn small{
        display:block;
        color:#98a2b3;
        font-size:10px;
        line-height:1.25;
        margin-top:3px;
        font-weight:500;
      }
      #macrosPanel .macro-btn.bil small{
        color:#b9f7cb;
      }
      body.chat-expanded #macrosPanel,
      body.nodo-chat-open #macrosPanel{
        grid-template-columns:repeat(2,minmax(0,1fr))!important;
      }
      @media(max-width:900px){
        #macrosPanel{grid-template-columns:1fr!important}
      }
    `;
    document.head.appendChild(st);
  }

  window.nodoMacroRapida = macroRapida;
  window.nodoCerrarMacros = function(){
    const panel=document.getElementById("macrosPanel");
    if(panel)panel.classList.add("hidden");
  };
  window.toggleMacrosPanel = function(ev){
    if(ev)ev.preventDefault();
    installCss();
    renderMacrosPanel();
    const panel=document.getElementById("macrosPanel");
    if(panel)panel.classList.toggle("hidden");
  };
  window.v15InsertarMacro = function(text){insertText(text)};
  window.insertarMacroChat = function(text){insertText(text)};

  // Atajos opcionales: Ctrl+M abre macros.
  document.addEventListener("keydown",function(ev){
    if((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase()==="m"){
      ev.preventDefault();
      window.toggleMacrosPanel(ev);
    }
  },true);

  setTimeout(function(){
    installCss();
    renderMacrosPanel();
    ensureMacroButton();
  },800);

  setInterval(function(){
    try{ensureMacroButton()}catch(_e){}
  },3000);
})();
