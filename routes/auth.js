const express = require("express");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const rateLimit = require("express-rate-limit");
const db = require("../db");
const { autenticar } = require("../middleware/auth");

const router = express.Router();

// Hash "morto" só pra sempre gastar o mesmo tempo de bcrypt.compareSync,
// mesmo quando o e-mail não existe — evita que o tempo de resposta revele
// se um e-mail está cadastrado (timing attack de enumeração de usuários).
const HASH_FALSO = "$2a$10$CwTycUXWue0Thq9StjUM0uJ8OZg9jsXvw1Qm8v8g4X5Zk4b6a8x9K";

const limitadorLogin = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 10, // 10 tentativas por IP nesse período
  standardHeaders: true,
  legacyHeaders: false,
  message: { erro: "Muitas tentativas de login. Aguarde alguns minutos e tente novamente." },
});

router.post("/login", limitadorLogin, (req, res) => {
  const { email, senha } = req.body || {};
  if (!email || !senha) {
    return res.status(400).json({ erro: "Informe e-mail e senha." });
  }

  const usuario = db.prepare("SELECT * FROM usuarios WHERE email = ?").get(email.trim().toLowerCase());
  // Sempre roda o compare, mesmo sem usuário, contra um hash fixo — mantém
  // o tempo de resposta constante e evita revelar se o e-mail existe.
  const senhaConfere = bcrypt.compareSync(senha, usuario ? usuario.senha_hash : HASH_FALSO);
  if (!usuario || !senhaConfere) {
    return res.status(401).json({ erro: "E-mail ou senha incorretos." });
  }
  if (!usuario.ativo) {
    return res.status(403).json({ erro: "Este usuário está inativo no sistema." });
  }

  const token = jwt.sign(
    { id: usuario.id, papel: usuario.papel },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || "8h" }
  );

  const { senha_hash, ...usuarioSemSenha } = usuario;
  res.json({ token, usuario: usuarioSemSenha });
});

router.get("/me", autenticar, (req, res) => {
  res.json({ usuario: req.usuario });
});

module.exports = router;