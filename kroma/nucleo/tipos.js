/**
 * Kroma · tipos de media
 *
 * Tabla de formatos conocidos y funciones para preguntar al navegador
 * qué puede reproducir (canPlayType) y qué puede grabar (MediaRecorder).
 */

/** Formatos que la librería conoce, por extensión. */
export const FORMATOS = {
  mp4: { mime: "video/mp4", tipo: "video", prueba: 'video/mp4; codecs="avc1.42E01E, mp4a.40.2"' },
  webm: { mime: "video/webm", tipo: "video", prueba: 'video/webm; codecs="vp9, opus"' },
  ogv: { mime: "video/ogg", tipo: "video", prueba: 'video/ogg; codecs="theora"' },
  mov: { mime: "video/quicktime", tipo: "video" },
  mkv: { mime: "video/x-matroska", tipo: "video" },
  mp3: { mime: "audio/mpeg", tipo: "audio" },
  ogg: { mime: "audio/ogg", tipo: "audio", prueba: 'audio/ogg; codecs="opus"' },
  opus: { mime: "audio/ogg", tipo: "audio", prueba: 'audio/ogg; codecs="opus"' },
  oga: { mime: "audio/ogg", tipo: "audio" },
  wav: { mime: "audio/wav", tipo: "audio" },
  flac: { mime: "audio/flac", tipo: "audio" },
  m4a: { mime: "audio/mp4", tipo: "audio", prueba: 'audio/mp4; codecs="mp4a.40.2"' },
  aac: { mime: "audio/aac", tipo: "audio" },
  weba: { mime: "audio/webm", tipo: "audio", prueba: 'audio/webm; codecs="opus"' },
  png: { mime: "image/png", tipo: "imagen" },
  jpg: { mime: "image/jpeg", tipo: "imagen" },
  jpeg: { mime: "image/jpeg", tipo: "imagen" },
  webp: { mime: "image/webp", tipo: "imagen" },
  gif: { mime: "image/gif", tipo: "imagen" },
  avif: { mime: "image/avif", tipo: "imagen" },
  vtt: { mime: "text/vtt", tipo: "subtitulos" },
  srt: { mime: "application/x-subrip", tipo: "subtitulos" },
};

/** Tipos MIME que se intentan para grabar, en orden de preferencia. */
export const FORMATOS_GRABACION = {
  audio: ["audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/mp4;codecs=mp4a.40.2", "audio/webm", "audio/mp4"],
  video: ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/mp4;codecs=avc1,mp4a.40.2", "video/webm", "video/mp4"],
};

/** "carpeta/archivo.MP3?v=2" → "mp3" */
export function extension(nombre) {
  const limpio = String(nombre).split(/[?#]/)[0];
  const punto = limpio.lastIndexOf(".");
  return punto >= 0 ? limpio.substring(punto + 1).toLowerCase() : "";
}

/**
 * Clasifica un archivo por nombre o tipo MIME.
 * @returns {"audio"|"video"|"imagen"|"subtitulos"|"desconocido"}
 */
export function tipoDeArchivo(nombre = "", mime = "") {
  if (mime.startsWith("audio/")) return "audio";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("image/")) return "imagen";
  if (mime === "text/vtt" || mime === "application/x-subrip") return "subtitulos";
  return FORMATOS[extension(nombre)]?.tipo ?? "desconocido";
}

let probador = null;

/**
 * Pregunta al navegador si puede reproducir un MIME.
 * canPlayType responde "probably", "maybe" o "" (no).
 */
export function puedeReproducir(mime) {
  probador ??= document.createElement("video");
  return probador.canPlayType(mime);
}

/** Igual que puedeReproducir pero a partir de un nombre de archivo. */
export function puedeReproducirArchivo(nombre) {
  const formato = FORMATOS[extension(nombre)];
  if (!formato) return "";
  return puedeReproducir(formato.prueba ?? formato.mime) || puedeReproducir(formato.mime);
}

/** Primer formato de grabación soportado para "audio" o "video". */
export function mejorFormatoGrabacion(tipo) {
  if (typeof MediaRecorder === "undefined") return null;
  return FORMATOS_GRABACION[tipo].find((m) => MediaRecorder.isTypeSupported(m)) ?? null;
}

/** Todos los formatos de grabación soportados. */
export function formatosGrabacion(tipo) {
  if (typeof MediaRecorder === "undefined") return [];
  return FORMATOS_GRABACION[tipo].filter((m) => MediaRecorder.isTypeSupported(m));
}

/** Extensión adecuada para guardar un Blob grabado. */
export function extensionDeMime(mime) {
  if (mime.includes("webm")) return mime.startsWith("audio") ? "weba" : "webm";
  if (mime.includes("ogg")) return "ogg";
  if (mime.includes("mp4")) return mime.startsWith("audio") ? "m4a" : "mp4";
  if (mime.includes("wav")) return "wav";
  if (mime.includes("png")) return "png";
  if (mime.includes("jpeg")) return "jpg";
  if (mime.includes("webp")) return "webp";
  return "bin";
}

/**
 * Elige la mejor fuente de una lista [{src, type}] según lo que soporte el navegador.
 * Hace lo mismo que el navegador con varias etiquetas <source>.
 */
export function elegirFuente(fuentes) {
  const puntuar = (f) => {
    const r = f.type ? puedeReproducir(f.type) : puedeReproducirArchivo(f.src);
    return r === "probably" ? 2 : r === "maybe" ? 1 : 0;
  };
  let mejor = null;
  for (const f of fuentes) if (!mejor || puntuar(f) > puntuar(mejor)) mejor = f;
  return mejor && puntuar(mejor) > 0 ? mejor : fuentes[0] ?? null;
}

/** Inventario de APIs multimedia del navegador (sección «entorno»). */
export function inventarioAPIs() {
  const v = document.createElement("video");
  return [
    ["HTMLMediaElement (audio/vídeo)", "play" in v],
    ["Web Audio API", "AudioContext" in window || "webkitAudioContext" in window],
    ["OfflineAudioContext (procesado sin reproducir)", "OfflineAudioContext" in window],
    ["Canvas 2D (procesado de píxeles)", !!document.createElement("canvas").getContext],
    ["MediaRecorder (grabación)", "MediaRecorder" in window],
    ["getUserMedia (micro/cámara)", !!navigator.mediaDevices?.getUserMedia],
    ["getDisplayMedia (pantalla)", !!navigator.mediaDevices?.getDisplayMedia],
    ["Picture-in-Picture", !!document.pictureInPictureEnabled],
    ["Fullscreen API", !!document.fullscreenEnabled],
    ["Media Session (teclas multimedia)", "mediaSession" in navigator],
    ["requestVideoFrameCallback", "requestVideoFrameCallback" in v],
    ["IndexedDB (almacenamiento)", "indexedDB" in window],
    ["Contexto seguro (https/localhost)", window.isSecureContext],
  ];
}
