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

// Nome de agente: o mesmo formato do cofre (minúscula, dígito e hífen; começa por letra; até 40).
const slug = (coluna) => `length(${coluna}) BETWEEN 1 AND 40 AND ${coluna} GLOB '[a-z]*' AND ${coluna} NOT GLOB '*[^a-z0-9-]*'`
// Máquina: o hostname em minúsculas, sem barra (a barra separa máquina e agente no id da instalação).
const maquinaValida = (coluna) => `length(${coluna}) BETWEEN 1 AND 253 AND ${coluna} = lower(${coluna}) AND ${coluna} NOT GLOB '*/*'`

// nucleo.db (§4.2): quem é cada agente (catálogo, igual em toda máquina: o último registrado
// vence), onde ele está instalado (cada máquina grava só as próprias linhas) e quais máquinas a
// casa conhece. Sem chave estrangeira entre as tabelas: a sincronização aplica em qualquer ordem.
// maquinas.visto_em é relógio local: atualizá-lo não sobe a versao e não vira tráfego.
export const MIGRACOES_NUCLEO = [
  {
    versao: 1,
    nome: 'catalogo de agentes, instalacoes e maquinas',
    sql: `${DIARIO}
CREATE TABLE maquinas (
  id TEXT PRIMARY KEY CHECK (${maquinaValida('id')}),
  nome TEXT NOT NULL,
  sistema TEXT NOT NULL,
  visto_em TEXT NOT NULL,
  ${VIVO}
);
${gatilhosDeDiario('maquinas')}
CREATE TABLE agentes (
  id TEXT PRIMARY KEY CHECK (${slug('id')}),
  versao_agente TEXT NOT NULL,
  banco TEXT CHECK (banco IS NULL OR banco = id || '.db'),
  manifesto TEXT NOT NULL CHECK (CASE WHEN json_valid(manifesto) THEN json_type(manifesto) = 'object' ELSE 0 END),
  manifesto_sha256 TEXT NOT NULL CHECK (length(manifesto_sha256) = 64),
  ${VIVO}
);
${gatilhosDeDiario('agentes')}
CREATE TABLE instalacoes (
  id TEXT PRIMARY KEY CHECK (id = maquina || '/' || agente),
  maquina TEXT NOT NULL CHECK (${maquinaValida('maquina')}),
  agente TEXT NOT NULL CHECK (${slug('agente')}),
  raiz TEXT NOT NULL CHECK (length(raiz) > 0),
  versao_agente TEXT NOT NULL,
  manifesto_sha256 TEXT NOT NULL CHECK (length(manifesto_sha256) = 64),
  ${VIVO}
);
${gatilhosDeDiario('instalacoes')}`
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
  },
  // v4 (plano 1 da F2, decisão 8): missões e livro de aprendizado operacional, que moravam no
  // Postgres 5433. missoes e aprendizado_achados são dado vivo (diário); os eventos são só de
  // acréscimo, como usos no cofre. Mesmas restrições do PG, para o histórico importado caber
  // sem conversão. Datas em ISO UTC com milissegundos e Z: comparar texto é comparar tempo.
  {
    versao: 4,
    nome: 'missoes e livro de aprendizado operacional',
    sql: `CREATE TABLE missoes (
  id TEXT PRIMARY KEY CHECK (id GLOB 'mission-?*'),
  objetivo TEXT NOT NULL CHECK (length(objetivo) BETWEEN 3 AND 800),
  estado TEXT NOT NULL CHECK (estado IN ('open', 'in-progress', 'blocked', 'completed', 'cancelled')),
  prioridade INTEGER NOT NULL CHECK (prioridade BETWEEN 0 AND 100),
  corpo TEXT NOT NULL CHECK (json_valid(corpo)),
  fechada_em TEXT,
  ${VIVO},
  CHECK ((estado IN ('completed', 'cancelled')) = (fechada_em IS NOT NULL))
);
CREATE INDEX missoes_ativas ON missoes (estado, prioridade DESC, atualizado_em DESC) WHERE apagado_em IS NULL;
${gatilhosDeDiario('missoes')}
CREATE TABLE missao_eventos (
  id TEXT PRIMARY KEY CHECK (id GLOB 'mission-event-?*'),
  missao_id TEXT NOT NULL,
  tipo TEXT NOT NULL CHECK (tipo IN ('created', 'updated', 'blocked', 'resumed', 'completed', 'cancelled', 'reconciled')),
  corpo TEXT NOT NULL CHECK (json_valid(corpo)),
  em TEXT NOT NULL,
  origem_maquina TEXT NOT NULL
);
CREATE INDEX missao_eventos_por_missao ON missao_eventos (missao_id, em);
CREATE TABLE aprendizado_achados (
  id TEXT PRIMARY KEY CHECK (id GLOB 'improvement-?*'),
  impressao_candidato TEXT NOT NULL,
  categoria TEXT NOT NULL,
  destino TEXT NOT NULL,
  estado TEXT NOT NULL,
  ocorrencias INTEGER NOT NULL CHECK (ocorrencias BETWEEN 1 AND 1000000),
  impressao_enunciado TEXT NOT NULL,
  impressao_fonte TEXT NOT NULL,
  impressao_artefato TEXT,
  versao_release TEXT,
  primeiro_visto_em TEXT NOT NULL,
  ultimo_visto_em TEXT NOT NULL,
  ${VIVO},
  CHECK (ultimo_visto_em >= primeiro_visto_em)
);
${gatilhosDeDiario('aprendizado_achados')}
CREATE TABLE aprendizado_eventos (
  id TEXT PRIMARY KEY CHECK (id GLOB 'learning-event-?*'),
  achado_id TEXT NOT NULL,
  estado TEXT NOT NULL,
  ocorrencias INTEGER NOT NULL,
  impressao_fonte TEXT NOT NULL,
  impressao_artefato TEXT,
  versao_release TEXT,
  em TEXT NOT NULL,
  origem_maquina TEXT NOT NULL
);
CREATE INDEX aprendizado_eventos_por_achado ON aprendizado_eventos (achado_id, em);`
  },
  // v5 (plano 3 da F2): a campainha dos agentes. Cada POST /v1/despachos vira um recibo; o id é
  // agente/execucao, então o mesmo toque repetido não duplica. A fila do agente é a verdade: isto é só
  // o aviso de que há trabalho lá. Dado operacional desta máquina, sem diário de sincronização.
  {
    versao: 5,
    nome: 'despachos da campainha',
    sql: `CREATE TABLE despachos (
  id TEXT PRIMARY KEY,
  agente TEXT NOT NULL CHECK (${slug('agente')}),
  execucao TEXT NOT NULL CHECK (length(execucao) BETWEEN 1 AND 128 AND execucao NOT GLOB '*[^A-Za-z0-9._:-]*'),
  estado TEXT NOT NULL DEFAULT 'recebido' CHECK (estado IN ('recebido', 'assumido', 'recusado', 'falhou')),
  tentativas INTEGER NOT NULL DEFAULT 0 CHECK (tentativas >= 0),
  detalhe TEXT CHECK (detalhe IS NULL OR length(detalhe) <= 300),
  recebido_em TEXT NOT NULL,
  atualizado_em TEXT NOT NULL,
  origem_maquina TEXT NOT NULL CHECK (${maquinaValida('origem_maquina')}),
  CHECK (id = agente || '/' || execucao)
);
CREATE INDEX despachos_recebidos ON despachos (recebido_em) WHERE estado = 'recebido';`
  }
]

// A v1 do cofre foi revista no plano 4 (guarda dpapi | gerenciador-windows; blob nulo no inventário só de nomes) e congela com o push dele: mudança daí em diante é migração nova.
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
  guarda TEXT NOT NULL CHECK (guarda IN ('dpapi', 'gerenciador-windows')),
  alvo_windows TEXT,
  blob BLOB,
  blob_sha256 TEXT,
  ${VIVO},
  CHECK ((guarda = 'gerenciador-windows') = (alvo_windows IS NOT NULL)),
  CHECK ((guarda = 'dpapi') = (blob IS NOT NULL)),
  CHECK ((blob IS NULL) = (blob_sha256 IS NULL)),
  CHECK (CASE WHEN json_valid(agentes) THEN json_type(agentes) = 'array' ELSE 0 END),
  CHECK (CASE WHEN json_valid(etiquetas) THEN json_type(etiquetas) = 'array' ELSE 0 END)
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
