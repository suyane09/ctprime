// ============================================================
// ROTA: POST /api/uploads/imagem
// ------------------------------------------------------------
// Recebe uma imagem (multipart/form-data, campo "imagem"),
// salva em disco na pasta /uploads e devolve a URL pública
// pra ser usada como imagemUrl do produto.
//
// COMO INTEGRAR NO SEU server.js (ou app.js/index.js):
//
//   1) Instale a dependência:
//        npm install multer
//
//   2) No topo do server.js, importe e registre a rota:
//        const registrarRotaUpload = require("./rotas-upload-imagem");
//        registrarRotaUpload(app, autenticar); // veja o passo 3
//
//   3) "autenticar" é o middleware que você já usa pra proteger
//      as outras rotas do admin (a mesma que valida o header
//      "Authorization: Bearer <token>" nas rotas de /api/produtos
//      etc.). Troque o nome abaixo pelo que você já tem no seu
//      projeto. Se você não tiver certeza de qual é, procure no
//      seu server.js por algo como:
//        function autenticar(req, res, next) { ... jwt.verify ... }
//      e é essa função que deve ser passada aqui.
//
//   4) Sirva a pasta /uploads como estática (adicione perto de
//      onde você já serve /assets no server.js):
//        app.use("/uploads", express.static(path.join(__dirname, "uploads")));
//
// ============================================================

const multer = require("multer");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

// Mesma variável de ambiente usada no server.js — em produção (Render),
// defina UPLOADS_DIR apontando pro Persistent Disk (ex: /var/data/uploads),
// senão as imagens somem a cada novo deploy. Sem a variável, continua
// salvando na pasta "uploads" local de sempre.
const PASTA_UPLOADS = process.env.UPLOADS_DIR || path.join(__dirname, "uploads");
if (!fs.existsSync(PASTA_UPLOADS)) fs.mkdirSync(PASTA_UPLOADS, { recursive: true });

const TIPOS_ACEITOS = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
};
const TAMANHO_MAX = 5 * 1024 * 1024; // 5MB

const armazenamento = multer.diskStorage({
  destination: (req, file, cb) => cb(null, PASTA_UPLOADS),
  filename: (req, file, cb) => {
    const extensao = TIPOS_ACEITOS[file.mimetype] || path.extname(file.originalname) || "";
    const nomeAleatorio = crypto.randomBytes(16).toString("hex");
    cb(null, `${nomeAleatorio}${extensao}`);
  },
});

const upload = multer({
  storage: armazenamento,
  limits: { fileSize: TAMANHO_MAX },
  fileFilter: (req, file, cb) => {
    if (!TIPOS_ACEITOS[file.mimetype]) {
      return cb(new Error("Formato não aceito. Envie um PNG, JPG ou WEBP."));
    }
    cb(null, true);
  },
});

module.exports = function registrarRotaUpload(app, autenticar) {
  app.post("/api/uploads/imagem", autenticar, (req, res) => {
    upload.single("imagem")(req, res, (erro) => {
      if (erro instanceof multer.MulterError) {
        if (erro.code === "LIMIT_FILE_SIZE") {
          return res.status(413).json({ erro: "Imagem muito grande. O tamanho máximo é 5MB." });
        }
        return res.status(400).json({ erro: "Não foi possível enviar a imagem." });
      }
      if (erro) {
        return res.status(400).json({ erro: erro.message || "Não foi possível enviar a imagem." });
      }
      if (!req.file) {
        return res.status(400).json({ erro: "Nenhuma imagem foi enviada." });
      }
      res.json({ url: `/uploads/${req.file.filename}` });
    });
  });
};