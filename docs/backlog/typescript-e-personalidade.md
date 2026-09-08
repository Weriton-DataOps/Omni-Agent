# Backlog — TypeScript, contexto e personalidade

## Planejamento consolidado em 08/09/2026

O [plano de implantação de memória, personalidade, autonomia e Crachá](../planejamento/2026-09-08-implantacao-memoria-autonomia.md)
reúne os achados A01–A07, o trabalho da sessão Claude de 04/09, as ideias da Ada e a inclusão do Crachá.
Missões duráveis foram aprovadas pelo proprietário, com implementação própria e evolução do ciclo
existente. A recomendação de memória é PostgreSQL canônico + projeções JSON/índices reconstruíveis.
O **Crachá ainda não está operacional**: sua fundação tipada e migration de metadados foram iniciadas;
centralizará os acessos usados e oferecidos pelo Omni,
com identidade, escopo, concessões, expiração/revogação e referências a um cofre separado da memória.
Por direcionamento do proprietário, sua base será PostgreSQL, com schemas, roles e políticas RLS
próprias. Segredos eventualmente guardados no banco serão cifrados com chave externa; o acesso
inicial ao próprio PostgreSQL não dependerá de consultar esse mesmo banco.
Bootstrap definido para Windows: credenciais por role no Gerenciador de Credenciais, sob a identidade
do componente confiável; configuração local contém somente parâmetros de conexão e referências.
Melhorias podem habilitar/materializar permissões já concedidas, via Crachá e sem pedir aprovação
novamente. Devem resolver a concessão de origem, preservar escopo/validade e registrar aplicação e
verificação; não recebem poder para criar autoridade além desse teto. A role de memória permanece
sem escrita direta nas concessões.
Cada credencial/token terá vencimento (`expires_at` com distinção entre desconhecido e sem expiração),
estado de funcionamento, última verificação/sucesso, instante e motivo da falha, e vínculo de renovação
ou substituição. Controle por versão; timeout ou falta de escopo não significam token inválido.
Verificação e renovação autorizada integram o ciclo durável, sem depender dele para bloquear token vencido.
Reaproveitar a base de autoridade existente não significa que o Crachá já esteja entregue.
Preparação C0 acompanha as correções; persistência C1 acompanha a memória; autorização aplicada C2
é condição para ativar missões autônomas e ampliar acessos oferecidos. Nenhum acesso novo foi concedido.
Implementação autorizada em 08/09: consultar o [registro de execução](../planejamento/2026-09-08-execucao-implantacao-omni.md).
Esse plano orienta a sequência atual; os estados “entregue” abaixo descrevem a fonte da rodada de
31/08, não comprovam instalação, comportamento ou fechamento das lacunas encontradas em 08/09.

> Revisado em 2026-08-31 após a auditoria do incidente Hub. Este é um backlog priorizado: não autoriza
> migração mecânica, publicação de release nem automação frágil de interface.

## Diagnóstico que orienta o backlog

No snapshot final local de 2026-08-31, o Omni possui 39 módulos runtime ESM (21.447 linhas), 42
fontes TypeScript (3.996 linhas), 42 emits JavaScript em `dist`, 47 arquivos de teste fonte (15.908
linhas) e 40 JSON sob `contratos`. O gate de pacote observa 44 arquivos totais em `dist` e zero
dependências produtivas. Esses números são inventário do snapshot, não contagem de testes aprovados
nem meta de volume.

A arquitetura decidida é `src/core` para regras puras, `src/application` para casos de uso,
`src/ports` para dependências neutras e `src/adapters` para o host. O emit preserva os mesmos caminhos
em `dist/**/*.js`; `runtime/*.mjs` é shim transitório. `dist/**` e `adaptadores/**` pertencem ao payload
fingerprintado. O Omni continua independente do Overcore e conversa com integrações somente por portas.

A auditoria também separou três problemas que pareciam um só:

- a personalidade era persistida por `session_id`, não por conversa/projeto;
- o limite inline de 9.500 caracteres preservava a persona e cortava a memória recuperada;
- “plugin instalado” era tratado como se significasse “runtime novo carregado”.

TypeScript ajuda a tornar esses estados explícitos. Ele não cria personalidade nem substitui teste de
comportamento no host real.

## Estado da rodada

