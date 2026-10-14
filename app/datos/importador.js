/**
 * Serenia · importador
 *
 * Convierte archivos sueltos (o la biblioteca de demostración) en pistas listas
 * para la base de datos. Por cada canción o vídeo:
 *
 *   1. Lee las etiquetas incrustadas (ID3, Vorbis, MP4) y la carátula
 *   2. Si no hay etiquetas, deduce artista y título del nombre: "Artista - Título.mp3"
 *   3. Audio: decodifica para calcular la forma de onda y la sonoridad (normalización)
 *      Vídeo: lee resolución y duración y captura una miniatura
 *   4. Busca archivos "acompañantes": letra (.lrc/.vtt), subtítulos (.es.srt…),
 *      capítulos (.capitulos.vtt) y carátulas de carpeta (cover.jpg, folder.jpg…)
 *   5. Extrae el color dominante de la carátula
 */

import { leerEtiquetas } from "./etiquetas.js";
import { extraerColores } from "./colores.js";
import { nuevoId } from "./bd.js";
import { decodificar, calcularPicos, analizarBuffer } from "../../kroma/procesado/formaOnda.js";
import { cargarVideo, capturarFotograma } from "../../kroma/conversion/conversor.js";
import { tipoDeArchivo, extension, puedeReproducirArchivo } from "../../kroma/nucleo/tipos.js";
import { registro } from "../../kroma/nucleo/registro.js";

const PICOS = 180; // barras de la forma de onda guardadas por pista
const OBJETIVO_RMS = -16; // dBFS al que se igualan todas las canciones
const NOMBRES_PORTADA = /^(cover|folder|front|album|albumart|portada|caratula)\.(jpe?g|png|webp)$/i;
const IDIOMAS = { es: "Español", en: "English", fr: "Français", de: "Deutsch", it: "Italiano", pt: "Português", ca: "Català", eu: "Euskara", gl: "Galego" };

/** "carpeta/Artista - Título.mp3" → { base: "artista - título", nombre: "Artista - Título" } */
function partesNombre(ruta) {
  const archivo = ruta.split("/").pop();
  const sinExt = archivo.replace(/\.[^.]+$/, "");
  return { archivo, sinExt, base: sinExt.toLowerCase(), carpeta: ruta.includes("/") ? ruta.slice(0, ruta.lastIndexOf("/")) : "" };
}

/** Separa "nombre.es.srt" en { base: "nombre", idioma: "es" } */
function baseSubtitulo(ruta) {
  const { sinExt } = partesNombre(ruta);
  const m = sinExt.match(/^(.*)\.([a-z]{2,3}|capitulos|chapters)$/i);
  return m ? { base: m[1].toLowerCase(), etiqueta: m[2].toLowerCase() } : { base: sinExt.toLowerCase(), etiqueta: "" };
}

function deducirDeNombre(sinExt) {
  const limpio = sinExt.replace(/^\d{1,3}[\s._-]+/, "").replace(/_/g, " ");
  const m = limpio.match(/^(.+?)\s+-\s+(.+)$/);
  return m ? { artista: m[1].trim(), titulo: m[2].trim() } : { titulo: limpio.trim() };
}

/** Sonoridad → ganancia en dB para que todas suenen parecido (sin pasar de 0 dBFS). */
function calcularGanancia(buffer) {
  const { picoDb, rmsDb } = analizarBuffer(buffer);
  if (!Number.isFinite(rmsDb)) return 0;
  const ganancia = Math.max(-12, Math.min(9, OBJETIVO_RMS - rmsDb));
  return Math.round(Math.min(ganancia, -picoDb - 0.3) * 10) / 10;
}

/** Los picos de cada canal en 0-255 (Uint8Array ocupa 4 veces menos que Float32Array). */
function picosCompactos(buffer) {
  return calcularPicos(buffer, PICOS).map((canal) => Uint8Array.from(canal, (v) => Math.round(v * 255)));
}

