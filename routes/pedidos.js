const express = require("express");
const { randomUUID } = require("crypto");
const rateLimit = require("express-rate-limit");
const db = require("../db");
const { autenticar, permitirPapeis } = require("../middleware/auth");

const router = express.Router();

// Limita criação de pedidos por IP — evita flood na fila da cozinha.
// Generoso o bastante pra não travar clientes legítimos numa mesma rede/wifi.
const limitadorCriarPedido = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { erro: "Muitos pedidos enviados em pouco tempo. Aguarde alguns minutos." },
});

// Limita consulta pública por telefone — telefone não é segredo, então sem
// isso qualquer pessoa poderia varrer números e ler o histórico de pedidos
// (nome, itens, total, forma de pagamento) de outras pessoas.
const limitadorConsultaTelefone = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
  message: { erro: "Muitas consultas em pouco tempo. Aguarde alguns minutos e tente novamente." },
});

function paraSaida(p) {
  return { ...p, itens: JSON.parse(p.itens) };
}

// Limite de segurança para evitar pedidos com centenas de linhas/itens abusivos
const MAX_ITENS_POR_PEDIDO = 100;
const MAX_QUANTIDADE_POR_ITEM = 500;

// Guarda e busca o telefone sempre só com dígitos, pra "11 98888-7777",
// "(11)988887777" e "11988887777" caírem tudo na mesma chave de consulta.
function normalizarTelefone(telefone) {
  return String(telefone || "").replace(/\D/g, "");
}

// Pública — o cardápio do cliente cria pedidos sem precisar de login
router.post("/", limitadorCriarPedido, (req, res) => {
  const { cliente, telefone, itens, formaPagamento, trocoPara } = req.body || {};
  // Observação: "total", "precoUnit" e "produtoNome" enviados pelo cliente
  // são IGNORADOS de propósito — nunca confie em preço/total vindo do front-end.
  // Tudo é recalculado abaixo a partir do banco de dados.

  if (typeof cliente !== "string" || !cliente.trim()) {
    return res.status(400).json({ erro: "Informe o nome do cliente." });
  }
  const telefoneNormalizado = normalizarTelefone(telefone);
  if (telefoneNormalizado.length < 10 || telefoneNormalizado.length > 11) {
    return res.status(400).json({ erro: "Informe um telefone válido com DDD." });
  }
  if (!Array.isArray(itens) || itens.length === 0 || itens.length > MAX_ITENS_POR_PEDIDO) {
    return res.status(400).json({ erro: "Informe ao menos um item válido no pedido." });
  }
  if (!["pix", "cartao", "dinheiro"].includes(formaPagamento)) {
    return res.status(400).json({ erro: "Forma de pagamento inválida." });
  }

  // Agrupa quantidades por produtoId caso o mesmo item venha duplicado no payload
  const quantidadesPorProduto = new Map();
  for (const item of itens) {
    const produtoId = item && item.produtoId;
    const quantidade = Number(item && item.quantidade);

    if (!produtoId || typeof produtoId !== "string") {
      return res.status(400).json({ erro: "Item de pedido inválido: produtoId ausente." });
    }
    if (!Number.isInteger(quantidade) || quantidade <= 0 || quantidade > MAX_QUANTIDADE_POR_ITEM) {
      return res.status(400).json({ erro: "Quantidade inválida para um dos itens do pedido." });
    }
    quantidadesPorProduto.set(produtoId, (quantidadesPorProduto.get(produtoId) || 0) + quantidade);
  }

  // Busca os produtos reais no banco — nome, preço e categoria vêm daqui, nunca do cliente
  const itensValidados = [];
  let total = 0;
  for (const [produtoId, quantidade] of quantidadesPorProduto) {
    const produto = db.prepare("SELECT * FROM produtos WHERE id = ?").get(produtoId);
    if (!produto || !produto.ativo) {
      return res.status(400).json({ erro: `Produto indisponível ou inexistente (id: ${produtoId}).` });
    }
    const precoUnit = Number(produto.preco);
    itensValidados.push({
      produtoId: produto.id,
      produtoNome: produto.nome,
      categoria: produto.categoria || "Outros",
      precoUnit,
      quantidade,
    });
    total += precoUnit * quantidade;
  }
  total = Math.round(total * 100) / 100; // evita erro de ponto flutuante

  const trocoParaNumero = trocoPara !== undefined && trocoPara !== null && trocoPara !== ""
    ? Number(trocoPara)
    : null;
  if (trocoParaNumero !== null && (isNaN(trocoParaNumero) || trocoParaNumero < total)) {
    return res.status(400).json({ erro: "Valor de troco inválido para o total do pedido." });
  }

  const id = randomUUID();
  db.prepare(`
    INSERT INTO pedidos (id, cliente, telefone, itens, total, status, formaPagamento, trocoPara)
    VALUES (?, ?, ?, ?, ?, 'pendente', ?, ?)
  `).run(id, cliente.trim().slice(0, 120), telefoneNormalizado, JSON.stringify(itensValidados), total, formaPagamento, trocoParaNumero);

  const pedido = paraSaida(db.prepare("SELECT * FROM pedidos WHERE id = ?").get(id));
  req.app.get("io").emit("pedido:novo", pedido);
  res.status(201).json(pedido);
});

