// Migrações numeradas de cada arquivo da casa. Migração aplicada nunca muda: o banco guarda o
// sha256 do SQL e recusa abrir se o texto divergir. Mudança de esquema = migração nova no fim.
//
// Toda tabela de dado vivo nasce pronta para a sincronização entre máquinas (§3.1): id texto
// (UUID v7 ou id natural estável), origem_maquina, criado_em, atualizado_em, versao, lápide em
// apagado_em e gatilhos que registram cada mudança no _diario do próprio arquivo. (Gatilho
// persistente do SQLite não grava em outro arquivo anexado; por isso o diário é por arquivo.)
// Toda mudança que importa sobe a versao; o diário só anota UPDATE quando a versao muda, e a
// arrumação local (como a ordem de exibição) não vira tráfego de sincronização.

const VIVO = `origem_maquina TEXT NOT NULL,
  criado_em TEXT NOT NULL,
  atualizado_em TEXT NOT NULL,
  versao INTEGER NOT NULL DEFAULT 1,
  apagado_em TEXT`

const DIARIO = `CREATE TABLE _diario (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  tabela TEXT NOT NULL,
  linha TEXT NOT NULL,
  operacao TEXT NOT NULL CHECK (operacao IN ('I', 'U', 'D')),
  versao INTEGER,
  em TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);`

export function gatilhosDeDiario(tabela) {
  const linha = (lado, op) => `INSERT INTO _diario (tabela, linha, operacao, versao) VALUES ('${tabela}', ${lado}.id, '${op}', ${lado}.versao);`
  return `
CREATE TRIGGER ${tabela}_diario_i AFTER INSERT ON ${tabela} BEGIN ${linha('NEW', 'I')} END;
CREATE TRIGGER ${tabela}_diario_u AFTER UPDATE ON ${tabela} WHEN NEW.versao IS NOT OLD.versao BEGIN ${linha('NEW', 'U')} END;
CREATE TRIGGER ${tabela}_diario_d AFTER DELETE ON ${tabela} BEGIN ${linha('OLD', 'D')} END;`
}

// Projeção em arquivo (§3.2): o banco é a fonte; o arquivo é cópia gerada para quem ainda lê
// do disco. _projecoes guarda o hash de cada versão que o banco escreveu ou ingeriu; o hash da
// versão corrente mora junto do próprio dado (memoria_meta.texto_sha256, documentos.sha256,
// credenciais.blob_sha256). Hash desconhecido no disco é escrita externa a ingerir.
const PROJECOES = `CREATE TABLE _projecoes (
  arquivo TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  papel TEXT NOT NULL CHECK (papel IN ('escrita', 'ingerida')),
  em TEXT NOT NULL,
  PRIMARY KEY (arquivo, sha256)
);`

const IMPORTACOES = `CREATE TABLE _importacoes (
  id TEXT PRIMARY KEY,
  tipo TEXT NOT NULL,
  fonte TEXT NOT NULL,
  fonte_sha256 TEXT NOT NULL,
  contagens TEXT NOT NULL,
  origem_maquina TEXT NOT NULL,
  feita_em TEXT NOT NULL
);`

export const MIGRACOES_NUCLEO = [
  {
    versao: 1,
    nome: 'registro de agentes e maquinas',
    sql: `${DIARIO}
CREATE TABLE agentes (
  id TEXT PRIMARY KEY,
  versao_agente TEXT NOT NULL,
  banco TEXT,
  manifesto TEXT NOT NULL DEFAULT '{}',
  ${VIVO}
);
${gatilhosDeDiario('agentes')}
CREATE TABLE maquinas (
  id TEXT PRIMARY KEY,
  nome TEXT NOT NULL,
  primeiro_visto TEXT NOT NULL,
  ultimo_visto TEXT NOT NULL
);`
  }
]

