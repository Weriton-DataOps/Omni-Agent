'use strict';

// A janela do chat (27/10), só a forma: a mensagem vira bolha aqui e não sai da janela. Quando o destino
// for decidido (sessão viva, sessão nova ou o próprio Omni), é aqui que o envio liga.
(() => {
  const conversa = document.getElementById('conversa');
  const entrada = document.getElementById('entrada');
  const enviar = document.getElementById('enviar');

  const hora = () => new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

  function bolha(quem, texto) {
    const msg = document.createElement('div');
    msg.className = `msg ${quem}`;
    if (quem === 'omni') {
      const rosto = document.createElement('img');
      rosto.className = 'rosto';
      rosto.src = 'giro/g_8_4.png';
      rosto.alt = '';
      rosto.draggable = false;
      msg.append(rosto);
    }
    const b = document.createElement('div');
    b.className = 'bolha';
    b.textContent = texto;
    const h = document.createElement('span');
    h.className = 'hora';
    h.textContent = hora();
    msg.append(b, h);
    conversa.append(msg);
    conversa.scrollTop = conversa.scrollHeight;
  }

  function ajustar() {
    entrada.style.height = 'auto';
    entrada.style.height = `${entrada.scrollHeight}px`;
    enviar.disabled = !entrada.value.trim();
  }

  function mandar() {
    const texto = entrada.value.trim();
    if (!texto) return;
    bolha('voce', texto);
    entrada.value = '';
    ajustar();
    entrada.focus();
  }

  entrada.addEventListener('input', ajustar);
  entrada.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' && !ev.shiftKey && !ev.isComposing) { ev.preventDefault(); mandar(); }
  });
  enviar.addEventListener('click', mandar);
  ajustar();
})();