router.get("/", autenticar, (req, res) => {
  const lista = db.prepare("SELECT * FROM pedidos ORDER BY criadoEm DESC").all();
  res.json(lista.map(paraSaida));
});

// Pública — o cliente busca o próprio histórico de pedidos informando o telefone
// usado na hora de pedir. Funciona em qualquer aparelho (não depende do navegador
// onde o pedido foi feito). Como não existe cadastro/senha, isso não é dado sigiloso
// de acesso — é só uma forma de o cliente reencontrar os próprios pedidos.
router.get("/por-telefone/:telefone", limitadorConsultaTelefone, (req, res) => {
  const telefoneNormalizado = normalizarTelefone(req.params.telefone);
  if (telefoneNormalizado.length < 10 || telefoneNormalizado.length > 11) {
    return res.status(400).json({ erro: "Informe um telefone válido com DDD." });
  }
  const lista = db.prepare("SELECT * FROM pedidos WHERE telefone = ? ORDER BY criadoEm DESC LIMIT 30")
    .all(telefoneNormalizado);
  res.json(lista.map(paraSaida));
});

// Pública — o cliente acompanha o andamento do próprio pedido pelo ID.
// Não exige login: o ID é um UUID imprevisível (gerado no POST acima) e
// funciona como uma "senha" de consulta — só quem recebeu o ID consegue ver o pedido.
router.get("/:id/status", (req, res) => {
  const pedido = db.prepare("SELECT * FROM pedidos WHERE id = ?").get(req.params.id);
  if (!pedido) return res.status(404).json({ erro: "Pedido não encontrado." });
  res.json(paraSaida(pedido));
});

router.patch("/:id/status", autenticar, (req, res) => {
  const { status } = req.body || {};
  const pedido = db.prepare("SELECT * FROM pedidos WHERE id = ?").get(req.params.id);
  if (!pedido) return res.status(404).json({ erro: "Pedido não encontrado." });

  const papel = req.usuario.papel;
  const statusValidos = ["pendente", "preparando", "pronto", "entregue", "recusado"];
  if (!statusValidos.includes(status)) {
    return res.status(400).json({ erro: "Status inválido." });
  }

  if (["recusado", "entregue"].includes(pedido.status)) {
    return res.status(409).json({ erro: "Este pedido já está em um status final e não pode ser alterado." });
  }

  if (papel === "admin") {
    return res.status(403).json({ erro: "Administradores apenas visualizam o andamento dos pedidos." });
  }

  if (pedido.status === "pendente") {
    const podeAceitar = status === "preparando" && (papel === "cozinha" || papel === "gerente");
    const podeRecusar = status === "recusado" && papel === "gerente";
    if (!podeAceitar && !podeRecusar) {
      return res.status(403).json({ erro: "Você não pode realizar essa transição de status." });
    }
  } else {
    const opcoesPermitidas = papel === "cozinha" ? ["preparando", "pronto"] : ["preparando", "pronto", "entregue"];
    if (!opcoesPermitidas.includes(status)) {
      return res.status(403).json({ erro: "Você não pode definir este status." });
    }
  }

  db.prepare("UPDATE pedidos SET status = ? WHERE id = ?").run(status, req.params.id);
  const atualizado = paraSaida(db.prepare("SELECT * FROM pedidos WHERE id = ?").get(req.params.id));
  req.app.get("io").emit("pedido:atualizado", atualizado);
  res.json(atualizado);
});

router.delete("/:id", autenticar, permitirPapeis("admin", "gerente"), (req, res) => {
  const info = db.prepare("DELETE FROM pedidos WHERE id = ?").run(req.params.id);
  if (info.changes === 0) return res.status(404).json({ erro: "Pedido não encontrado." });
  req.app.get("io").emit("pedido:removido", { id: req.params.id });
  res.status(204).send();
});

module.exports = router;