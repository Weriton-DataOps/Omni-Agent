# Omni

Núcleo canônico de um único agente pessoal: conversa, continuidade de trabalho, memória, contexto,
execução e aprendizado operacional. Interface, chat e Realtime permanecem adiados até a validação
conversacional do núcleo.

## O que funciona hoje

```text
pedido
  ↓
personalidade + contexto + memória + estado vivo
  ↓
conversa ou execução/delegação
  ↓
auditoria do turno + evidência verificada
  ↓
aprendizado local
  ↓
regra/procedimento/eval/capacidade portável
```

O plugin escuta mensagens, ferramentas, falhas, subagentes, tarefas e encerramentos. Preferências
estáveis podem ser confirmadas automaticamente; correções geram observações de falha e melhorias;
conclusões verificadas alimentam atalhos. O contexto seguinte recebe apenas o recorte relevante.
Uma conferência diária assíncrona percorre somente sessões ativadas pelo Omni, recupera lacunas dos
sensores e reconhece rotinas repetidas. Evidências já capturadas não são contadas novamente.

Ao atingir o limiar de padrão de falha, uma candidata entra numa fila idempotente. O próximo turno
disponível reivindica no máximo um trabalho, registra `dispatch-requested` e entrega o briefing ao
host. Somente hooks de início provam que um executor realmente começou; uma instrução ou despacho,
sozinho, não prova execução. O ciclo não pede confirmação;
ele herda o objetivo, os alvos e os efeitos já autorizados. Risco muda a preparação — checkpoint,
isolamento, rollback ou compensação e leitura posterior. Somente uma expansão material do objetivo,
um efeito sem recuperação crível ou um novo segredo, privilégio ou compromisso financeiro exige uma
nova decisão. Publicação e promoção global continuam separadas.

Antes de encerrar um pedido executável, o Omni confronta pedido, ações, evidências e estado real. Uma
divergência solicita a correção e pode bloquear o encerramento uma única vez; ela não prova que o
reparo ocorreu. Relato de subagente não vale como sucesso até uma leitura
independente, registrada pela auditoria depois do relato e vinculada ao mesmo objeto. A auditoria sistêmica diária mede recorrência, cobertura de evidência, correção no mesmo
turno, delegações verificadas, efeito do aprendizado e resultados ou alegações de personalidade
registrados; observação real só existe quando uma rodada revisada a comprova.

## Separação de dados

```text
Git                                    %APPDATA%\omni
────────────────────────────           ───────────────────────────
personalidade e contratos              memória pessoal
runtime e hooks                        sessões e delegações
regras portáveis                       eventos resumidos
procedimentos portáveis                falhas e atalhos locais
testes e documentação                  evidências e votos em fingerprints
```

Conversa, resposta bruta, log bruto, erro bruto, credencial e dado pessoal permanecem fora do
repositório. O feedback explícito sobre a personalidade guarda somente fingerprints, polaridade e
dimensões; ajusta a resposta seguinte de forma reversível e sinais repetidos viram candidatas
revisáveis, nunca edição silenciosa da identidade.

## Estrutura

```text
Omni/
├── .claude-plugin/          manifesto e marketplace
├── contratos/              arquitetura, contexto, memória, operação, evals e personalidade
├── docs/                   arquitetura, cobertura e validação
├── hooks/                  sensores do ciclo do Claude Code
├── runtime/                motores do Omni
├── scripts/                operador PowerShell
├── skills/omni/            entrada /omni:omni
└── testes/                 gates locais sem chamadas pagas
```

## Uso principal

```text
/omni:omni
/omni:omni atualizar
/omni:omni estado
/omni:omni contexto <tema>
/omni:omni ciclo
/omni:omni delegacoes
/omni:omni melhorias
/omni:omni varredura
/omni:omni auditoria-sistema
```

O operador técnico também expõe `delegacao-preparar`, `delegacao-estado`,
`melhoria-operacional-promover`, `auditoria-sistema` e `eval-comportamental` por
`scripts/omni.ps1`. Para conferir um dia específico:

```powershell
# O retorno traz dispatch.prompt completo; o estado local guarda somente fingerprints.
.\scripts\omni.ps1 delegacao-preparar --destino executor --prompt "Corrija e teste" --sessao sessao-123 --efeitos "editar|testar" --risco reversible --alcance local-isolated --dados project --modo proceed

# Checkpoint e rollback também atravessam a API pública sem serem persistidos em texto bruto.
.\scripts\omni.ps1 delegacao-estado delegation-UUID running --evidencia agent-start-123 --checkpoint snapshot-123 --rollback restore-123
```

