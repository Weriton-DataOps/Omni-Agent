import React from 'react'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { MessageText, DocumentLinks } from '../src/renderer/MessageText'

const render = (text: string, streaming = false) => renderToStaticMarkup(<MessageText text={text} streaming={streaming} />)

test('negrito parcial aparece formatado enquanto recebe o texto', () => {
  const html = render('**Crachá', true)
  assert.match(html, /<strong>Crachá<\/strong>/)
  assert.doesNotMatch(html, /\*\*/)
  assert.match(html, /aria-busy="true"/)
  assert.match(render('**Crachá*', true), /<strong>Crachá<\/strong>/)
  assert.equal(render('**Crachá**'), render('**Crachá**', false))
  assert.match(render('**Crachá** pronto'), /<strong>Crachá<\/strong> pronto/)
})

test('marcadores vazios de streaming não aparecem crus', () => {
  for (const partial of ['*', '**', '***', '`', '```']) {
    const html = render(partial, true)
    assert.doesNotMatch(html, /[\*`]/)
    assert.doesNotMatch(html, /<script|<img/)
  }
})

test('negrito não fechado no texto final permanece literal', () => {
  assert.match(render('**Texto sem fechar'), />\*\*Texto sem fechar<\/p>/)
  assert.match(render('Use \\*literal\\* e \\`literal\\`.'), />Use \*literal\* e `literal`\.<\/p>/)
  assert.match(render('arquivo_nome_local'), />arquivo_nome_local<\/p>/)
})

test('código inline aberto durante streaming preserva seus caracteres literais', () => {
  const html = render('Execute `const x = "**literal**"; <tag>', true)
  assert.match(html, /<code>const x = &quot;\*\*literal\*\*&quot;; &lt;tag&gt;<\/code>/)
  assert.doesNotMatch(html, /<strong>|<tag>/)
  assert.match(render('Use ``um ` literal``.'), /<code>um ` literal<\/code>\./)
})

test('fence aberto renderiza código antes do fechamento sem expor linguagem ou delimitadores', () => {
  const html = render('```ts\nconst label = "**Crachá**";\n  <img src=x onerror=alert(1)>', true)
  assert.match(html, /<pre><code>const label = &quot;\*\*Crachá\*\*&quot;;\n  &lt;img src=x onerror=alert\(1\)&gt;<\/code><\/pre>/)
  assert.doesNotMatch(html, /```|<img|<strong>/)
})

test('fence fechado mantém código literal e permite texto logo na linha seguinte', () => {
  const html = render('```txt\nlinha 1\n\n  linha 3 **literal**\n```\nFim.')
  assert.match(html, /<pre><code>linha 1\n\n  linha 3 \*\*literal\*\*\n<\/code><\/pre><p>Fim\.<\/p>/)
})

test('heading, parágrafo e listas não dependem de linhas vazias', () => {
  const html = render('## O que voltou\nEntrega validada.\n- Código pronto\n- Teste passou\n### Próximo passo\n1. Publicar\n2. Conferir')
  assert.match(html, /<h2 id="o-que-voltou">O que voltou<\/h2><p>Entrega validada\.<\/p><ul><li>Código pronto<\/li><li>Teste passou<\/li><\/ul><h3 id="próximo-passo">Próximo passo<\/h3><ol><li>Publicar<\/li><li>Conferir<\/li><\/ol>/)
  assert.doesNotMatch(html, /##|&gt;- /)
})

test('quebras simples de texto e numeração inicial são preservadas', () => {
  assert.match(render('Primeira linha\nSegunda linha'), /<p>Primeira linha<br\/>Segunda linha<\/p>/)
  assert.match(render('3. Conferir\n4. Entregar'), /<ol start="3"><li>Conferir<\/li><li>Entregar<\/li><\/ol>/)
  assert.match(render('> ## Evidência\n> Texto conferido'), /<blockquote><h2 id="evidência">Evidência<\/h2><p>Texto conferido<\/p><\/blockquote>/)
})

test('URLs em negrito continuam clicáveis e pontuação fica fora do endereço', () => {
  const html = render('**Veja https://example.com/repo/pull/364.**')
  assert.match(html, /<strong>Veja <a[^>]+href="https:\/\/example\.com\/repo\/pull\/364"[^>]*>https:\/\/example\.com\/repo\/pull\/364<\/a>\.<\/strong>/)
})

test('link Markdown completo usa apenas destino HTTP(S) validado', () => {
  const html = render('Abra [**o projeto**](https://example.com/projeto).')
  assert.match(html, /<a[^>]+href="https:\/\/example\.com\/projeto"[^>]*><strong>o projeto<\/strong><\/a>/)
  for (const unsafe of ['[Executar](javascript:alert(1))', '[Arquivo](file:///secret)', '[Dados](data:text/html,evil)', '[Controle](https://example.com/\u0000path)', '[Credencial](https://user:pass@example.com/)']) {
    assert.doesNotMatch(render(unsafe), /<a\b/)
  }
})

test('link parcial em streaming mostra somente rótulo e não permite navegar endereço incompleto', () => {
  for (const partial of ['[GitHub', '[GitHub]', '[GitHub](', '[GitHub](https://example']) {
    const html = render(partial, true)
    assert.match(html, /<p>GitHub<\/p>/)
    assert.doesNotMatch(html, /<a\b|href=|\[|https:/)
  }
  assert.match(render('[GitHub](https://example.com)', true), /<a[^>]+href="https:\/\/example\.com"/)
})

test('URL nua na cauda aguarda limite ou fim do stream antes de virar link', () => {
  assert.doesNotMatch(render('Veja https://example.com/proje', true), /<a\b/)
  assert.match(render('Veja https://example.com/projeto pronto', true), /<a[^>]+href="https:\/\/example\.com\/projeto"/)
  assert.match(render('Veja https://example.com/projeto'), /<a[^>]+href="https:\/\/example\.com\/projeto"/)
})

test('HTML e atributos vindos do texto permanecem escapados', () => {
  const html = render('<script>alert(1)</script>\n<img src=x onerror="alert(2)">\n**<svg onload=alert(3)>**')
  assert.doesNotMatch(html, /<(?:script|img|svg)\b|dangerouslySetInnerHTML/)
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/)
  assert.match(html, /<strong>&lt;svg onload=alert\(3\)&gt;<\/strong>/)
})

test('código com URL é literal e nunca cria link', () => {
  assert.doesNotMatch(render('`https://example.com/**x**`'), /<a\b|<strong>/)
  assert.doesNotMatch(render('```html\n<a href="javascript:alert(1)">texto</a>\n```'), /<a\b/)
})

test('referências locais antigas viram links somente com contexto de projeto', () => {
  const renderDocument = (text: string, streaming = false) => renderToStaticMarkup(<DocumentLinks.Provider value={{ openDocument: () => {} }}><MessageText text={text} streaming={streaming} /></DocumentLinks.Provider>)
  assert.match(renderDocument('**O plano está em `planejamentos/fase1-station.md`**.'), /<strong>O plano está em <a[^>]+class="chat-link document-link"[^>]*><code>planejamentos\/fase1-station.md<\/code><\/a><\/strong>/)
  assert.match(renderDocument('[Plano](<docs/Plano completo.md>)'), /class="chat-link document-link"/)
  assert.match(renderDocument('Veja README.md.'), /<a[^>]+>README.md<\/a>\./)
  assert.doesNotMatch(renderDocument('```sh\ncat README.md\n```'), /<a\b/)
  assert.doesNotMatch(renderDocument('`README.md', true), /<a\b/)
  assert.doesNotMatch(render('`README.md`'), /<a\b/)
  assert.doesNotMatch(renderDocument('[Chave](file:///secret.md)'), /<a\b/)
  assert.equal((renderDocument('[`README.md`](README.md)').match(/<a\b/g) || []).length, 1)
})

test('leitor renderiza tabelas sem executar HTML', () => {
  const html = render('| Etapa | Situação |\n| --- | --- |\n| 1 | **Pronto** |\n| 2 | <script>evil()</script> |')
  assert.match(html, /<table><thead>/)
  assert.match(html, /<td><strong>Pronto<\/strong><\/td>/)
  assert.doesNotMatch(html, /<script>/)
  assert.match(html, /&lt;script&gt;/)
})

test('documento mantém continuação e hierarquia das listas', () => {
  const html = render('- **Primeiro** trecho\n  continuação do mesmo item.\n- **Categorias**\n  - Origem A\n  - Origem B\n- Conclusão\n\nFim.')
  assert.match(html, /<li><p><strong>Primeiro<\/strong> trecho<br\/>continuação do mesmo item\.<\/p><\/li>/)
  assert.match(html, /<li><p><strong>Categorias<\/strong><\/p><ul><li>Origem A<\/li><li>Origem B<\/li><\/ul><\/li><li>Conclusão<\/li><\/ul><p>Fim\.<\/p>/)
})
