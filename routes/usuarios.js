const express = require("express");
const { randomUUID } = require("crypto");
const bcrypt = require("bcryptjs");
const db = require("../db");
const { autenticar, permitirPapeis } = require("../middleware/auth");

const router = express.Router();
router.use(autenticar, permitirPapeis("admin"));

function paraSaida(u) {
  const { senha_hash, ...resto } = u;
  return { ...resto, ativo: !!resto.ativo };
}

router.get("/", (req, res) => {
  const lista = db.prepare("SELECT * FROM usuarios ORDER BY criadoEm DESC").all();
  res.json(lista.map(paraSaida));
});

router.post("/", (req, res) => {
  const { nome, email, papel, ativo } = req.body || {};
  if (!nome || !email || !["admin", "gerente", "atendente", "cozinha"].includes(papel)) {
    return res.status(400).json({ erro: "Informe nome, e-mail e um papel válido (admin, gerente, atendente ou cozinha)." });
  }
  const emailNormalizado = email.trim().toLowerCase();
  const existente = db.prepare("SELECT id FROM usuarios WHERE email = ?").get(emailNormalizado);
  if (existente) return res.status(409).json({ erro: "Já existe um usuário com este e-mail." });

  const id = randomUUID();
  const senhaHash = bcrypt.hashSync("123456", 10);
  db.prepare(`
    INSERT INTO usuarios (id, nome, email, senha_hash, papel, ativo)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, nome, emailNormalizado, senhaHash, papel, ativo === false ? 0 : 1);

  res.status(201).json(paraSaida(db.prepare("SELECT * FROM usuarios WHERE id = ?").get(id)));
});

router.patch("/:id", (req, res) => {
  const existente = db.prepare("SELECT * FROM usuarios WHERE id = ?").get(req.params.id);
  if (!existente) return res.status(404).json({ erro: "Usuário não encontrado." });


/// Impede que o usuário logado desative a própria conta
if (
  req.usuario.id === req.params.id &&
  req.body.ativo === false
) {
  return res.status(400).json({
    erro: "Você não pode desativar sua própria conta."
  });
}

// Impede desativar o último administrador ativo
if (existente.papel === "admin" && req.body.ativo === false) {
  const adminsAtivos = db.prepare(`
    SELECT COUNT(*) AS total
    FROM usuarios
    WHERE papel = 'admin' AND ativo = 1
  `).get();

  if (adminsAtivos.total <= 1) {
    return res.status(400).json({
      erro: "O último administrador ativo não pode ser desativado."
    });
  }
}

  const dados = {
    nome: req.body.nome ?? existente.nome,
    papel: req.body.papel ?? existente.papel,
    ativo: req.body.ativo !== undefined ? (req.body.ativo ? 1 : 0) : existente.ativo,
  };
  db.prepare("UPDATE usuarios SET nome=?, papel=?, ativo=? WHERE id=?")
    .run(dados.nome, dados.papel, dados.ativo, req.params.id);

  res.json(paraSaida(db.prepare("SELECT * FROM usuarios WHERE id = ?").get(req.params.id)));
});

router.delete("/:id", (req, res) => {
  if (req.usuario.id === req.params.id) {
    return res.status(400).json({ erro: "Você não pode excluir o próprio usuário." });
  }
  const info = db.prepare("DELETE FROM usuarios WHERE id = ?").run(req.params.id);
  if (info.changes === 0) return res.status(404).json({ erro: "Usuário não encontrado." });
  res.status(204).send();
});

module.exports = router;