// Pré-carregado no serviço do WhatsApp (node -r) pelo iniciar.ps1.
// Por que existe (07/11/2026): o primeiro DNS do PC (10.255.254.10, que vem do adaptador da VPN) não responde,
// e o Windows só passa ao próximo servidor depois de ~11 s. Os nomes de mídia do WhatsApp (mmg.whatsapp.net
// e afins) têm TTL de 15–60 s, então a cada pausa o cache expira e a resolução volta a levar 11 s. O download
// de mídia do Baileys desiste em 10 s ("fetch failed") e o áudio dele se perdia.
// O que faz, só para nomes do WhatsApp/Meta: pede IPv4 ao sistema e, se ele não responder em ATRASO_MS,
// pergunta também a resolvedores públicos; vale a primeira resposta. Qualquer outro nome segue o caminho normal.
'use strict'
const dns = require('node:dns')
const original = dns.lookup
const Resolvedor = dns.Resolver

const ATRASO_MS = 700
const PUBLICOS = ['1.1.1.1', '8.8.8.8']
const DO_WHATSAPP = /(^|\.)(whatsapp\.(net|com)|facebook\.(net|com)|fbcdn\.net|fbsbx\.com)$/i

function semFamilia(o) { return !o.family || o.family === 0 || o.family === 'IPv4 or IPv6' }

let resolvedor
function publico() {
  if (!resolvedor) { resolvedor = new Resolvedor({ timeout: 3000, tries: 2 }); resolvedor.setServers(PUBLICOS) }
  return resolvedor
}

function entregar(opcoes, callback, enderecos) {
  if (opcoes.all) return callback(null, enderecos.map(address => ({ address, family: 4 })))
  callback(null, enderecos[0], 4)
}

function lookupDoWhatsapp(host, opcoes, callback) {
  let feito = false
  let perguntouPublico = false
  let falhas = 0
  const fim = (...args) => { if (feito) return; feito = true; clearTimeout(timer); callback(...args) }
  const falhou = erro => { if (++falhas === 2) fim(erro) }
  const timer = setTimeout(consultarPublico, ATRASO_MS)
  original.call(dns, host, { ...opcoes, family: 4 }, (erro, ...resto) => {
    if (erro) { consultarPublico(); return falhou(erro) }
    fim(null, ...resto)
  })
  function consultarPublico() {
    if (feito || perguntouPublico) return
    perguntouPublico = true
    clearTimeout(timer)
    publico().resolve4(host, (erro, enderecos) => {
      if (erro || !enderecos?.length) return falhou(erro || Object.assign(new Error('sem endereço'), { code: 'ENODATA' }))
      if (!feito) { feito = true; entregar(opcoes, callback, enderecos) }
    })
  }
}

dns.lookup = function lookupIpv4Primeiro(host, opcoes, callback) {
  if (typeof opcoes === 'function') { callback = opcoes; opcoes = {} }
  else if (typeof opcoes === 'number') opcoes = { family: opcoes }
  else opcoes = { ...(opcoes || {}) }
  if (typeof host !== 'string' || !DO_WHATSAPP.test(host) || !semFamilia(opcoes)) return original.call(dns, host, opcoes, callback)
  return lookupDoWhatsapp(host, opcoes, callback)
}