/**
 * Analiza un archivo multimedia y devuelve la pista.
 * @param {object} o
 * @param {Blob} o.blob        contenido
 * @param {string} o.ruta      nombre o ruta relativa
 * @param {string} [o.url]     si viene de la demo: se guarda la URL, no el archivo
 * @param {object} [o.extras]  { letra, subtitulos, capitulos, portada, titulo, artista }
 */
export async function analizar({ blob, ruta, url, extras = {} }) {
  const { archivo, sinExt } = partesNombre(ruta);
  const tipo = tipoDeArchivo(archivo, blob.type);
  const etiquetas = await leerEtiquetas(blob);
  const deducido = deducirDeNombre(sinExt);

  const pista = {
    id: nuevoId(),
    tipo,
    titulo: extras.titulo || etiquetas.titulo || deducido.titulo,
    artista: extras.artista || etiquetas.artista || deducido.artista || "Artista desconocido",
    artistaAlbum: etiquetas.artistaAlbum || "",
    album: etiquetas.album || (tipo === "video" ? "Vídeos" : "Sin álbum"),
    anio: etiquetas.anio || "",
    numero: etiquetas.numero || 0,
    genero: etiquetas.genero || "",
    etiqueta: etiquetas.formato,
    nombreArchivo: archivo,
    formato: extension(archivo).toUpperCase(),
    mime: blob.type || "",
    tamano: blob.size,
    fechaAlta: Date.now(),
    origen: url ? "url" : "archivo",
    url: url || null,
    archivo: url ? null : blob,
    portada: extras.portada || etiquetas.portada || null,
    letra: null,
    subtitulos: extras.subtitulos || [],
    capitulos: extras.capitulos || null,
    duracion: 0,
    picos: null,
    ganancia: 0,
    favorito: false,
    reproducciones: 0,
    ultimaVez: 0,
    posicion: 0,
  };

  if (extras.letra) pista.letra = { texto: extras.letra, sincronizada: true };
  else if (etiquetas.letra) pista.letra = { texto: etiquetas.letra, sincronizada: false };

  if (!puedeReproducirArchivo(archivo) && !blob.type) registro.aviso("importador", `Puede que el navegador no reproduzca ${archivo}`);

  if (tipo === "audio") {
    try {
      const buffer = await decodificar(blob);
      pista.duracion = buffer.duration;
      pista.frecuencia = buffer.sampleRate;
      pista.canales = buffer.numberOfChannels;
      pista.picos = picosCompactos(buffer);
      pista.ganancia = calcularGanancia(buffer);
    } catch (error) {
      registro.aviso("importador", `${archivo}: no se pudo decodificar`, error);
      pista.error = "No se puede decodificar este audio en este navegador";
    }
  } else if (tipo === "video") {
    const urlTemporal = URL.createObjectURL(blob);
    try {
      const video = await cargarVideo(urlTemporal);
      pista.duracion = video.duration;
      pista.ancho = video.videoWidth;
      pista.alto = video.videoHeight;
      // Miniatura al 20 % del vídeo (al principio suele haber negro)
      await new Promise((resolver) => {
        video.addEventListener("seeked", resolver, { once: true });
        video.currentTime = Math.min(video.duration * 0.2, 30);
      });
      if (!pista.portada) pista.portada = await capturarFotograma(video, { tipo: "image/jpeg", calidad: 0.82, ancho: 640 });
      video.removeAttribute("src");
    } catch (error) {
      registro.aviso("importador", `${archivo}: no se pudo leer el vídeo`, error);
      pista.error = "Este navegador no puede abrir el vídeo";
    } finally {
      URL.revokeObjectURL(urlTemporal);
    }
  }

  pista.color = await extraerColores(pista.portada);
  return pista;
}

/**
 * Importa archivos elegidos por el usuario (o soltados en la ventana).
 * Agrupa los acompañantes por nombre: "peli.mp4" + "peli.es.srt" + "peli.capitulos.vtt".
 * @param {File[]} archivos
 * @param {(hechos: number, total: number, nombre: string) => void} [alProgresar]
 */
