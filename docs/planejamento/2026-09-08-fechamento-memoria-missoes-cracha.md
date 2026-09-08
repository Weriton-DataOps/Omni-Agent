# Fechamento da rodada — memória, missões e Crachá

O corte de continuidade foi concluído no PostgreSQL exclusivo do Omni. A migration
`003-credential-observation-transaction` foi aplicada com checksum
`cafa328d1cb649ccb9134e92d5d1513d257762d39b2aad9e52cc53da1e8ee547` e expõe somente
a operação tipada de observação pelo broker local. Ela grava o evento append-only,
deduplica `eventId`, compara a revisão esperada e atualiza os metadados da credencial na
mesma transação. A prova real retornou `recorded` e a repetição retornou `duplicate`;
nenhuma senha, token ou blob saiu do cofre.

`UserPromptSubmit` agora sincroniza memória confirmada/candidata e missões ao broker de
forma idempotente. Na recuperação, missões ativas persistidas têm precedência sobre o
ciclo exclusivamente local; a estrutura local é apenas fallback quando o banco está
indisponível ou ainda não há missão. O readback real confirmou a missão ativa e sua
projeção no contexto. O broker em uso é `omni-access-broker-v8`; a borda fixa UTF-8 para
preservar texto em português durante o readback do PostgreSQL.

Validação concluída nesta rodada: TypeScript, arquitetura, pacote e a suíte completa
passaram; `claude plugin validate .` passou. A instalação produtiva ainda permanece
`omni@omni-hub` 0.22.0 porque o marketplace configurado aponta para o commit remoto
`6f9ffa9`, enquanto a candidata 0.22.1 ainda está no worktree local. Não foi forjada
uma entrada de cache nem alterado o registro de plugins manualmente: publicar essa
candidata em um commit remoto verificado é o próximo corte de release, seguido de
`claude plugin update omni@omni-hub` e readback da instalação.
