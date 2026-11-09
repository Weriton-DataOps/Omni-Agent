# Teste do cardapio de escrita (Get-CredentialWriteSql). Puro: nao executa nada, nao toca banco.
$ErrorActionPreference = 'Stop'
. (Join-Path (Split-Path -Parent $PSScriptRoot) 'scripts/omni-credential-write-ops.ps1')

$falhas = 0
function Ok($cond, $nome) { if ($cond) { "  ok  $nome" } else { $script:falhas++; "  XX  $nome" } }
function Recusa($bloco, $nome) {
  try { & $bloco; $script:falhas++; "  XX  $nome (deveria ter recusado)" }
  catch { "  ok  $nome (recusado: $($_.Exception.Message.Substring(0,[Math]::Min(50,$_.Exception.Message.Length)))...)" }
}

'== aceita o valido'
$r = Get-CredentialWriteSql ([pscustomobject]@{ kind = 'postgres.create-login-role'; role = 'is_franco'; connectionLimit = 3 })
Ok ($r.sql -match 'CREATE ROLE "is_franco" LOGIN CONNECTION LIMIT 3') 'create-login-role monta SQL'
Ok ($r.reverter -match 'DROP ROLE IF EXISTS "is_franco"') 'create-login-role tem reverter'

$r = Get-CredentialWriteSql ([pscustomobject]@{ kind = 'postgres.grant-reader'; role = 'is_franco'; readerRole = 'growth_reader' })
Ok ($r.sql -match 'GRANT "growth_reader" TO "is_franco"' -and $r.sql -match 'read_only=on') 'grant-reader monta SQL e tranca leitura'

$r = Get-CredentialWriteSql ([pscustomobject]@{ kind = 'postgres.add-column'; schema = 'gold'; table = 'perfil_contato'; column = 'segmento'; type = 'text' })
Ok ($r.sql -match 'ADD COLUMN IF NOT EXISTS "segmento" text') 'add-column idempotente'

$r = Get-CredentialWriteSql ([pscustomobject]@{ kind = 'postgres.create-table'; schema = 'gold'; table = 'campanha'; columns = @([pscustomobject]@{ name = 'id'; type = 'uuid' }, [pscustomobject]@{ name = 'nome'; type = 'text' }) })
Ok ($r.sql -match 'CREATE TABLE IF NOT EXISTS "gold"."campanha"') 'create-table monta SQL'

'== recusa o perigoso e o malformado'
Recusa { Get-CredentialWriteSql ([pscustomobject]@{ kind = 'postgres.drop-database'; name = 'growth_dw' }) } 'drop-database nao existe no cardapio'
Recusa { Get-CredentialWriteSql ([pscustomobject]@{ kind = 'postgres.create-login-role'; role = 'x"; DROP DATABASE growth_dw; --' }) } 'injecao no nome do papel'
Recusa { Get-CredentialWriteSql ([pscustomobject]@{ kind = 'postgres.create-login-role'; role = 'postgres' }) } 'nome reservado (postgres)'
Recusa { Get-CredentialWriteSql ([pscustomobject]@{ kind = 'postgres.add-column'; schema = 'gold'; table = 't'; column = 'c'; type = 'text; DROP TABLE gold.t' }) } 'tipo fora da allowlist'
Recusa { Get-CredentialWriteSql ([pscustomobject]@{ kind = 'postgres.create-login-role'; role = 'r'; connectionLimit = 999 }) } 'connectionLimit fora de faixa'

''
if ($falhas -eq 0) { 'TODOS OS TESTES PASSARAM' } else { "FALHAS: $falhas"; exit 1 }
