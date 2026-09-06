
// SAFE FIX · render chat legible sin tocar envío/motor + soporte sync billeteras RPC.
(function(){
  function esc(s){
    try{ return escapeHtml(String(s||'')); }catch(_){ return String(s||'').replace(/[&<>"']/g,function(m){return({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'})[m];}); }
  }
  function fechaCorta(v){
    if(!v) return '';
    try{
      var d = new Date(v);
      if(isNaN(d.getTime())) return String(v).slice(0,16);
      var hoy = new Date();
      var mismo = d.toDateString() === hoy.toDateString();
      var hh = String(d.getHours()).padStart(2,'0');
      var mm = String(d.getMinutes()).padStart(2,'0');
      if(mismo) return hh+':'+mm;
      return String(d.getDate()).padStart(2,'0')+'/'+String(d.getMonth()+1).padStart(2,'0')+' · '+hh+':'+mm;
    }catch(_){ return String(v).slice(0,16); }
  }
  function ultimoTexto(c){
    var t = String(c.ULTIMO_MENSAJE || c.ultimo_mensaje || '').trim();
    if(!t) return 'Sin mensajes todavía';
    return t;
  }

  window.renderChatList = function(){
    var list = window.chats || [];
    if(!list.length){
      setBox('chatList','<div class="chat-empty-clean">No hay chats activos.</div>');
      return;
    }
    var html = list.map(function(c){
      var id = c.ID_CHAT || c.idChat || c.id || '';
      var unread = Number(c.SIN_LEER || c.sin_leer || 0);
      var active = String(id) === String(window.chatActualId || '');
      var name = c.USUARIO || c.usuario || 'Usuario landing';
      var sub = c.NOMBRE_COMPLETO || c.TELEFONO || c.telefono || c.SOLICITUD_ID || '';
      var fecha = fechaCorta(c.FECHA_ULTIMO || c.FECHA || c.fecha_ultimo || c.created_at);
      var ult = ultimoTexto(c);
      var solicitud = c.SOLICITUD_ID || c.solicitud_id || '';
      return '<div class="chat-item clean '+(active?'active':'')+'" onclick="abrirChat(\''+String(id).replace(/\\/g,'\\\\').replace(/'/g,"\\'")+'\')">' +
        '<div class="chat-row-title-clean"><span class="chat-row-name-clean">'+esc(name)+'</span><span class="chat-row-date-clean">'+esc(fecha)+'</span></div>'+
        '<div class="chat-row-sub-clean">'+esc(sub || ult)+'</div>'+
        '<div class="chat-row-sub-clean">'+esc(ult)+'</div>'+
        '<div class="chat-row-tags-clean">'+
          (unread ? '<span class="chat-tag-clean unread">'+unread+' nuevo(s)</span>' : '<span class="chat-tag-clean ok">Leído</span>')+
          (solicitud ? '<span class="chat-tag-clean">Sol. '+esc(solicitud)+'</span>' : '')+
        '</div>'+
      '</div>';
    }).join('');
    setBox('chatList', html);
  };

  var oldRenderMsg = window.renderChatMensajes;
  window.renderChatMensajes = function(){
    try{
      var chat = (window.chats||[]).find(function(c){ return String(c.ID_CHAT||c.id||'') === String(window.chatActualId||''); }) || {};
      if(window.chatActualId && (!window.chatMensajes || !window.chatMensajes.length)){
        setBox('chatTitulo', chat.USUARIO || chat.usuario || 'Chat landing');
        setBox('chatSubtitulo', [chat.NOMBRE_COMPLETO, chat.TELEFONO].filter(Boolean).join(' · ') || 'Sin datos adicionales');
        setBox('chatEstado', chat.SOLICITUD_ID ? 'Solicitud: '+chat.SOLICITUD_ID : 'Sin solicitud');
        setBox('chatBody','<div class="chat-empty-clean">Todavía no hay mensajes en esta conversación.</div>');
        return;
      }
    }catch(_e){}
    if(typeof oldRenderMsg === 'function') return oldRenderMsg();
  };
})();
