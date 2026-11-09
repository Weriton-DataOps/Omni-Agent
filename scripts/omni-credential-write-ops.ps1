# Adaptadores de ESCRITA do crachá — CARDÁPIO FECHADO (allowlist), não denylist.
# Espelha o padrão read-only de omni-credential-execution.ps1: nada de SQL arbitrário; cada operação valida os
# parâmetros e monta um SQL específico. DROP DATABASE/TABLE, TRUNCATE e DELETE em massa NÃO existem como operação,
# então não há o que uma denylist tentar pegar — é muralha, não peneira.
#
# Fase 1 (este arquivo): só o construtor de SQL + validação. Sem execução, sem credencial, sem segredo.
# A execução transacional (com log e espelho ao dono) e a intake de credencial no crachá vêm nas fases seguintes,
# reaproveitando scripts/omni-credential-execution.ps1 (psql direto) e ssh-executor.mjs (psql no servidor via SSH).
#
# Reversibilidade embutida onde dá: CREATE ... IF NOT EXISTS / ADD COLUMN IF NOT EXISTS nunca alteram nem apagam o
# que já existe; criam só o que falta. Cada operação tem um 'reverter' declarado, para o log registrar o desfazer.

$script:IDENT = '^[a-zA-Z_][a-zA-Z0-9_]{0,62}$'
$script:TIPOS = @('text', 'integer', 'bigint', 'boolean', 'numeric', 'date', 'timestamp', 'timestamptz', 'uuid', 'jsonb')

function Assert-WriteIdent([string]$valor, [string]$campo) {
  if ($valor -cnotmatch $script:IDENT) { throw "Identificador invalido em '$campo': use [a-zA-Z_][a-zA-Z0-9_]{0,62}" }
  if ($valor -in @('postgres', 'pg_catalog', 'information_schema') -or $valor.StartsWith('pg_')) { throw "Identificador reservado nao permitido em '$campo': $valor" }
  return $valor
}

# Devolve @{ sql = '...'; efeito = 'descricao'; reverter = 'SQL para desfazer, ou vazio se irreversivel-mas-seguro' }.
# Uma operação sem 'reverter' seguro simplesmente não entra no cardápio.
function Get-CredentialWriteSql($Operation) {
  $kind = [string]$Operation.kind
  switch ($kind) {

    # Cria papel de login (sem senha; a senha vem por operacao propria, com hash, na fase de execucao).
    'postgres.create-login-role' {
      $role = Assert-WriteIdent $Operation.role 'role'
      $limite = 3
      if ($null -ne $Operation.connectionLimit) { $limite = [int]$Operation.connectionLimit; if ($limite -lt 1 -or $limite -gt 20) { throw 'connectionLimit fora de 1..20' } }
      return @{
        sql      = "CREATE ROLE ""$role"" LOGIN CONNECTION LIMIT $limite; ALTER ROLE ""$role"" SET statement_timeout='120s'; ALTER ROLE ""$role"" SET idle_in_transaction_session_timeout='5min';"
        efeito   = "cria papel de login $role (limite $limite conexoes)"
        reverter = "DROP ROLE IF EXISTS ""$role"";"
      }
    }

    # Da leitura a um papel via grupo leitor ja existente e cura (ex.: growth_reader) e tranca em leitura.
    'postgres.grant-reader' {
      $role = Assert-WriteIdent $Operation.role 'role'
      $grupo = Assert-WriteIdent $Operation.readerRole 'readerRole'
      return @{
        sql      = "GRANT ""$grupo"" TO ""$role""; ALTER ROLE ""$role"" SET default_transaction_read_only=on;"
        efeito   = "da leitura de $grupo a $role e tranca em leitura"
        reverter = "REVOKE ""$grupo"" FROM ""$role"";"
      }
    }

    # Acrescenta coluna nova (idempotente). Nunca altera tipo nem remove coluna existente.
    'postgres.add-column' {
      $schema = Assert-WriteIdent $Operation.schema 'schema'
      $tabela = Assert-WriteIdent $Operation.table 'table'
      $coluna = Assert-WriteIdent $Operation.column 'column'
      $tipo = [string]$Operation.type
      if ($tipo -notin $script:TIPOS) { throw "Tipo nao permitido: $tipo (use um de: $($script:TIPOS -join ', '))" }
      return @{
        sql      = "ALTER TABLE ""$schema"".""$tabela"" ADD COLUMN IF NOT EXISTS ""$coluna"" $tipo;"
        efeito   = "acrescenta coluna $schema.$tabela.$coluna ($tipo)"
        reverter = "ALTER TABLE ""$schema"".""$tabela"" DROP COLUMN IF EXISTS ""$coluna"";"
      }
    }

    # Cria tabela nova (idempotente) a partir de uma spec de colunas validada. Nunca mexe em tabela existente.
    'postgres.create-table' {
      $schema = Assert-WriteIdent $Operation.schema 'schema'
      $tabela = Assert-WriteIdent $Operation.table 'table'
      if ($null -eq $Operation.columns -or @($Operation.columns).Count -lt 1 -or @($Operation.columns).Count -gt 60) { throw 'columns: informe de 1 a 60 colunas' }
      $defs = foreach ($c in @($Operation.columns)) {
        $cn = Assert-WriteIdent $c.name 'columns[].name'
        $ct = [string]$c.type
        if ($ct -notin $script:TIPOS) { throw "Tipo nao permitido em coluna $cn : $ct" }
        """$cn"" $ct"
      }
      return @{
        sql      = "CREATE TABLE IF NOT EXISTS ""$schema"".""$tabela"" ($($defs -join ', '));"
        efeito   = "cria tabela $schema.$tabela com $(@($Operation.columns).Count) coluna(s)"
        reverter = "DROP TABLE IF EXISTS ""$schema"".""$tabela"";"
      }
    }

    default { throw "Operacao de escrita fora do cardapio: '$kind'" }
  }
}
