
/* Los tres botones del chat de Inicio —💳 Billetera, Cerrar y Reabrir— apuntaban a
   funciones que NUNCA existieron: el marcado estaba, el código no. Hacer clic no daba
   error visible, simplemente no pasaba nada.
   Las RPC ya estaban en la base (panel_v14_cerrar_chat_json / _reabrir_chat_json), sólo
   faltaba conectarlas. Cierran por chat_id; el session_id es opcional y sólo firma el
   mensaje de sistema. */
(function(){
  function chatDeInicio(){
    return String(window.v15ChatActualId || window.chatActualId || '').trim();
  }

  window.v15EnviarTarjetaBilletera = function(){
    const texto = (typeof textoTarjetaBilletera==='function') ? textoTarjetaBilletera() : '';
    if(!texto){ toast('No hay billetera activa configurada','red'); return; }
    const inp = document.getElementById('v15ChatInput');
    if(!inp){ toast('No hay un chat abierto acá','orange'); return; }
    inp.value = texto; inp.focus();
    // Queda escrito para que el operador lo revise y mande: no se envía solo, porque
    // manda datos de cobro y conviene que los mire antes.
  };

  async function cambiarEstado(rpc, verbo){
    const chatId = chatDeInicio();
    if(!chatId){ toast('Abrí un chat primero','orange'); return; }
    try{
      const { data, error } = await supabaseClient.rpc(rpc, {
        p_session_id: null, p_chat_id: chatId,
        p_motivo: verbo+' desde Inicio por '+
          (((typeof operador!=='undefined' && operador) && (operador.usuario||operador.nombre)) || 'panel')
      });
      if(error) throw new Error(error.message||'');
      if(data && data.ok === false){
        toast(data.error==='CHAT_NO_ENCONTRADO' ? 'No se encontró ese chat' : ('No se pudo: '+data.error), 'red');
        return;
      }
      toast('Chat '+verbo.toLowerCase(),'green');
      try{ if(typeof v15CargarChatsCompacto==='function') v15CargarChatsCompacto(true); }catch(_e){}
      try{ if(typeof v15AbrirChatCompacto==='function') v15AbrirChatCompacto(chatId); }catch(_e){}
    }catch(e){ toast('No se pudo '+verbo.toLowerCase()+': '+(e.message||''),'red'); }
  }

  window.v15CerrarChatActual  = function(){ cambiarEstado('panel_v14_cerrar_chat_json','Cerrado'); };
  window.v15ReabrirChatActual = function(){ cambiarEstado('panel_v14_reabrir_chat_json','Reabierto'); };
})();
