require("dotenv").config();
const path = require("path");
const os = require("os");
const express = require("express");
const cors = require("cors");
const http = require("http");
const { Server } = require("socket.io");
const registrarRotaUpload = require("./rotas-upload-imagem");
require("./db"); // garante que o banco e o seed inicial existam antes de tudo
const { autenticar } = require("./middleware/auth");
const app = express();
const servidorHttp = http.createServer(app);
const io = new Server(servidorHttp, { cors: { origin: "*" } });

app.set("io", io);
app.use(cors());
app.use(express.json());

// -------- Rotas da API --------
app.use("/api/auth", require("./routes/auth"));
app.use("/api/produtos", require("./routes/produtos"));
app.use("/api/estoque", require("./routes/estoque"));
app.use("/api/pedidos", require("./routes/pedidos"));
app.use("/api/usuarios", require("./routes/usuarios"));
app.use("/api/relatorios", require("./routes/relatorios"));
app.use("/api/configuracoes", require("./routes/configuracoes"));
registrarRotaUpload(app, autenticar); // troque "autenticar" pelo nome que você achou no Passo 4
// Mesma lógica do DATA_DIR: em produção (Render), aponte UPLOADS_DIR pro
// Persistent Disk. Sem a variável, usa a pasta "uploads" local de sempre.
const UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(__dirname, "uploads");
app.use("/uploads", express.static(UPLOADS_DIR));
app.get("/api/health", (req, res) => res.json({ status: "ok", horario: new Date().toISOString() }));

// -------- Frontend estático (index.html do painel + cardapio.html) --------
app.use(express.static(path.join(__dirname, "public")));
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});
// Tratamento de erros central
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ erro: "Erro interno no servidor." });
});

io.on("connection", (socket) => {
  console.log("🔌 Cliente conectado via WebSocket:", socket.id);
  socket.on("disconnect", () => console.log("🔌 Cliente desconectado:", socket.id));
});

function listarIPsDaRedeLocal() {
  const interfaces = os.networkInterfaces();
  const ips = [];
  for (const nome of Object.keys(interfaces)) {
    for (const info of interfaces[nome] || []) {
      if (info.family === "IPv4" && !info.internal) ips.push(info.address);
    }
  }
  return ips;
}

const PORTA = process.env.PORT || 3000;
const RODANDO_NO_RENDER = !!process.env.RENDER;
// O listen() abaixo não restringe host, então localmente o servidor já aceita
// conexões de qualquer dispositivo na mesma rede Wi-Fi — não só do próprio PC.
servidorHttp.listen(PORTA, () => {
  console.log(`✅ CT Prime API rodando na porta ${PORTA}`);
  if (RODANDO_NO_RENDER) {
    console.log("   Rodando no Render — acesse pela URL pública do seu serviço (ex: https://seu-app.onrender.com).");
    return;
  }
  console.log(`   Painel administrativo: http://localhost:${PORTA}/index.html`);
  console.log(`   Cardápio do cliente:   http://localhost:${PORTA}/cardapio.html`);

  const ipsLocais = listarIPsDaRedeLocal();
  if (ipsLocais.length) {
    console.log("");
    console.log("📶 Acesso de outros dispositivos na mesma rede Wi-Fi:");
    ipsLocais.forEach((ip) => {
      console.log(`   Cardápio do cliente:   http://${ip}:${PORTA}/cardapio.html`);
      console.log(`   Painel administrativo: http://${ip}:${PORTA}/index.html`);
    });
    console.log("   (Certifique-se de que o firewall do PC libera a porta " + PORTA + " na rede local.)");
  } else {
    console.log("⚠️  Não encontrei um IP de rede local — verifique se o Wi-Fi/rede está conectado.");
  }
});