export async function importarArchivos(archivos, alProgresar) {
  const ruta = (f) => f.webkitRelativePath || f.name;
  const multimedia = archivos.filter((f) => ["audio", "video"].includes(tipoDeArchivo(f.name, f.type)));
  const textos = archivos.filter((f) => /\.(lrc|vtt|srt)$/i.test(f.name));
  const imagenes = archivos.filter((f) => tipoDeArchivo(f.name, f.type) === "imagen");

  const pistas = [];
  for (const [n, f] of multimedia.entries()) {
    alProgresar?.(n, multimedia.length, f.name);
    const { base, carpeta } = partesNombre(ruta(f));
    const extras = { subtitulos: [] };

    for (const t of textos) {
      const info = baseSubtitulo(ruta(t));
      const mismaBase = partesNombre(ruta(t)).base === base;
      if (/\.lrc$/i.test(t.name) && mismaBase) extras.letra = await t.text();
      else if (info.base === base && ["capitulos", "chapters"].includes(info.etiqueta)) extras.capitulos = await t.text();
      else if (info.base === base || mismaBase) {
        const texto = await t.text();
        if (tipoDeArchivo(f.name, f.type) === "audio") extras.letra = texto;
        else extras.subtitulos.push({ texto, idioma: info.etiqueta, etiqueta: IDIOMAS[info.etiqueta] ?? (info.etiqueta.toUpperCase() || "Subtítulos") });
      }
    }
    // Carátula: misma base (cancion.jpg) o la de la carpeta (cover.jpg)
    const imagen =
      imagenes.find((i) => partesNombre(ruta(i)).base === base) ??
      imagenes.find((i) => partesNombre(ruta(i)).carpeta === carpeta && NOMBRES_PORTADA.test(i.name));
    if (imagen) extras.portada = imagen;

    try {
      pistas.push(await analizar({ blob: f, ruta: ruta(f), extras }));
    } catch (error) {
      registro.error("importador", `No se pudo importar ${f.name}`, error);
    }
  }
  alProgresar?.(multimedia.length, multimedia.length, "");
  return pistas;
}

/** Descarga la biblioteca de demostración descrita en media/biblioteca.json. */
export async function importarDemo(alProgresar) {
  const respuesta = await fetch("media/biblioteca.json");
  if (!respuesta.ok) throw new Error("No se encontró media/biblioteca.json");
  const { elementos } = await respuesta.json();
  const texto = async (src) => {
    try {
      const r = await fetch(src);
      return r.ok ? await r.text() : null;
    } catch {
      return null;
    }
  };
  const pistas = [];
  for (const [n, e] of elementos.entries()) {
    alProgresar?.(n, elementos.length, e.src.split("/").pop());
    try {
      const blob = await (await fetch(e.src)).blob();
      const subtitulos = [];
      for (const src of e.subtitulos ?? []) {
        const { etiqueta } = baseSubtitulo(src);
        const contenido = await texto(src);
        if (contenido) subtitulos.push({ texto: contenido, idioma: etiqueta, etiqueta: `${IDIOMAS[etiqueta] ?? etiqueta}${src.endsWith(".srt") ? " (SRT)" : ""}` });
      }
      const pista = await analizar({
        blob,
        ruta: e.src,
        url: e.src,
        extras: {
          titulo: e.titulo,
          artista: e.artista,
          letra: e.letra ? await texto(e.letra) : null,
          subtitulos,
          capitulos: e.capitulos ? await texto(e.capitulos) : null,
        },
      });
      pista.demo = true;
      pistas.push(pista);
    } catch (error) {
      registro.error("importador", `Demo: no se pudo cargar ${e.src}`, error);
    }
  }
  alProgresar?.(elementos.length, elementos.length, "");
  return pistas;
}