1. verdade transacional da release e runtime carregado: entregue na fonte e no E2E de cópia instalada;
2. montagem de contexto por blocos prioritários: entregue;
3. abertura determinística de projeto no VS Code: entregue em porta/application/adapter TypeScript;
4. typecheck, arquitetura, contratos, pacote e emit: gates entregues;
5. personalidade/contexto críticos: primeira fatia vertical entregue com shims finos;
6. publicação, instalação e E2E no host Claude real: pendência externa desta rodada.

## BL-REL-01 — Separar pacote instalado de runtime carregado (entregue na fonte)

Modelar estados distintos:

```text
published → installed-verified → awaiting-reload → loaded-verified
```

`reloadRequired: true` não pode encerrar o efeito comportamental como verificado. `loaded-verified`
exige handshake emitido por um hook da nova raiz, com versão e fingerprint iguais aos publicados.

**Entregue:** reducer TypeScript usado pelo runtime, `installed-verified` intermediário, handshake do
hook instalado, CAS curto por transação, proteção contra store adulterado e E2E em cópia instalada com
integridade real. Publicação/instalação no host real permanece na seção de pendência externa.

## BL-CTX-01 — Montar contexto por blocos, sem `slice` cego (entregue)

Introduzir um contrato equivalente a:

```ts
type ContextBlock = {
  id: string
  priority: 'required' | 'high' | 'relevant' | 'optional'
  full: string
  compact?: string
  minChars: number
}
```

Objetivo, projeto/cwd, alvo literal, ajuste do proprietário, persona compacta e regras aprendidas
relevantes devem ter reserva explícita. O montador registra IDs completos, compactados e omitidos e
nunca corta XML, briefing ou regra no meio.

**Entregue:** o cenário simultâneo personalidade + memória + auditoria + dispatch fica abaixo de 9.500,
preserva os blocos obrigatórios e produz diagnóstico determinístico do que foi compactado.

## BL-OPS-01 — Tipar a abertura de projeto no VS Code (entregue)

Criar uma porta independente da automação de UI:

```ts
type OpenWorkspaceRequest = {
  literalTarget: string
  expectedRepository?: string
  reuseWindow?: boolean
  startClaudeSession?: boolean
  briefing?: string
}

type OpenWorkspaceResult =
  | { state: 'workspace-opened'; canonicalPath: string; evidence: string }
  | { state: 'claude-panel-opened'; canonicalPath: string; evidence: string }
  | { state: 'session-visible'; sessionId: string; evidence: string }
  | { state: 'briefing-delivered'; sessionId: string; evidence: string }
  | { state: 'blocked'; reason: string; lastVerifiedState: string }
```

O caminho literal prevalece sobre apelidos e referências históricas. A implementação deve usar uma
integração suportada da extensão; não deve canonizar terminal externo, `MainWindowTitle`, SendKeys ou
URI inventada.

**Entregue:** rejeita caminho inexistente, `expectedRepository` divergente e readback de outra janela;
valida o wrapper `code.cmd`, resolve `Code.exe` + `cli.js` dentro da mesma instalação e executa com
argumentos literais, sem shell e com timeout. O alvo literal prevalece, e pedido enviado não é
confundido com workspace confirmado. Painel, sessão e briefing continuam estados distintos e não são
fabricados pelo adapter.

## BL-TS-00 — Fundação de typecheck e build (entregue)

O baseline já possui dependências fixadas, `tsconfig` separado para typecheck/build/teste, emit ESM e
teste do build determinístico. O gate executável é:

```text
typecheck → build:ts → build:test:ts → testes fonte+emitido → build determinístico
```

A próxima expansão aumenta a cobertura por fatias verticais, mantendo zero erros no baseline em vez
de aceitar uma dívida crescente de diagnósticos.

**Aceite:** baseline versionada de erros; o número só diminui. Novo `any`, `@ts-ignore` ou cast inseguro
exige justificativa local e não pode aumentar o ratchet.

## BL-TS-01 — Tipar fronteiras como `unknown`

Começar por dados que vêm de fora do processo:

- entradas e saídas de hooks;
- JSON lido do disco;
- argumentos e resultados do operador CLI;
- eventos de ferramenta, delegação e auditoria;
- respostas do host de instalação/readback.

Validar em runtime antes de estreitar os tipos. Interfaces TypeScript não substituem validação de JSON.

**Aceite:** campo ausente, enum desconhecido e payload incompatível falham com diagnóstico explícito,
sem cair silenciosamente para um estado aparentemente válido.

## BL-TS-02 — Uma fonte de verdade para os contratos JSON

O repositório tem dezenas de documentos JSON e apenas parte deles possui schema. Adotar a direção:

```text
JSON Schema canônico → tipos TypeScript gerados
```

