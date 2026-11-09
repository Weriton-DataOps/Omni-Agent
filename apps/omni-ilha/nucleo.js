'use strict';

// O núcleo do Overcore (27/10, 5ª volta): saiu o shader e entrou a animação pronta da bancada
// (bancada/overcore/planetas/girar.py): os planetas orbitam o buraco em 3D com a luz vindo dele, o disco
// de baixo corre como poeira em Kepler e o anel de cima solta reflexos e erupções de plasma. É um vídeo VP9
// com canal alfa (nucleo/overcore-girando.webm, 300×140 recortado no disco, 24 s em laço sem emenda). Mesmo
// ciclo do olho do Oracle: só toca com a ilha aberta e revelada; com movimento reduzido, fica o primeiro
// quadro; se o vídeo não carregar, fica a arte parada (nucleo/overcore-girando.png).
(() => {
  const video = document.getElementById('oc-nucleo');
  const poco = document.getElementById('ilha');
  if (!video || !poco) return;
  const REDUZIDO = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const parar = () => { video.parentElement.classList.add('parado'); video.hidden = true; };
  video.addEventListener('error', parar);

  function ligar(sim) {
    if (sim && !REDUZIDO) video.play().catch(() => { /* sem autoplay: fica o quadro parado */ });
    else video.pause();
  }
  ligar(poco.classList.contains('revelada'));
  new MutationObserver(() => ligar(poco.classList.contains('revelada'))).observe(poco, { attributes: true, attributeFilter: ['class'] });
})();
