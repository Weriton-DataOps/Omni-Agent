# Omni

Fonte única do núcleo cognitivo do Omni.

Este repositório contém somente o que governa sua identidade, memória, montagem de contexto e entrada
no Claude Code. Estado pessoal, conversas, credenciais, áudio, aplicações e artefatos de execução não
pertencem ao Git.

## Estrutura

```text
Omni/
├── .claude-plugin/                 manifestos do Claude Code
├── contratos/
│   ├── personalidade/              identidade canônica versionada
│   ├── memoria/                    formato dos registros persistentes
│   ├── contexto/                   formato das projeções fast e deep
│   ├── capacidades/                capacidades realmente disponíveis
│   └── atualizacao/                detecção segura da versão publicada
├── docs/
│   ├── OMNI-ESPECIFICACAO-MESTRE.md
│   ├── arquitetura-ativa.md
│   └── cobertura.md
├── hooks/                          ciclo de contexto por turno no Claude Code
├── runtime/                        memória e montagem de contexto
├── scripts/                        operador portátil
├── skills/omni/                    entrada `/omni:omni`
└── testes/                         gates locais, sem chamadas pagas
```

## Fluxo ativo

```text
pedido
  ↓
skill Omni
  ├── personalidade escolhida pelo manifesto
  ├── capacidades declaradas
  └── recuperação híbrida da memória confirmada
          ├── semântica local + lexical
          └── escopo + recência + frequência + confiança + importância
          ↓
   fotografia canônica
      ├── fast
      └── deep
          ↓
       resposta
```

Depois de `/omni:omni`, um hook do plugin repete a montagem em cada mensagem da mesma sessão. Assim,
preferências confirmadas depois de uma atualização ou em outra sessão não dependem de o modelo
lembrar de chamar manualmente o runtime.

Na ativação, o Omni compara a versão instalada com o manifesto público. Ele avisa quando houver
versão mais recente e continua normalmente se a rede estiver indisponível.

Por pedido explícito, `/omni:omni atualizar` confere a origem, atualiza e valida o pacote. Quando a
versão carregada mudar, a interface nativa do VS Code usa `/plugin` → **Restart**; no terminal,
`/reload-plugins`. A conversa atual continua aberta nos dois casos.

A especificação mestre governa o desenvolvimento, mas não é despejada automaticamente em cada
conversa. O runtime seleciona apenas o contexto relevante.

A recuperação de memória usa `hybrid-local-v1`: conceitos versionados e similaridade textual local,
sem embeddings remotos. Um ranking único alimenta fast e deep e registra somente diagnóstico sem o
texto integral das memórias.

A manutenção usa `memory-gc-safe-v1`: expira prazos explícitos, arquiva candidatas antigas de baixo
sinal e une duplicatas exatas. Registros retirados da memória ativa permanecem no arquivo local.
Semelhanças aproximadas só viram propostas; atualização, obsolescência e consolidação exigem pedido
explícito.

## Memória

Os dados vivem em `%APPDATA%\omni\memory\memory.json`, fora deste repositório:

- pedido explícito para lembrar: memória confirmada;
- lição observada: candidata;
- candidata: só entra no contexto depois de confirmação;
- possível segredo: recusado;
- conversa comum: não é gravada automaticamente.

Na primeira ativação, o plugin cria essa casa local. Quando uma atualização altera o formato, o
runtime aplica as migrações versionadas em `contratos/memoria/migrations.json` sem copiar a memória
para o Git e sem substituir os registros existentes.

## Uso

```text
/omni:omni
/omni:omni atualizar
/omni:omni contexto <tema>
/omni:omni experiencia <texto>
/omni:omni candidatas
/omni:omni arquivo
/omni:omni manutencao simular
/omni:omni manutencao
/omni:omni lembrar <texto>
/omni:omni licao <texto>
/omni:omni atualizar-memoria <id> <novo texto>
/omni:omni obsoleta <id> <razão>
/omni:omni consolidar <id1,id2> <texto canônico>
```

## Verificação

```powershell
npm.cmd run check
npm.cmd test
claude plugin validate .
```

Leia [docs/arquitetura-ativa.md](docs/arquitetura-ativa.md) antes de ampliar o runtime.
