// ============================================================
// UTILITÁRIOS COMPARTILHADOS — usado por index.html (admin) e
// cardapio.html (loja pública). Manter aqui evita que os dois
// arquivos divirjam com o tempo (ex.: um corrigido, outro não).
// ============================================================

const API_BASE = ""; // mesma origem do servidor Express

function escapeHtml(valor) {
  return String(valor ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[c]));
}

const formatBRL = (valor) => Number(valor ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
