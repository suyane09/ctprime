// ============================================================
// SERVICE WORKER — CT Prime
// Permite que o cardápio (e o painel) continuem funcionando
// mesmo com a conexão instável ou totalmente offline, usando
// os dados da última vez que o app conseguiu falar com o servidor.
//
// Estratégias:
// - Páginas HTML (navegação): network-first, cai pro cache se a rede falhar.
// - /api/produtos e /api/configuracoes (GET): network-first com cache de
//   apoio — o cardápio consegue mostrar o último menu conhecido offline.
// - Arquivos estáticos (/assets, /socket.io/socket.io.js, /uploads): 
//   cache-first, atualizando o cache em segundo plano (stale-while-revalidate).
// - Qualquer requisição que não seja GET (POST/PUT/PATCH/DELETE, ex: enviar
//   pedido, login) NUNCA é interceptada — vai direto pra rede, sem cache.
// ============================================================

const VERSAO_CACHE = "ctprime-v1";
const CACHE_ESTATICO = `${VERSAO_CACHE}-estatico`;
const CACHE_PAGINAS = `${VERSAO_CACHE}-paginas`;
const CACHE_API = `${VERSAO_CACHE}-api`;

const CAMINHOS_APP_SHELL = ["/cardapio.html", "/index.html", "/assets/shared.js", "/assets/manifest.json"];

self.addEventListener("install", (evento) => {
  evento.waitUntil(
    caches.open(CACHE_PAGINAS).then((cache) =>
      // addAll falharia inteiro se um item não existir; adicionamos um por um
      // pra um ícone ou arquivo faltando não impedir a instalação do SW.
      Promise.all(
        CAMINHOS_APP_SHELL.map((caminho) => cache.add(caminho).catch(() => null))
      )
    ).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (evento) => {
  evento.waitUntil(
    caches.keys().then((chaves) =>
      Promise.all(
        chaves
          .filter((chave) => chave.startsWith("ctprime-") && !chave.startsWith(VERSAO_CACHE))
          .map((chave) => caches.delete(chave))
      )
    ).then(() => self.clients.claim())
  );
});

function ehApiCacheavel(url) {
  return url.pathname === "/api/produtos" || url.pathname === "/api/configuracoes";
}

function ehEstatico(url) {
  return (
    url.pathname.startsWith("/assets/") ||
    url.pathname.startsWith("/uploads/") ||
    url.pathname === "/socket.io/socket.io.js"
  );
}

// network-first: tenta a rede, guarda uma cópia no cache; se a rede falhar, usa o cache.
async function networkFirst(requisicao, nomeCache) {
  const cache = await caches.open(nomeCache);
  try {
    const respostaRede = await fetch(requisicao);
    if (respostaRede && respostaRede.ok) cache.put(requisicao, respostaRede.clone());
    return respostaRede;
  } catch (erro) {
    const respostaCache = await cache.match(requisicao);
    if (respostaCache) return respostaCache;
    throw erro;
  }
}

// cache-first com atualização em segundo plano.
async function staleWhileRevalidate(requisicao, nomeCache) {
  const cache = await caches.open(nomeCache);
  const respostaCache = await cache.match(requisicao);
  const buscaRede = fetch(requisicao)
    .then((respostaRede) => {
      if (respostaRede && respostaRede.ok) cache.put(requisicao, respostaRede.clone());
      return respostaRede;
    })
    .catch(() => null);
  return respostaCache || buscaRede;
}

self.addEventListener("fetch", (evento) => {
  const requisicao = evento.request;
  if (requisicao.method !== "GET") return; // nunca intercepta envio de pedido, login, etc.

  const url = new URL(requisicao.url);
  if (url.origin !== self.location.origin) return; // não mexe em recursos de outra origem

  if (requisicao.mode === "navigate") {
    evento.respondWith(
      networkFirst(requisicao, CACHE_PAGINAS).catch(() => caches.match("/cardapio.html"))
    );
    return;
  }

  if (ehApiCacheavel(url)) {
    evento.respondWith(networkFirst(requisicao, CACHE_API));
    return;
  }

  if (ehEstatico(url)) {
    evento.respondWith(staleWhileRevalidate(requisicao, CACHE_ESTATICO));
    return;
  }
});
