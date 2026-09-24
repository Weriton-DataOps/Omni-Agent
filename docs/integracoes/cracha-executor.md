# Crachá: uso pelo executor

A sessão recebe uma referência temporária e um comando `node …/use-cracha.mjs`. Não recebe o documento privado nem as senhas. O cliente consulta a ponte no processo principal do Desktop; somente o broker autenticado pelo Windows resolve os dados de conexão.

O caminho SSH está implementado: o broker abre um canal SSH criptografado e executa `psql` **no servidor**, não uma conexão PostgreSQL remota. Isso atende ao caso em que o `pg_hba` recusa o superusuário pela rede. Não é um terminal root aberto nem uma porta TCP pública.

## Como fornecer o acesso

No botão **Crachá** do mesmo card, anexe um JSON com este formato, preenchendo os valores apenas no painel privado:

```json
{
  "ssh": {
    "kind": "ssh",
    "host": "HOST_DO_SERVIDOR",
    "port": 22,
    "username": "USUARIO_SSH",
    "password": "SENHA_APENAS_NO_CRACHA"
  },
  "database": {
    "kind": "database",
    "engine": "postgresql",
    "host": "HOST_DO_SERVIDOR",
    "port": 5432,
    "username": "postgres",
    "database": "BANCO_DE_DESTINO"
  },
  "mode": "sudo-postgres"
}
```

`sudo-postgres` usa `sudo -n -u postgres` e o socket local do PostgreSQL. Depende da permissão **já existente** no servidor; não modifica permissões nem pede senha de sudo. Nesse modo não é necessário transmitir a senha PostgreSQL. O servidor deve ser Linux com `/usr/bin/sudo` e `/usr/bin/psql`.

Para autenticação PostgreSQL por senha no próprio servidor, use `mode: "password"` e acrescente `password` em `database`. Essa senha passa pelo stdin do canal criptografado, nunca pela linha de comando. Também se aceita `privateKey` e, se necessária, `passphrase` para SSH, dentro do limite de 2.400 bytes por acesso.

A chave do servidor precisa corresponder ao `known_hosts` da conta Windows do broker ou ao campo privado `ssh.hostKeySha256`. Chave desconhecida/incorreta retorna `host-key-required`; não existe aceitação automática de host desconhecido. Não use um fingerprint obtido de fonte não verificada.

Para acessos **já cadastrados** no Crachá, cada lado pode ser substituído por `{"credentialId":"ID_EXATO","version":1}`. O broker consulta a versão atual e recusa acesso expirado, revogado, inválido, suspeito ou substituído. Uma referência explícita é necessária; a ponte não escolhe outro banco por semelhança de nomes.

Depois de anexar, a mensagem pública pode ser: “Use os acessos do Crachá para consultar o catálogo e medir a atualização dos dados pelo SSH.” O coordenador fornece a referência e o cliente ao executor automaticamente. Anexar, por si só, não testa nem cadastra nada no cofre.

## Operações entregues

| Operação | Resultado |
| --- | --- |
| `postgres.catalog`, `page` 0–49 | Até 100 colunas de tabelas e materialized views por página; nomes, tipos e indicação temporal. |
| `postgres.freshness`, `schema`, `table`, `column` | Maior data da coluna temporal e instante da medição. |

Os mesmos comandos funcionam com acesso direto ou SSH: o transporte está fixado no Crachá, não nos argumentos da sessão. A ponte não recebe SQL livre, shell arbitrário, host/porta alternativos ou arquivos do executor. As operações acima são de leitura, com prazo de consulta e limite de saída. Escritas dos roteiros DW.2–DW.6 não estão implementadas por estes adaptadores.

## Ciclo e segurança

- Referência aleatória de 256 bits, vinculada a conversa, sessão, tarefa e raiz do projeto; prazo de 30 minutos, até 64 chamadas, uma em andamento por referência.
- Idempotência por `--call UUID`: repetir o mesmo identificador devolve o recibo, sem repetir a operação. Alterar a operação com o mesmo identificador é recusado. Falhas também consomem o identificador.
- Fim da tarefa, perda do vínculo vivo, expiração e encerramento do Desktop impedem novos usos. Uma operação já aceita termina ou alcança seu prazo; não se alega rollback remoto.
- Segredos temporários não entram em Store, prompt, histórico, arquivo intermediário ou argumentos de processo. O broker transmite apenas resultado limitado e sanitizado. Não há limpeza garantida de todas as cópias de strings no heap; o acesso é mantido somente em processos confiáveis de duração limitada.
- A referência de capacidade, ao contrário da senha, aparece no briefing da sessão e expira. O limite de segurança do sistema operacional continua sendo a conta Windows do proprietário; não se promete isolamento contra outro processo malicioso com a mesma conta que roube a referência.
- Broker privado em processo separado: espera de SSH não ocupa o broker de memória. O Desktop permanece disponível. Reinício revoga referências, não reproduz trabalho automaticamente.
- Recibos distinguem “ponte preparada”, “uso confirmado” e “operação não concluída”. Preparação não prova conexão; conexão não prova cadastro permanente.

## Implementação e validação

Entrada: `apps/omni-desktop/src/main/executor-access.ts`; cliente público: `apps/omni-desktop/scripts/use-cracha.mjs`; SSH: `apps/omni-desktop/scripts/ssh-executor.mjs`; fronteira de credenciais: `scripts/omni-credential-execution.ps1`.

Biblioteca SSH fixada no pacote do Desktop, não no núcleo sem dependências. APIs usadas: `Client.exec`, verificação de host e canais do [ssh2](https://github.com/mscdex/ssh2#client).

Os testes usam servidor SSH real de loopback e credenciais fictícias. O servidor de teste emula a saída do `psql`; isso valida transporte e integração, não dados nem permissões de produção. Para provar o caso real é necessário receber os acessos privados e medir a operação no servidor alvo.
