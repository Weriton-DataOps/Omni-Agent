# Catálogo de contratos

O arquivo `contratos/catalogo-contratos.json` é a lista canônica dos documentos JSON que fazem parte dos contratos do Omni. Seu escopo cobre `contratos/**` e JSON mantido em `src/**`; arquivos de ferramenta como `package.json` e `tsconfig*.json` não pertencem a esse domínio.

Cada entrada declara exatamente uma natureza:

- `schema`: JSON Schema canônico, com `$id`, fingerprint, origem do tipo/decoder e teste de paridade;
- `fixture`: caso sintético ou suíte de avaliação versionada;
- `policy`: configuração ou regra consumida pelo runtime;
- `store`: estado derivado versionado mantido no repositório.

Também são obrigatórios o componente proprietário, a validação runtime, a classificação de privacidade e a posição no payload (`direct`, `compiled` ou `excluded`). A posição dos documentos em `contratos/**` é conferida contra `contratos/atualizacao/integridade.json`.

Ao adicionar ou alterar JSON contratual, atualize o catálogo na mesma mudança e execute:

```text
npm run contracts:check
```

O gate falha para JSON sem classificação, referência inexistente, mudança de `$id` ou fingerprint, provenance TypeScript sem binding/paridade e divergência em relação às raízes do payload.
