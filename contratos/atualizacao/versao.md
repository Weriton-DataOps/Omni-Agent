# Contrato de detecção de versão

O Omni verifica sua versão quando é ativado. A consulta lê somente o manifesto público do
repositório e nunca envia memória, conversa, credencial ou estado pessoal.

```text
manifest instalado
      ↓
GET API pública de conteúdo do GitHub
      ↓
comparar semver
      ├── current  → seguir em silêncio
      ├── outdated → avisar instalada → mais recente
      ├── ahead    → versão local à frente do remoto
      └── unknown  → seguir sem bloquear
```

O ETag e o SHA do arquivo remoto são guardados em `%APPDATA%\omni\updates\version-check.json`. Em
falha de rede, o último resultado válido pode ser usado como cache antigo, identificado por
`source: stale-cache`.

## Regras

- toda alteração funcional do plugin aumenta a versão semântica;
- documentação sem impacto de execução não exige aumento;
- a verificação automática apenas avisa, nunca atualiza nem reinicia o Claude sozinha;
- `/omni:omni atualizar` é a única atualização iniciada pelo Omni e exige pedido explícito;
- a saída visível desse comando contém somente a transição de versão, os itens versionados em
  `releases.json` e o estado interno da ativação; ela nunca transfere recarga, comando ou checklist
  ao proprietário;
- estado, personalidade, diagnóstico, caminhos, repositório e detalhes internos não aparecem nessa saída;
- antes de atualizar, o runtime confirma que `omni-hub` aponta para
  `https://github.com/Weriton-DataOps/Omni-Agent`;
- o fluxo atualiza o marketplace, atualiza `omni@omni-hub` e valida a versão instalada pela lista
  do Claude e, quando disponível, pelo manifesto público do GitHub;
- se o pacote carregado ficou antigo, a instalação permanece `awaiting-reload` sob responsabilidade
  do worker interno até que um mecanismo programático seguro do host produza nova inicialização;
- o processo atualmente carregado não consegue substituir a própria raiz em execução. O worker
  preserva a pendência e o próximo `SessionStart` compatível confirma o readback da nova raiz;
- ausência de mecanismo programático seguro nunca vira instrução operacional. Somente uma
  impossibilidade técnica que exija nova autoridade humana permite uma pergunta contextual única;
- o atualizador não lê nem transmite memória pessoal e não alega release efetiva antes do readback
  carregado;
- testes, versionamento, commit e push pertencem à produção da release, antes de ela ser publicada;
- o comando `atualizar` apenas instala a release já publicada, valida versão e fingerprint e executa
  o readback dos artefatos instalados;
- falha de consulta nunca impede o Omni de conversar.
