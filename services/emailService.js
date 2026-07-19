const nodemailer = require("nodemailer");

// Transportador usando o Gmail via SMTP.
// Exige as variáveis de ambiente GMAIL_USER e GMAIL_APP_PASSWORD no .env
// (a senha deve ser uma "Senha de app" do Google, não a senha normal da conta).
const transportador = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_APP_PASSWORD,
  },
});

// Link do painel mostrado no e-mail. Em produção, defina APP_URL no .env
// (ex: APP_URL=https://ctprime.onrender.com/index.html). Sem essa variável,
// cai no localhost — só funciona pra testes na sua própria máquina.
const APP_URL = process.env.APP_URL || "http://localhost:3000/index.html";

// URL pública de uma imagem de logo (ex: hospedada no Imgur, no próprio
// Render, etc). Sem essa variável, o e-mail usa o emblema "CT" estilizado
// como está hoje. Basta definir LOGO_URL no .env quando tiver o link.
const LOGO_URL = process.env.LOGO_URL || "";

function montarHtmlBoasVindas({ nome, email, senha }) {
  return `
  <!DOCTYPE html>
  <html lang="pt-BR">
  <body style="margin:0;padding:0;background:#f5f5f2;font-family:Arial,Helvetica,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:32px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="background:#141414;border-radius:16px;overflow:hidden;">
            <tr>
              <td style="padding:32px 32px 20px;text-align:center;">
                ${LOGO_URL
                  ? `<img src="${LOGO_URL}" width="56" height="56" alt="CT Prime" style="border-radius:50%;display:block;margin:0 auto;object-fit:cover;" />`
                  : `<div style="width:56px;height:56px;border-radius:50%;background:#d4a72c;display:inline-flex;align-items:center;justify-content:center;font-family:Georgia,serif;font-weight:700;font-size:24px;color:#141414;line-height:56px;">CT</div>`
                }
                <h1 style="color:#ffffff;font-size:20px;margin:16px 0 0;">Bem-vindo(a) ao CT Prime</h1>
              </td>
            </tr>
            <tr>
              <td style="padding:0 32px 32px;">
                <p style="color:#d1d5db;font-size:14px;line-height:1.6;">Olá, <strong style="color:#ffffff;">${nome}</strong>!</p>
                <p style="color:#d1d5db;font-size:14px;line-height:1.6;">Seu acesso ao painel administrativo do <strong style="color:#d4a72c;">CT Prime</strong> foi criado. Confira seus dados de acesso abaixo:</p>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#1f1f1f;border-radius:12px;margin:20px 0;">
                  <tr>
                    <td style="padding:16px 20px;border-bottom:1px solid rgba(255,255,255,0.06);">
                      <p style="margin:0;color:#9ca3af;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;">Nome</p>
                      <p style="margin:2px 0 0;color:#ffffff;font-size:15px;font-weight:600;">${nome}</p>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:16px 20px;border-bottom:1px solid rgba(255,255,255,0.06);">
                      <p style="margin:0;color:#9ca3af;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;">E-mail</p>
                      <p style="margin:2px 0 0;color:#ffffff;font-size:15px;font-weight:600;">${email}</p>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:16px 20px;">
                      <p style="margin:0;color:#9ca3af;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;">Senha provisória</p>
                      <p style="margin:2px 0 0;color:#d4a72c;font-size:15px;font-weight:700;">${senha}</p>
                    </td>
                  </tr>
                </table>
                <p style="color:#9ca3af;font-size:12.5px;line-height:1.6;">Por segurança, recomendamos alterar essa senha assim que possível após o primeiro acesso.</p>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:24px;">
                  <tr>
                    <td align="center">
                      <a href="${APP_URL}" style="display:inline-block;background:#d4a72c;color:#141414;font-weight:700;font-size:14px;text-decoration:none;padding:12px 32px;border-radius:999px;">Acessar o painel</a>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
  </html>`;
}

// Envia o e-mail de boas-vindas. Nunca lança erro para quem chamou —
// se o e-mail falhar, isso não deve impedir o cadastro do usuário no sistema.
async function enviarEmailBoasVindas({ nome, email, senha }) {
  try {
    await transportador.sendMail({
      from: `"CT Prime" <${process.env.GMAIL_USER}>`,
      to: email,
      subject: "Seu acesso ao CT Prime foi criado",
      html: montarHtmlBoasVindas({ nome, email, senha }),
    });
    console.log(`📧 E-mail de boas-vindas enviado para ${email}`);
  } catch (erro) {
    console.error("⚠️  Falha ao enviar e-mail de boas-vindas:", erro.message);
  }
}

module.exports = { enviarEmailBoasVindas };