Completar primeiro os schemas de personalidade, contexto, auditoria, ciclo operacional, candidatas e
release. A geração deve ser determinística e conferida no CI.

**Aceite:** divergência entre schema, fixture e tipo gerado quebra o gate; não existem duas definições
manuais concorrentes do mesmo contrato.

## BL-TS-03 — Modelar máquinas de estado com uniões discriminadas (release entregue)

Tipar release, melhoria, delegação e eval por estágio, para que campos de um estágio concluído não
possam existir numa transação ainda preparada. Exemplo: `readback` só é obrigatório em
`loaded-verified`, nunca em `prepared`.

**Entregue em release:** transições ilegais falham no reducer e no validador do store; fonte TypeScript
e emit são o conjunto determinístico da mudança. Delegação e eval permanecem fatias internas futuras.

## BL-TS-04 — Migrar o caminho crítico da personalidade

Ordem recomendada:

1. `personalidade.mjs`;
2. `ajustes-personalidade.mjs` e `feedback-personalidade.mjs`;
3. `eval-personalidade.mjs` e executor;
4. `contexto.mjs` e montador de blocos;
5. `hook-contexto.mjs`;
6. observador, auditoria e ciclo de release.

**Aceite:** `PersonalityManifest`, `ActivePersonality`, ajustes, feedback, casos de eval, hook I/O e
evidência de promoção atravessam o circuito sem casts opacos.

## BL-TS-05 — Build e pacote determinísticos (fundação entregue; cutover incremental)

A decisão está tomada: fonte TypeScript compilada para JavaScript ESM executável no pacote. Cada
cutover precisa manter os hooks portáteis e obedecer a ordem:

```text
build → testes sobre o emitido → fingerprint → pacote → instalação → loaded readback
```

O emit usa `.js` ESM sem source map no pacote, preserva a árvore de `src` em `dist` e é limpo antes de
cada build sem alterar um artefato já fingerprintado.

**Aceite:** duas builds do mesmo commit geram o mesmo payload e fingerprint; os testes exercitam o que
será instalado, não apenas a fonte.

## BL-PER-01 — Teste E2E do plugin realmente carregado (local entregue; host real pendente)

Além dos testes unitários do módulo, executar uma sessão nova pelo host/plugin instalado e observar a
saída real. Cobrir:

- ativação opt-in persistente no mesmo cwd central;
- outro cwd e sidechain/executor permanecendo neutros;
- `startup`, `resume`, `compact` e `clear`;
- turno curto e turno após ferramenta;
- personalidade + memória + auditoria + dispatch no mesmo evento;
- falha de contexto e limite de 9.500;
- handshake de versão/fingerprint do runtime carregado.

**Entregue localmente:** o teste copia o pacote, recalcula integridade da cópia, executa o
`SessionStart` a partir do hook instalado e prova que fonte/instalação isoladas não fecham a release.

**Pendente externo:** publicar o fingerprint final, instalar a release, reiniciar o host Claude e
observar numa conversa real tanto o handshake quanto a aderência comportamental. A presença do texto
continua não sendo aceita como prova suficiente de personalidade.

## BL-PER-02 — Eval comportamental real e reproduzível

Comparar baseline e candidata com o mesmo modelo/configuração e conversas selecionadas pelo
proprietário, sem guardar diálogo bruto no Git. Medir identidade reconhecível, ausência de resposta
genérica, analogia útil, humor contextual, sarcasmo adequado, iniciativa dentro do escopo e
consistência depois de ferramentas.

**Aceite:** nenhum caso de peso máximo falha, a candidata supera a baseline e Weriton reconhece a voz
em conversa nova, longa e após ferramentas.

## Definition of Done geral

- `npm run typecheck` cobre o caminho crítico e tem ratchet não crescente;
- schemas e tipos têm uma única fonte de verdade;
- blocos obrigatórios de contexto nunca somem silenciosamente;
- abertura de workspace preserva alvo literal e reporta somente estados comprovados;
- release distingue instalado de carregado;
- testes E2E exercitam o plugin carregado e separam entrega de comportamento;
- a migração não mistura Omni com Overcore nem altera fronteiras externas.

## Pendência externa única desta rodada

Publicar e instalar a release final, abrir uma sessão nova do host real e capturar o recibo
`loaded-verified` da mesma raiz, versão e fingerprint. Depois disso, executar o eval comportamental com
conversas escolhidas pelo proprietário. Nenhum gate local autoriza afirmar antecipadamente que essa
etapa externa ocorreu.