export const MIGRACOES_OMNI = [
  {
    versao: 1,
    nome: 'memoria, documentos e projecoes',
    sql: `${DIARIO}
${PROJECOES}
${IMPORTACOES}
CREATE TABLE memorias (
  id TEXT PRIMARY KEY,
  raia TEXT NOT NULL CHECK (raia IN ('confirmed', 'candidates', 'archive')),
  ordem INTEGER NOT NULL,
  tipo TEXT,
  texto TEXT,
  corpo TEXT NOT NULL,
  ${VIVO}
);
CREATE INDEX memorias_por_raia ON memorias (raia, ordem) WHERE apagado_em IS NULL;
${gatilhosDeDiario('memorias')}
CREATE TABLE memoria_meta (
  chave TEXT PRIMARY KEY,
  valor TEXT NOT NULL
);
CREATE TABLE documentos (
  id TEXT PRIMARY KEY,
  formato TEXT NOT NULL CHECK (formato IN ('json', 'md', 'texto')),
  conteudo TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  ${VIVO}
);
${gatilhosDeDiario('documentos')}`
  },
  // v2 (plano 2 da F1): base comum do merge de três vias dos .md, por máquina — o hash que banco
  // e disco tinham em comum na última reconciliação. Tabela interna, sem diário: é estado local
  // de cada máquina, não dado a sincronizar.
  {
    versao: 2,
    nome: 'documentos no disco por maquina',
    sql: `CREATE TABLE _documentos_no_disco (
  maquina TEXT NOT NULL,
  id TEXT NOT NULL REFERENCES documentos (id),
  sha256 TEXT NOT NULL,
  em TEXT NOT NULL,
  PRIMARY KEY (maquina, id)
);`
  },
  // v3 (plano 3 da F1): estados de aprendizado e feedback (learning/*.json, feedback/*.json).
  // estados guarda o documento sem as coleções (esqueleto), o hash do texto inteiro e o relógio
  // (store.updatedAt, local de cada máquina, não sobe versão); cada item de coleção vira uma linha
  // de estado_registros, para a F5 trafegar só o que mudou. Aqui a ordem é parte do documento e
  // sobe versão. Sem chave estrangeira entre as duas: a F5 aplica em qualquer ordem.
  // _estados_no_disco é a base por máquina (como _documentos_no_disco): interna, sem diário.
  {
    versao: 3,
    nome: 'estados de aprendizado e feedback',
    sql: `CREATE TABLE estados (
  id TEXT PRIMARY KEY,
  esqueleto TEXT NOT NULL,
  texto_sha256 TEXT NOT NULL,
  relogio TEXT,
  ${VIVO}
);
${gatilhosDeDiario('estados')}
CREATE TABLE estado_registros (
  id TEXT PRIMARY KEY,
  arquivo TEXT NOT NULL,
  colecao TEXT NOT NULL,
  ordem INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  corpo TEXT NOT NULL,
  ${VIVO}
);
CREATE INDEX estado_registros_por_colecao ON estado_registros (arquivo, colecao, ordem) WHERE apagado_em IS NULL;
${gatilhosDeDiario('estado_registros')}
CREATE TABLE _estados_no_disco (
  maquina TEXT NOT NULL,
  id TEXT NOT NULL REFERENCES estados (id),
  sha256 TEXT NOT NULL,
  em TEXT NOT NULL,
  PRIMARY KEY (maquina, id)
);`
  }
]

export const MIGRACOES_COFRE = [
  {
    versao: 1,
    nome: 'credenciais e usos',
    sql: `${DIARIO}
${PROJECOES}
${IMPORTACOES}
CREATE TABLE credenciais (
  id TEXT PRIMARY KEY,
  nome TEXT NOT NULL,
  tipo TEXT NOT NULL CHECK (tipo IN ('senha', 'token', 'chave-api', 'conexao', 'conta-servico', 'ssh', 'outro')),
  servico TEXT,
  url TEXT,
  usuario TEXT,
  notas TEXT,
  etiquetas TEXT NOT NULL DEFAULT '[]',
  agentes TEXT NOT NULL DEFAULT '["omni"]',
  validade TEXT,
  rotacionar_dias INTEGER,
  ultimo_teste_em TEXT,
  ultimo_teste_ok INTEGER,
  ultimo_teste_detalhe TEXT,
  cifra TEXT NOT NULL DEFAULT 'dpapi-usuario',
  blob BLOB NOT NULL,
  blob_sha256 TEXT NOT NULL,
  ${VIVO}
);
CREATE UNIQUE INDEX credenciais_nome_vivo ON credenciais (nome) WHERE apagado_em IS NULL;
${gatilhosDeDiario('credenciais')}
CREATE TABLE usos (
  id TEXT PRIMARY KEY,
  credencial_id TEXT,
  nome TEXT NOT NULL,
  agente TEXT NOT NULL,
  sessao TEXT,
  motivo TEXT NOT NULL,
  resultado TEXT NOT NULL,
  em TEXT NOT NULL,
  origem_maquina TEXT NOT NULL
);
CREATE INDEX usos_por_credencial ON usos (credencial_id, em);`
  }
]

export const BANCOS = Object.freeze({
  nucleo: Object.freeze({ arquivo: 'nucleo.db', migracoes: MIGRACOES_NUCLEO }),
  omni: Object.freeze({ arquivo: 'omni.db', migracoes: MIGRACOES_OMNI }),
  cofre: Object.freeze({ arquivo: 'cofre.db', migracoes: MIGRACOES_COFRE })
})
