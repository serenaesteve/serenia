/**
 * Kroma · conversión de formatos
 *
 *  Audio:      cualquier formato decodificable → WAV PCM (16/24 bits o 32 float)
 *              remuestreo (44.1 kHz → 16 kHz…), mono ↔ estéreo, normalizar,
 *              fundidos, invertir, recortar y "renderizar" con ecualizador.
 *  Imagen:     fotograma de vídeo / imagen → PNG, JPEG o WebP (con calidad)
 *  Vídeo:      hoja de contactos (varios fotogramas en una sola imagen)
 *  Subtítulos: SRT ↔ VTT (en subtitulos.js)
 */

import { BANDAS } from "../procesado/cadenaAudio.js";
import { ErrorFormato, ErrorSoporte } from "../nucleo/errores.js";
import { formatearTiempo } from "../nucleo/utilidades.js";

// ── Audio → WAV ──────────────────────────────────────────────────────

/**
 * Codifica un AudioBuffer como archivo WAV (RIFF).
 * La cabecera ocupa 44 bytes y después van las muestras intercaladas L R L R…
 * @param {AudioBuffer} buffer
 * @param {object} [o]
 * @param {16|24|32} [o.bits] 32 = coma flotante
 * @returns {Blob}
 */
export function audioBufferAWav(buffer, { bits = 16 } = {}) {
  const canales = buffer.numberOfChannels;
  const frecuencia = buffer.sampleRate;
  const muestras = buffer.length;
  const bytesMuestra = bits / 8;
  const formato = bits === 32 ? 3 : 1; // 3 = IEEE float, 1 = PCM entero
  const tamDatos = muestras * canales * bytesMuestra;
  const vista = new DataView(new ArrayBuffer(44 + tamDatos));

  const texto = (pos, s) => [...s].forEach((c, i) => vista.setUint8(pos + i, c.charCodeAt(0)));
  texto(0, "RIFF");
  vista.setUint32(4, 36 + tamDatos, true);
  texto(8, "WAVE");
  texto(12, "fmt ");
  vista.setUint32(16, 16, true); //                        tamaño del bloque fmt
  vista.setUint16(20, formato, true);
  vista.setUint16(22, canales, true);
  vista.setUint32(24, frecuencia, true);
  vista.setUint32(28, frecuencia * canales * bytesMuestra, true); // bytes por segundo
  vista.setUint16(32, canales * bytesMuestra, true); //           bytes por muestra (todas las pistas)
  vista.setUint16(34, bits, true);
  texto(36, "data");
  vista.setUint32(40, tamDatos, true);

  const datosCanal = Array.from({ length: canales }, (_, c) => buffer.getChannelData(c));
  let pos = 44;
  for (let i = 0; i < muestras; i++) {
    for (let c = 0; c < canales; c++) {
      const v = Math.max(-1, Math.min(1, datosCanal[c][i]));
      if (bits === 16) {
        vista.setInt16(pos, v < 0 ? v * 0x8000 : v * 0x7fff, true);
      } else if (bits === 24) {
        const entero = Math.round(v < 0 ? v * 0x800000 : v * 0x7fffff);
        vista.setUint8(pos, entero & 0xff);
        vista.setUint8(pos + 1, (entero >> 8) & 0xff);
        vista.setUint8(pos + 2, (entero >> 16) & 0xff);
      } else {
        vista.setFloat32(pos, v, true);
      }
      pos += bytesMuestra;
    }
  }
  return new Blob([vista], { type: "audio/wav" });
}

// ── Procesado de AudioBuffer ─────────────────────────────────────────

/**
 * Cambia frecuencia de muestreo y/o número de canales.
 * OfflineAudioContext "reproduce" el audio a máxima velocidad sin sonar
 * y nos devuelve el resultado: el navegador hace el remuestreo y la mezcla.
 */
export async function remuestrear(buffer, { frecuencia = buffer.sampleRate, canales = buffer.numberOfChannels } = {}) {
  const longitud = Math.ceil(buffer.duration * frecuencia);
  const ctx = new OfflineAudioContext(canales, longitud, frecuencia);
  const fuente = ctx.createBufferSource();
  fuente.buffer = buffer;
  fuente.connect(ctx.destination); // Web Audio mezcla automáticamente estéreo → mono
  fuente.start();
  return ctx.startRendering();
}

/**
 * Renderiza el audio pasando por el ecualizador (las mismas bandas que el reproductor).
 * Así se puede exportar exactamente lo que se está escuchando.
 */
