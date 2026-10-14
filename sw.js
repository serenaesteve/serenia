/**
 * Serenia · service worker
 *
 * Estrategia "primero la red": siempre intenta descargar la versión nueva y
 * guarda una copia. Si no hay conexión, sirve la copia. Así la app funciona
 * sin internet y nunca se queda con archivos viejos mientras programas.
 *
 * Los audios y vídeos NO se guardan aquí (pesan mucho y el navegador los pide
 * por trozos con cabeceras Range); los importados ya viven en IndexedDB.
 */

const CACHE = "serenia-v1";
const ESENCIALES = ["./", "index.html", "app/app.css", "kroma/kroma.css", "app/main.js", "manifest.webmanifest", "iconos/icono-192.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ESENCIALES)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((claves) => Promise.all(claves.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (e) => {
  const peticion = e.request;
  const url = new URL(peticion.url);
  const esMultimedia = /\.(mp3|ogg|opus|wav|flac|m4a|mp4|webm|mkv)$/i.test(url.pathname);
  if (peticion.method !== "GET" || url.origin !== location.origin || peticion.headers.has("range") || esMultimedia) return;

  e.respondWith(
    fetch(peticion)
      .then((respuesta) => {
        if (respuesta.ok) {
          const copia = respuesta.clone();
          caches.open(CACHE).then((c) => c.put(peticion, copia));
        }
        return respuesta;
      })
      .catch(() => caches.match(peticion).then((r) => r ?? caches.match("index.html"))),
  );
});
