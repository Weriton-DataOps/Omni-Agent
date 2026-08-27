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
evidência
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

## Separação de dados

```text
Git                                    %APPDATA%\omni
────────────────────────────           ───────────────────────────
personalidade e contratos              memória pessoal
runtime e hooks                        sessões e delegações
regras portáveis                       eventos resumidos
procedimentos portáveis                falhas e atalhos locais
testes e documentação                  evidências em fingerprints
```

Conversa, log bruto, erro bruto, credencial e dado pessoal permanecem fora do repositório.

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
```

O operador técnico também expõe `delegacao-preparar`, `delegacao-estado` e
`melhoria-operacional-promover` por `scripts/omni.ps1`. Para conferir um dia específico:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\omni.ps1 varredura-dia --data 2026-08-26 --forcar
```

A varredura roda também na abertura da sessão e, no máximo uma vez por hora, após uma resposta. Ela
é uma rede de conferência; o aprendizado por hooks continua sendo o caminho principal.

Uma única configuração local liga o aprendizado ao repositório fonte:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\omni.ps1 repo-configurar --caminho "C:\caminho\do\Omni"
```

O caminho fica em `%APPDATA%\omni\config`, fora do Git. Depois disso, uma melhoria operacional
repetida e pronta é materializada automaticamente no artefato correspondente.

## Verificação

```powershell
npm.cmd run check
npm.cmd test
claude plugin validate .
```

Leia [a arquitetura ativa](docs/arquitetura-ativa.md), a [cobertura real](docs/cobertura.md) e o
[Definition of Done reservado para 27/08/2026](docs/validacao/definition-of-done-2026-08-27.md).
