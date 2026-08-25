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
- a verificação apenas avisa, nunca atualiza nem reinicia o Claude sozinha;
- atualização continua passando por testes, commit, push e atualização do plugin;
- falha de consulta nunca impede o Omni de conversar.
