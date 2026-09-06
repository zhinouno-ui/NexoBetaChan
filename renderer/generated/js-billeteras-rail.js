
// SAFE PATCH · mueve billeteras a rail superior del inicio sin tocar motor.
(function(){
  function moverRailBilleteras(){
    try{
      var card = document.getElementById('cardBilleterasInicio');
      var grid = document.querySelector('#viewInicio .inicio-grid');
      if(card && grid && card.parentNode !== grid.parentNode){
        grid.parentNode.insertBefore(card, grid);
      }
    }catch(e){ console.warn('wallet rail move', e); }
  }
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', moverRailBilleteras);
  else moverRailBilleteras();
})();
