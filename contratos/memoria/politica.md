# Política de memória

Esta política implementa as seções 20–23 da especificação mestre.

## Separação obrigatória

```text
Git público                          Store local
────────────────────────────         ────────────────────────────
engine e contratos                  preferências pessoais
schemas e migrações                 episódios confirmados
testes                              conhecimento aprendido
documentação                        procedimentos e candidatas
```

O Git nunca recebe automaticamente o conteúdo do store local. Essa fronteira protege privacidade,
evita publicar segredos e impede que uma atualização do plugin apague a história do usuário.

## Ciclo de atualização

```text
plugin atualizado
      ↓
primeira ativação
      ↓
ler schemaVersion local
      ├── atual       → usar sem reescrever
      ├── antiga      → migrar atomicamente
      └── mais nova   → recusar sem sobrescrever
```

Migrações são versionadas no Git. Dados continuam em `%APPDATA%\omni\memory\memory.json` ou na casa
definida por `OMNI_HOME`.

## Escrita

- pedido explícito pode virar memória confirmada;
- experiência inferida nasce candidata;
- possível segredo é recusado antes da criação do arquivo;
- candidata só é promovida após validação;
- conversa comum não é persistida automaticamente.

## Importação

Arquivos antigos nunca entram em lote. Cada item deve passar por classificação, escopo, evidência,
confiança e decisão de importar ou descartar.

## Evolução no Git

O crescimento possui duas trilhas diferentes:

```text
experiência pessoal → memória local confirmada ou candidata
aprendizado reutilizável e seguro → validação → eval → aprovação → contrato/capacidade versionada no Git
```

Código, schemas, migrações, contratos e aprendizados promovidos crescem no repositório. Conteúdo
pessoal bruto, conversa, credencial e evidência privada permanecem locais. Promoção nunca é automática:
ela exige retirar dados pessoais, demonstrar reutilização e passar pelo gate de avaliação.