export async function renderizarConEcualizador(buffer, ganancias, balance = 0) {
  const ctx = new OfflineAudioContext(buffer.numberOfChannels, buffer.length, buffer.sampleRate);
  const fuente = ctx.createBufferSource();
  fuente.buffer = buffer;
  let nodo = fuente;
  BANDAS.forEach(({ frecuencia, tipo }, i) => {
    const f = ctx.createBiquadFilter();
    f.type = tipo;
    f.frequency.value = frecuencia;
    f.Q.value = 1.1;
    f.gain.value = ganancias[i] ?? 0;
    nodo.connect(f);
    nodo = f;
  });
  const panorama = ctx.createStereoPanner();
  panorama.pan.value = balance;
  nodo.connect(panorama);
  panorama.connect(ctx.destination);
  fuente.start();
  return ctx.startRendering();
}

/** Crea un AudioBuffer vacío con la misma forma que otro. */
function copiaVacia(buffer, longitud = buffer.length) {
  return new AudioBuffer({ length: longitud, numberOfChannels: buffer.numberOfChannels, sampleRate: buffer.sampleRate });
}

/** Sube el volumen hasta que el pico llega a `objetivoDb` (por defecto -1 dBFS). */
export function normalizar(buffer, objetivoDb = -1) {
  let pico = 0;
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    for (const v of buffer.getChannelData(c)) pico = Math.max(pico, Math.abs(v));
  }
  if (pico === 0) return buffer;
  const factor = 10 ** (objetivoDb / 20) / pico;
  const salida = copiaVacia(buffer);
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const origen = buffer.getChannelData(c);
    const destino = salida.getChannelData(c);
    for (let i = 0; i < origen.length; i++) destino[i] = origen[i] * factor;
  }
  return salida;
}

/** Fundido de entrada y de salida (curva de potencia constante). */
export function fundidos(buffer, segundos = 1) {
  const n = Math.min(Math.floor(segundos * buffer.sampleRate), Math.floor(buffer.length / 2));
  const salida = copiaVacia(buffer);
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const destino = salida.getChannelData(c);
    destino.set(buffer.getChannelData(c));
    for (let i = 0; i < n; i++) {
      const g = Math.sin((i / n) * (Math.PI / 2));
      destino[i] *= g;
      destino[destino.length - 1 - i] *= g;
    }
  }
  return salida;
}

/** Audio al revés. */
export function invertir(buffer) {
  const salida = copiaVacia(buffer);
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    salida.getChannelData(c).set(buffer.getChannelData(c).slice().reverse());
  }
  return salida;
}

/** Recorta entre dos instantes (segundos). */
export function recortar(buffer, inicio, fin) {
  const a = Math.max(0, Math.floor(inicio * buffer.sampleRate));
  const b = Math.min(buffer.length, Math.floor(fin * buffer.sampleRate));
  if (b <= a) throw new ErrorFormato("El recorte está vacío: el final debe ser mayor que el inicio.", { codigo: "recorte" });
  const salida = copiaVacia(buffer, b - a);
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    salida.getChannelData(c).set(buffer.getChannelData(c).subarray(a, b));
  }
  return salida;
}

// ── Imágenes ─────────────────────────────────────────────────────────

/** canvas.toBlob con promesa + comprobación de que el formato existe. */
export function lienzoABlob(lienzo, tipo = "image/png", calidad = 0.92) {
  return new Promise((resolver, rechazar) => {
    lienzo.toBlob(
      (blob) => {
        if (!blob) return rechazar(new ErrorSoporte(`El navegador no puede generar ${tipo}.`, { codigo: "formato-imagen" }));
        // Si el formato no está soportado, toBlob devuelve PNG en silencio
        if (blob.type !== tipo) {
          return rechazar(new ErrorSoporte(`Este navegador no sabe codificar ${tipo}; ha devuelto ${blob.type}.`, { codigo: "formato-imagen" }));
        }
        resolver(blob);
      },
      tipo,
      calidad,
    );
  });
}

/**
 * Captura el fotograma actual de un <video> (o copia un canvas ya procesado).
 * @param {HTMLVideoElement|HTMLCanvasElement} origen
 */
