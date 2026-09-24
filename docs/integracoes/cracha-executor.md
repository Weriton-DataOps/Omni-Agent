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

Depois de anexar, a mensagem pública pode ser: “Use os acessos do Crachá para consultar o catálogo e medir a atualização dos dados pelo SSH.” O coordenador fornece a referência e o cliente ao executor automaticamente. Anexar, por si só, não testa a conexão nem cria um cadastro definitivo: primeiro preserva o contexto criptografado, antes de confirmar o recebimento.

Ao pedir para **guardar ou usar** o acesso, o runtime cadastra os componentes no cofre Windows e registra os metadados no banco, **sem exigir teste de conexão**. O estado é não validado até existir evidência real de uso. A instrução expressa de uso somente temporário (`persist: false` no plano interpretado) preserva essa exceção. Não há senha no banco de conversas nem no prompt do modelo.

O contexto privado anterior ao cadastro é protegido por DPAPI da conta Windows, com retenção de 30 dias, em `desktop/private-context/*.sealed` dentro de `OMNI_HOME` (por padrão `%APPDATA%/omni`). Depois do cadastro completo, esse arquivo passa a conter apenas referências protegidas e o vínculo com a tarefa/projeto, sem o texto original. Reiniciar o Desktop ou ocultar a janela não apaga o acesso recebido. Erro de criptografia ou gravação impede a confirmação de recebimento; não existe fallback em texto claro.

Nas próximas mensagens, o coordenador recebe um inventário seguro dos contextos e cadastros, mesmo sem novo anexo. Vínculos cadastrados podem ser retomados em outro card do mesmo projeto. Credenciais avulsas preexistentes também entram no inventário por referência; o acesso interno do broker do Omni é excluído. A disponibilidade de um cadastro não significa que existe adaptador para qualquer serviço. Indisponibilidade do inventário é informada como falha de consulta, não como ausência de credenciais.

Não há frase obrigatória: o modelo interpreta a mensagem inteira e o histórico. Restrições como “não execute as outras etapas” limitam a tarefa, não negam automaticamente a leitura autorizada. A interpretação produz um plano privado validado pelo runtime; uma confirmação contextual pode reutilizar um anexo anterior ainda disponível na mesma conversa. Consulte a [validação da interpretação semântica](../validacao/2026-09-24-interpretacao-semantica-cracha.md).

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
- Segredos não entram em Store, prompt, histórico, arquivo intermediário em texto claro ou argumentos de processo. O contexto anterior ao cadastro é persistido criptografado; o valor cadastrado fica no Gerenciador de Credenciais do Windows. O broker transmite apenas resultado limitado e sanitizado. Não há limpeza garantida de todas as cópias de strings no heap; somente processos confiáveis tratam os valores.
- A referência de capacidade, ao contrário da senha, aparece no briefing da sessão e expira. O limite de segurança do sistema operacional continua sendo a conta Windows do proprietário; não se promete isolamento contra outro processo malicioso com a mesma conta que roube a referência.
- Broker privado em processo separado: espera de SSH não ocupa o broker de memória. O Desktop permanece disponível. Reinício revoga referências, não reproduz trabalho automaticamente.
- Recibos distinguem “ponte preparada”, “uso confirmado” e “operação não concluída”. Preparação não prova conexão; conexão não prova cadastro permanente.

## Implementação e validação

Entrada: `apps/omni-desktop/src/main/executor-access.ts`; cliente público: `apps/omni-desktop/scripts/use-cracha.mjs`; SSH: `apps/omni-desktop/scripts/ssh-executor.mjs`; fronteira de credenciais: `scripts/omni-credential-execution.ps1`.

Biblioteca SSH fixada no pacote do Desktop, não no núcleo sem dependências. APIs usadas: `Client.exec`, verificação de host e canais do [ssh2](https://github.com/mscdex/ssh2#client).

Os testes usam servidor SSH real de loopback e credenciais fictícias. O servidor de teste emula a saída do `psql`; isso valida transporte e integração, não dados nem permissões de produção. Para provar o caso real é necessário receber os acessos privados e medir a operação no servidor alvo.

A prova de persistência, recuperação e cadastro está em [Crachá: cadastro e recuperação](../validacao/2026-09-24-cracha-cadastro-recuperacao.md). Ela inclui DPAPI real entre dois processos Electron, retomada pelo Controller e decisões do modelo real, sem usar credenciais de produção.