Por padrão, `delegacao-preparar` emite autoridade `owner-intent` herdada e publica o briefing no
estado `visible`. O retorno traz o `delegationId`; todo evento posterior precisa repetir esse ID, e o
adaptador recusa início sem correlação em vez de escolher uma delegação por proximidade. A automação
de falhas preserva o mesmo ID no binding do trabalho para que o hook nativo possa traduzi-lo. A sessão
precisa ter um turno ativo aberto pelo hook; o envelope guarda apenas o fingerprint desse vínculo. `--fonte` e
`--pai` permitem continuar uma autoridade realmente existente no ciclo — um hash inventado é recusado.
Risco altera o preparo, não retira silenciosamente a liberdade de executar dentro do objetivo autorizado.

Para promover `reported` a `verified`, use os IDs de uma ação e de sua evidência `state-readback` na
auditoria (`--acao-auditoria` e `--evidencia-auditoria`). Texto livre em `--evidencia` não prova a
verificação. O prompt integral aparece em `dispatch.prompt`, mas não é persistido no estado do Omni.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\omni.ps1 varredura-dia --data 2026-08-26 --forcar
```

A varredura roda também na abertura da sessão e, no máximo uma vez por hora, após uma resposta. Ela
é uma rede de conferência; o aprendizado por hooks continua sendo o caminho principal.

O comando de varredura coleta, deduplica e classifica evidências locais; ele não publica arbitrariamente
toda candidata encontrada. Quando a varredura é solicitada pelo proprietário, a instrução operacional do Omni
manda o agente continuar, no mesmo fluxo autorizado, com avaliação, materialização portátil, gates,
commit, push e confirmação do `origin/main`. O relatório final precisa separar o que foi encontrado,
o que valeu publicar e o que possui comprovação remota. A manutenção automática em segundo plano
permanece silenciosa. Ela pode acionar o fluxo autônomo estritamente controlado de personalidade;
nesse fluxo, publicação só ocorre depois de eval aprovado, gates, commit versionado, push confirmado,
instalação e readback do mesmo fingerprint.

Uma única configuração local liga o aprendizado ao repositório fonte:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\omni.ps1 repo-configurar --caminho "C:\caminho\do\Omni"
```

O caminho fica em `%APPDATA%\omni\config`, fora do Git. Depois disso, uma melhoria operacional
repetida e pronta pode ser materializada no artefato correspondente, mas permanece como
`materialized-pending-release`. Ela só conta como aprendizado efetivo depois que uma release íntegra
for instalada, o artefato for relido nessa instalação e o estado chegar a `installed-verified`.
Se uma skill materializada for formalmente retirada e substituída por correção de runtime, o
readback encerra o registro como `retracted`, preservando a prova da troca sem fingir que a skill foi
instalada. Se uma entrada declarativa antiga for explicitamente incorporada por uma candidata
canônica instalada, ela termina como `superseded`; não conta como efeito e não fica presa para sempre
na fila de release.
Mudanças de runtime, hook, roteamento ou capacidade entram em `implementation-required` e são
encaminhadas automaticamente à fila de implementação pela porta neutra. O estado só avança quando um
arquivo executável real é vinculado ao candidato. Esse vínculo exige recibo hash-only da
auditoria: mutação no próprio artefato e readback posterior do mesmo alvo, ambos posteriores ao
estado `implementation-required`. Um arquivo que já existia, sozinho, não prova implementação.

O registro técnico desse vínculo usa
`melhoria-operacional-registrar-implementacao <id> --repo <raiz> --artefato <caminho-portátil>` com
os IDs das ações/evidências de mutação e readback produzidos pela auditoria. Ele só leva a
`materialized-pending-release`; gates, release instalada íntegra e readback ainda são necessários.

## Verificação

A identidade verificável da release vive em `contratos/atualizacao/integridade.json`. O manifesto do
plugin mantém apenas campos suportados; o runtime compara versão pública, versão canônica e
fingerprint do payload, preservando cache e marcando bundles antigos como não verificáveis.

```powershell
npm.cmd run check
npm.cmd test
npm.cmd pack --dry-run
claude plugin validate .
```

Leia [a arquitetura ativa](docs/arquitetura-ativa.md), a [cobertura real](docs/cobertura.md) e o
[Definition of Done reservado para 27/08/2026](docs/validacao/definition-of-done-2026-08-27.md).
