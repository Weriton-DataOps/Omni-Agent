'use strict';

// O olho do Oracle (27/10, 4ª volta): o globo nasce virado para baixo e para a direita (arte gerada já
// assim, não entortada) e a animação vem pronta da bancada (bancada/oracle/combo): casca parada, só o globo
// interno olha em volta no próprio encaixe, e o diafragma pisca ou foca entre as olhadas. É um vídeo VP9 com
// canal alfa (oraculo/oracle-olhando.webm, 256 px, 20 s em laço): fora da silhueta é transparente, o card
// aparece por trás. Mesmo ciclo do núcleo: só toca com a ilha aberta e revelada; com movimento reduzido,
// fica o primeiro quadro; se o vídeo não carregar, fica a arte parada (oraculo/oracle-virado.png).
(() => {
  const video = document.getElementById('or-olho');
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
