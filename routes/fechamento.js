const express = require("express");
const { randomUUID } = require("crypto");
const db = require("../db");
const { autenticar, permitirPapeis } = require("../middleware/auth");

const router = express.Router();

// Só gerente mexe no caixa (abre/fecha). Admin só acompanha (rotas de leitura, abaixo).
router.use(autenticar);

function arredondar(valor) {
  return Math.round((Number(valor) || 0) * 100) / 100;
}

// Soma as vendas (mesma regra usada no painel: tudo que não foi recusado conta
// como venda, mesmo que ainda esteja em preparo — reflete o que já entrou no caixa)
// registradas entre a abertura do turno e o momento do fechamento (ou agora, se
// o turno ainda estiver aberto).
function calcularResumoPeriodo(desde, ate) {
  const pedidos = db.prepare(`
    SELECT total, formaPagamento FROM pedidos
    WHERE status != 'recusado' AND criadoEm >= ? AND criadoEm <= ?
  `).all(desde, ate);

  const resumo = { totalPedidos: pedidos.length, totalPix: 0, totalCartao: 0, totalDinheiro: 0, totalGeral: 0 };
  for (const p of pedidos) {
    const total = Number(p.total) || 0;
    resumo.totalGeral += total;
    if (p.formaPagamento === "pix") resumo.totalPix += total;
    else if (p.formaPagamento === "cartao") resumo.totalCartao += total;
    else if (p.formaPagamento === "dinheiro") resumo.totalDinheiro += total;
  }
  resumo.totalPix = arredondar(resumo.totalPix);
  resumo.totalCartao = arredondar(resumo.totalCartao);
  resumo.totalDinheiro = arredondar(resumo.totalDinheiro);
  resumo.totalGeral = arredondar(resumo.totalGeral);
  return resumo;
}

function paraSaida(f) {
  return { ...f };
}

// Histórico de fechamentos — gerente e admin podem consultar.
router.get("/", permitirPapeis("admin", "gerente"), (req, res) => {
  const lista = db.prepare("SELECT * FROM fechamentos_caixa ORDER BY abertoEm DESC LIMIT 100").all();
  res.json(lista.map(paraSaida));
});

// Retorna o caixa aberto no momento (se houver), já com o resumo ao vivo das
// vendas desde a abertura — é isso que o Painel usa pra mostrar em tempo real.
router.get("/aberto", permitirPapeis("admin", "gerente"), (req, res) => {
  const aberto = db.prepare("SELECT * FROM fechamentos_caixa WHERE status = 'aberto' LIMIT 1").get();
  if (!aberto) return res.json(null);
  const resumo = calcularResumoPeriodo(aberto.abertoEm, new Date().toISOString().slice(0, 19).replace("T", " "));
  res.json({ ...paraSaida(aberto), resumoAtual: resumo });
});

router.post("/abrir", permitirPapeis("gerente"), (req, res) => {
  const jaAberto = db.prepare("SELECT id FROM fechamentos_caixa WHERE status = 'aberto' LIMIT 1").get();
  if (jaAberto) {
    return res.status(409).json({ erro: "Já existe um caixa aberto. Feche o turno atual antes de abrir um novo." });
  }

  const valorAbertura = Number(req.body?.valorAbertura);
  if (isNaN(valorAbertura) || valorAbertura < 0) {
    return res.status(400).json({ erro: "Informe um valor de abertura válido (o troco inicial em dinheiro)." });
  }
  const observacoesAbertura = typeof req.body?.observacoes === "string" ? req.body.observacoes.trim().slice(0, 500) : null;

  const id = randomUUID();
  db.prepare(`
    INSERT INTO fechamentos_caixa (id, gerenteAbriuId, gerenteAbriuNome, status, valorAbertura, observacoesAbertura)
    VALUES (?, ?, ?, 'aberto', ?, ?)
  `).run(id, req.usuario.id, req.usuario.nome, arredondar(valorAbertura), observacoesAbertura);

  const registro = db.prepare("SELECT * FROM fechamentos_caixa WHERE id = ?").get(id);
  req.app.get("io").emit("caixa:aberto", paraSaida(registro));
  res.status(201).json(paraSaida(registro));
});

router.post("/:id/fechar", permitirPapeis("gerente"), (req, res) => {
  const registro = db.prepare("SELECT * FROM fechamentos_caixa WHERE id = ?").get(req.params.id);
  if (!registro) return res.status(404).json({ erro: "Fechamento não encontrado." });
  if (registro.status !== "aberto") return res.status(409).json({ erro: "Este caixa já foi fechado." });

  const valorContado = Number(req.body?.valorContado);
  if (isNaN(valorContado) || valorContado < 0) {
    return res.status(400).json({ erro: "Informe o valor contado no caixa (dinheiro)." });
  }
  const observacoesFechamento = typeof req.body?.observacoes === "string" ? req.body.observacoes.trim().slice(0, 500) : null;

  const fechadoEm = new Date().toISOString().slice(0, 19).replace("T", " ");
  const resumo = calcularResumoPeriodo(registro.abertoEm, fechadoEm);

  // O que deveria ter em dinheiro no caixa = troco inicial + vendas em dinheiro do turno.
  // Vendas em pix/cartão não passam pela gaveta, então não entram nessa conta.
  const valorEsperadoDinheiro = arredondar(registro.valorAbertura + resumo.totalDinheiro);
  const diferenca = arredondar(valorContado - valorEsperadoDinheiro);

  db.prepare(`
    UPDATE fechamentos_caixa SET
      status = 'fechado',
      gerenteFechouId = ?, gerenteFechouNome = ?,
      fechadoEm = ?,
      totalPedidos = ?, totalPix = ?, totalCartao = ?, totalDinheiro = ?, totalGeral = ?,
      valorContado = ?, diferenca = ?, observacoesFechamento = ?
    WHERE id = ?
  `).run(
    req.usuario.id, req.usuario.nome,
    fechadoEm,
    resumo.totalPedidos, resumo.totalPix, resumo.totalCartao, resumo.totalDinheiro, resumo.totalGeral,
    arredondar(valorContado), diferenca, observacoesFechamento,
    req.params.id
  );

  const atualizado = db.prepare("SELECT * FROM fechamentos_caixa WHERE id = ?").get(req.params.id);
  req.app.get("io").emit("caixa:fechado", paraSaida(atualizado));
  res.json(paraSaida(atualizado));
});

module.exports = router;