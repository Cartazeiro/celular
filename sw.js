// Guarda o app no celular para abrir mesmo sem internet.
// Ao mudar qualquer arquivo do app, aumente a VERSAO para os celulares atualizarem.
const VERSAO = "cartazeiro-celular-v4";
const ARQUIVOS = [
  "./",
  "./index.html",
  "./app.js",
  "./manifest.webmanifest",
  "./icones/icon-192.png",
  "./icones/icon-512.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSAO).then((c) => c.addAll(ARQUIVOS)));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((nomes) =>
      Promise.all(nomes.filter((n) => n !== VERSAO).map((n) => caches.delete(n)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return; // a ponte (Cloudflare) sempre vai direto pela internet
  // Rede primeiro (pega atualização), cache se estiver sem internet
  e.respondWith(
    fetch(req)
      .then((r) => {
        const copia = r.clone();
        caches.open(VERSAO).then((c) => c.put(req, copia));
        return r;
      })
      .catch(() => caches.match(req).then((r) => r || caches.match("./index.html")))
  );
});