export function capturarFotograma(origen, { tipo = "image/png", calidad = 0.92, ancho } = {}) {
  const anchoOrigen = origen.videoWidth ?? origen.width;
  const altoOrigen = origen.videoHeight ?? origen.height;
  if (!anchoOrigen) throw new ErrorFormato("Todavía no hay ningún fotograma cargado.", { codigo: "sin-fotograma" });
  const escala = ancho ? ancho / anchoOrigen : 1;
  const lienzo = document.createElement("canvas");
  lienzo.width = Math.round(anchoOrigen * escala);
  lienzo.height = Math.round(altoOrigen * escala);
  lienzo.getContext("2d").drawImage(origen, 0, 0, lienzo.width, lienzo.height);
  return lienzoABlob(lienzo, tipo, calidad);
}

/** Convierte una imagen (File/Blob) a otro formato y, opcionalmente, otro ancho. */
export async function convertirImagen(archivo, { tipo = "image/webp", calidad = 0.85, ancho } = {}) {
  const imagen = await createImageBitmap(archivo).catch((error) => {
    throw new ErrorFormato("No se ha podido leer la imagen.", { codigo: "imagen", causa: error });
  });
  const escala = ancho ? Math.min(1, ancho / imagen.width) : 1;
  const lienzo = document.createElement("canvas");
  lienzo.width = Math.round(imagen.width * escala);
  lienzo.height = Math.round(imagen.height * escala);
  const ctx = lienzo.getContext("2d");
  if (tipo === "image/jpeg") {
    // JPEG no tiene transparencia: ponemos fondo blanco
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, lienzo.width, lienzo.height);
  }
  ctx.drawImage(imagen, 0, 0, lienzo.width, lienzo.height);
  imagen.close();
  return lienzoABlob(lienzo, tipo, calidad);
}

// ── Vídeo ────────────────────────────────────────────────────────────

/** Espera a que un vídeo termine de saltar a un instante. */
function irA(video, t) {
  return new Promise((resolver, rechazar) => {
    const listo = () => {
      video.removeEventListener("error", fallo);
      resolver();
    };
    const fallo = () => {
      video.removeEventListener("seeked", listo);
      rechazar(new ErrorFormato("Error al leer el vídeo.", { codigo: "seek" }));
    };
    video.addEventListener("seeked", listo, { once: true });
    video.addEventListener("error", fallo, { once: true });
    video.currentTime = t;
  });
}

/** Carga un vídeo (URL u objeto URL) en un elemento oculto y espera a sus metadatos. */
export function cargarVideo(src) {
  return new Promise((resolver, rechazar) => {
    const video = document.createElement("video");
    video.muted = true;
    video.preload = "auto";
    video.playsInline = true;
    video.onloadeddata = () => resolver(video);
    video.onerror = () => rechazar(new ErrorFormato("El navegador no puede abrir este vídeo.", { codigo: "video" }));
    video.src = src;
  });
}

/**
 * Hoja de contactos: `columnas × filas` fotogramas repartidos por todo el vídeo.
 * @param {HTMLVideoElement} video un vídeo ya cargado (se moverá su currentTime)
 */
export async function hojaDeContactos(video, { columnas = 4, filas = 3, ancho = 1280, alProgresar } = {}) {
  const total = columnas * filas;
  const celdaAncho = Math.floor(ancho / columnas);
  const celdaAlto = Math.round((celdaAncho * video.videoHeight) / video.videoWidth);
  const lienzo = document.createElement("canvas");
  lienzo.width = celdaAncho * columnas;
  lienzo.height = celdaAlto * filas;
  const ctx = lienzo.getContext("2d");
  ctx.fillStyle = "#0d0f14";
  ctx.fillRect(0, 0, lienzo.width, lienzo.height);
  ctx.font = `600 ${Math.max(12, celdaAncho / 14)}px system-ui, sans-serif`;

  for (let i = 0; i < total; i++) {
    const t = ((i + 0.5) / total) * video.duration;
    await irA(video, t);
    const x = (i % columnas) * celdaAncho;
    const y = Math.floor(i / columnas) * celdaAlto;
    ctx.drawImage(video, x + 2, y + 2, celdaAncho - 4, celdaAlto - 4);
    const marca = formatearTiempo(t);
    const medida = ctx.measureText(marca).width;
    ctx.fillStyle = "rgba(0,0,0,.65)";
    ctx.fillRect(x + 8, y + celdaAlto - 34, medida + 14, 26);
    ctx.fillStyle = "#fff";
    ctx.fillText(marca, x + 15, y + celdaAlto - 15);
    alProgresar?.((i + 1) / total);
  }
  return lienzoABlob(lienzo, "image/png");
}
