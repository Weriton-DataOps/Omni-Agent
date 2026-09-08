# ADR-003 — TypeScript emitido e release realmente carregada

**Status:** aceito em 2026-08-31.

## Contexto

O Omni precisa ganhar tipos sem perder sua identidade de núcleo independente nem acoplar o core ao
Overcore. Também havia duas fronteiras com falso sucesso: código executável fora do fingerprint e
release instalada tratada como se já estivesse carregada pelo host.

## Decisão

- a fonte nova vive em `src/**/*.ts` e o emit ESM distribuído em `dist/**/*.js`;
- `runtime/*.mjs` permanece como shim transitório apenas onde o host ainda exige o entrypoint atual;
- `dist/**`, `adaptadores/**` e todos os entrypoints referenciados entram no payload e no fingerprint;
- uma melhoria em `src/**/*.ts` controla um conjunto derivado exato: a fonte auditada e o emit
  `dist/**/*.js`; o gate exige todos os itens derivados e recusa qualquer extra;
- contratos JSON continuam validados em runtime; tipos TypeScript não substituem validação de I/O;
- o core do Omni depende de portas neutras. Integrações com Claude ou Overcore ficam em adapters;
- `installed-verified` é intermediário. Apenas `loaded-verified`, confirmado por um hook `SessionStart`
  executado pela mesma raiz, versão e fingerprint instaladas, encerra promoção e melhoria;
- transições de release usam o reducer compilado de `src/core/release`; o store é validado reproduzindo
  a transição canônica e não aceita um `loaded-verified` fabricado;
- publicação e `SessionStart` usam seções críticas curtas com lock e compare-and-swap por transação.
  Verificação de integridade, build, processos síncronos e rede nunca ficam dentro do lock do store;
- abrir workspace usa alvo literal/alias explícito e `expectedRepository`. Cwd nunca é fallback.

## Sequência incremental e gates

1. Fundação: compilação estrita, build determinístico e testes do emitido.
2. Personalidade/contexto: mover regras puras para `src/core`, casos de uso para `src/application` e
   integrações para `src/adapters`; manter shims finos.
3. Release/operação: modelar FSM como união discriminada e cortar o runtime para o reducer compilado
   (entregue para release, com CAS curto e teste de adulteração).
4. Demais fronteiras: migrar uma fatia vertical por vez, removendo cada shim apenas depois de trocar
   hooks/scripts e confirmar o pacote carregado.

Cada fase exige `typecheck`, testes da fonte, testes do emitido, build determinístico, cobertura de
entrypoints, fingerprint íntegro e teste do hook carregado. O ratchet é zero novos erros de tipo,
zero entrypoints fora do payload e zero estado terminal sem readback correspondente.

## Riscos e contenções

- divergência `src`/`dist`: build determinístico e teste sobre o emitido;
- duas FSMs concorrentes: cutover por fatia, com uma autoridade por transição;
- lost update entre publicação e hook: CAS por chave, preservando outras releases e adotando somente
  avanço monotônico compatível da mesma identidade;
- shim virar implementação permanente: backlog de remoção ligado a consumidores concretos;
- tipo esconder payload inválido: validação runtime de todo `unknown` externo;
- acoplamento ao Overcore: dependência somente por porta/adaptador, preservando ADR-002;
- instalação confundida com efeito: handshake síncrono de `SessionStart` com raiz, versão e fingerprint.

## Consequência

O Omni acompanha a disciplina arquitetural observada no Overcore sem copiar sua identidade ou seus
internos. TypeScript passa a reforçar fronteiras e estados; não vira uma reescrita total nem uma nova
fonte de verdade paralela.
