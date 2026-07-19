const path = require("path");
const fs = require("fs");
const Database = require("better-sqlite3");
const bcrypt = require("bcryptjs");
const { randomUUID } = require("crypto");

// Em produção (Render), defina a variável de ambiente DATA_DIR apontando
// pro caminho do seu Persistent Disk (ex: /var/data) — assim o banco
// sobrevive a novos deploys. Sem essa variável, continua usando a pasta
// "data" local, igual antes (bom pra rodar no seu PC).
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, "ctprime.db"));
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS usuarios (
    id TEXT PRIMARY KEY,
    nome TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    senha_hash TEXT NOT NULL,
    papel TEXT NOT NULL CHECK (papel IN ('admin','gerente','atendente','cozinha')),
    ativo INTEGER NOT NULL DEFAULT 1,
    criadoEm TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS produtos (
    id TEXT PRIMARY KEY,
    nome TEXT NOT NULL,
    categoria TEXT,
    preco REAL NOT NULL,
    imagemUrl TEXT,
    ativo INTEGER NOT NULL DEFAULT 1,
    calorias REAL,
    porcaoGramas REAL,
    proteinas REAL,
    carboidratos REAL,
    gorduras REAL,
    criadoEm TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS estoque (
    id TEXT PRIMARY KEY,
    nome TEXT NOT NULL,
    quantidade REAL NOT NULL DEFAULT 0,
    unidade TEXT NOT NULL,
    estoqueMinimo REAL NOT NULL DEFAULT 0,
    criadoEm TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS pedidos (
    id TEXT PRIMARY KEY,
    cliente TEXT NOT NULL,
    telefone TEXT,
    itens TEXT NOT NULL,
    total REAL NOT NULL,
    status TEXT NOT NULL DEFAULT 'pendente',
    formaPagamento TEXT,
    trocoPara REAL,
    criadoEm TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS relatorios (
    id TEXT PRIMARY KEY,
    nome TEXT NOT NULL,
    vendasTotais REAL NOT NULL,
    totalPedidos INTEGER NOT NULL,
    ticketMedio REAL NOT NULL,
    maisVendido TEXT,
    geradoEm TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS configuracoes (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    nomeLoja TEXT DEFAULT '',
    cnpj TEXT DEFAULT '',
    telefone TEXT DEFAULT '',
    email TEXT DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS fechamentos_caixa (
    id TEXT PRIMARY KEY,
    gerenteAbriuId TEXT NOT NULL,
    gerenteAbriuNome TEXT NOT NULL,
    gerenteFechouId TEXT,
    gerenteFechouNome TEXT,
    status TEXT NOT NULL DEFAULT 'aberto' CHECK (status IN ('aberto','fechado')),
    valorAbertura REAL NOT NULL DEFAULT 0,
    observacoesAbertura TEXT,
    abertoEm TEXT NOT NULL DEFAULT (datetime('now')),
    fechadoEm TEXT,
    totalPedidos INTEGER,
    totalPix REAL,
    totalCartao REAL,
    totalDinheiro REAL,
    totalGeral REAL,
    valorContado REAL,
    diferenca REAL,
    observacoesFechamento TEXT
  );

  CREATE UNIQUE INDEX IF NOT EXISTS idx_fechamento_unico_aberto
    ON fechamentos_caixa (status) WHERE status = 'aberto';
`);

// Migração — bancos criados antes do papel "atendente" existir têm a coluna
// "papel" travada por um CHECK que só aceita admin/gerente/cozinha. SQLite não
// permite alterar um CHECK existente com ALTER TABLE, então recriamos a tabela
// com a restrição atualizada e copiamos todos os usuários já cadastrados.
const definicaoUsuarios = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='usuarios'").get();
if (definicaoUsuarios && !definicaoUsuarios.sql.includes("atendente")) {
  const migrarPapelAtendente = db.transaction(() => {
    db.exec(`
      CREATE TABLE usuarios_novo (
        id TEXT PRIMARY KEY,
        nome TEXT NOT NULL,
        email TEXT NOT NULL UNIQUE,
        senha_hash TEXT NOT NULL,
        papel TEXT NOT NULL CHECK (papel IN ('admin','gerente','atendente','cozinha')),
        ativo INTEGER NOT NULL DEFAULT 1,
        criadoEm TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
    db.exec(`
      INSERT INTO usuarios_novo (id, nome, email, senha_hash, papel, ativo, criadoEm)
      SELECT id, nome, email, senha_hash, papel, ativo, criadoEm FROM usuarios;
    `);
    db.exec("DROP TABLE usuarios;");
    db.exec("ALTER TABLE usuarios_novo RENAME TO usuarios;");
  });
  migrarPapelAtendente();
  console.log("✔ Papel 'atendente' liberado na tabela usuarios (usuários existentes preservados)");
}

// Migração — bancos criados antes da coluna "telefone" existir não a recebem
// automaticamente pelo CREATE TABLE IF NOT EXISTS acima, então verificamos e
// adicionamos manualmente se for o caso (sem apagar nenhum dado existente).
const colunasPedidos = db.prepare("PRAGMA table_info(pedidos)").all().map((c) => c.name);
if (!colunasPedidos.includes("telefone")) {
  db.exec("ALTER TABLE pedidos ADD COLUMN telefone TEXT");
  console.log("✔ Coluna 'telefone' adicionada à tabela pedidos");
}
db.exec("CREATE INDEX IF NOT EXISTS idx_pedidos_telefone ON pedidos (telefone)");

// Migração — bancos criados antes das colunas nutricionais existirem não as
// recebem automaticamente pelo CREATE TABLE IF NOT EXISTS acima, então
// verificamos e adicionamos manualmente se for o caso (sem apagar dados).
const colunasProdutos = db.prepare("PRAGMA table_info(produtos)").all().map((c) => c.name);
const colunasNutricionaisNovas = ["calorias", "porcaoGramas", "proteinas", "carboidratos", "gorduras"];
for (const coluna of colunasNutricionaisNovas) {
  if (!colunasProdutos.includes(coluna)) {
    db.exec(`ALTER TABLE produtos ADD COLUMN ${coluna} REAL`);
    console.log(`✔ Coluna '${coluna}' adicionada à tabela produtos`);
  }
}

// Seed inicial — só roda se as tabelas estiverem vazias
const totalUsuarios = db.prepare("SELECT COUNT(*) AS n FROM usuarios").get().n;
if (totalUsuarios === 0) {
  const inserir = db.prepare(`
    INSERT INTO usuarios (id, nome, email, senha_hash, papel, ativo)
    VALUES (?, ?, ?, ?, ?, 1)
  `);
  const senhaPadraoHash = bcrypt.hashSync("123456", 10);
  const seed = db.transaction(() => {
    inserir.run(randomUUID(), "Admin Master", "admin@ctprime.com", senhaPadraoHash, "admin");
    inserir.run(randomUUID(), "Carlos Atendente", "func@ctprime.com", senhaPadraoHash, "gerente");
    inserir.run(randomUUID(), "Equipe Cozinha", "cozinha@ctprime.com", senhaPadraoHash, "cozinha");
  });
  seed();
  console.log("✔ Usuários padrão criados (senha: 123456)");
}

const totalConfig = db.prepare("SELECT COUNT(*) AS n FROM configuracoes").get().n;
if (totalConfig === 0) {
  db.prepare(`INSERT INTO configuracoes (id, nomeLoja, cnpj, telefone, email) VALUES (1, 'CT Prime', '', '', '')`).run();
}

module.exports = db;