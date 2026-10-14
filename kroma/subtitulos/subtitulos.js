/**
 * Kroma · subtítulos y letras
 *
 * Lee WebVTT (.vtt) y SubRip (.srt), convierte entre ambos formatos
 * y localiza rápidamente la frase que toca en cada instante.
 *
 * Formato interno de una frase (cue):  { inicio, fin, texto }  en segundos.
 */

import { ErrorCarga, ErrorFormato, normalizarError } from "../nucleo/errores.js";
import { registro } from "../nucleo/registro.js";

// "01:02:03.456"  "02:03,456"  "2:03.4"
const MARCA = String.raw`(?:\d+:)?\d{1,2}:\d{2}[.,]\d{1,3}`;
const LINEA_TIEMPO = new RegExp(`^\\s*(${MARCA})\\s*-->\\s*(${MARCA})`);

/** "00:01:02,500" → 62.5 */
export function tiempoASegundos(marca) {
  const partes = marca.trim().replace(",", ".").split(":").map(Number);
  return partes.reduce((total, parte) => total * 60 + parte, 0);
}

/** 62.5 → "00:01:02.500"  (separador "," para SRT) */
export function segundosAMarca(segundos, separador = ".") {
  const ms = Math.round(segundos * 1000);
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms / 60_000) % 60);
  const s = Math.floor((ms / 1000) % 60);
  const resto = ms % 1000;
  const dos = (n) => String(n).padStart(2, "0");
  return `${dos(h)}:${dos(m)}:${dos(s)}${separador}${String(resto).padStart(3, "0")}`;
}

/**
 * Letras en formato LRC:  [01:02.50]texto de la línea
 * Cada línea dura hasta que empieza la siguiente.
 */
export function parsearLRC(texto) {
  const frases = [];
  const marca = /\[(\d+):(\d{1,2}(?:[.,]\d{1,3})?)\]/g;
  for (const linea of texto.replace(/\r/g, "").split("\n")) {
    const tiempos = [...linea.matchAll(marca)].map((m) => Number(m[1]) * 60 + Number(m[2].replace(",", ".")));
    const contenido = linea.replace(marca, "").trim();
    // Una línea puede tener varias marcas si se repite (estribillos)
    for (const t of tiempos) frases.push({ inicio: t, fin: t, texto: contenido || "♪" });
  }
  frases.sort((a, b) => a.inicio - b.inicio);
  frases.forEach((f, i) => (f.fin = frases[i + 1]?.inicio ?? f.inicio + 6));
  if (texto.trim() && !frases.length) throw new ErrorFormato("El archivo LRC no tiene líneas con marca de tiempo.", { codigo: "lrc-vacio" });
  return frases;
}

/** ¿Es un LRC? (marcas [mm:ss] y ninguna flecha "-->") */
export const esLRC = (texto) => !texto.includes("-->") && /^\s*\[\d+:\d{1,2}/m.test(texto);

/**
 * Convierte el texto de un .vtt o .srt en una lista ordenada de frases.
 * Ignora la cabecera WEBVTT, los bloques NOTE/STYLE, los números de SRT
 * y los ajustes de posición que van detrás de la marca de tiempo.
 */
export function parsear(texto) {
  if (esLRC(texto)) return parsearLRC(texto);
  const bloques = texto
    .replace(/^﻿/, "")
    .replace(/\r\n?/g, "\n")
    .split(/\n{2,}/);

  const frases = [];
  for (const bloque of bloques) {
    const lineas = bloque.split("\n");
    const i = lineas.findIndex((l) => LINEA_TIEMPO.test(l));
    if (i === -1) continue; // WEBVTT, NOTE, STYLE…
    const [, desde, hasta] = lineas[i].match(LINEA_TIEMPO);
    const contenido = lineas
      .slice(i + 1)
      .join("\n")
      .replace(/<[^>]+>/g, "") // etiquetas <i>, <v Nombre>, <00:01.000>…
      .trim();
    if (!contenido) continue;
    frases.push({ inicio: tiempoASegundos(desde), fin: tiempoASegundos(hasta), texto: contenido });
  }
  frases.sort((a, b) => a.inicio - b.inicio);

  if (texto.trim() && frases.length === 0) {
    throw new ErrorFormato("El archivo no contiene subtítulos válidos (ni WebVTT ni SRT).", { codigo: "subtitulos-vacios" });
  }
  return frases;
}

/** Lista de frases → texto WebVTT */
export function aVtt(frases) {
  const cuerpo = frases
    .map((f) => `${segundosAMarca(f.inicio)} --> ${segundosAMarca(f.fin)}\n${f.texto}`)
    .join("\n\n");
  return `WEBVTT\n\n${cuerpo}\n`;
}

/** Lista de frases → texto SRT */
export function aSrt(frases) {
  return (
    frases
      .map((f, i) => `${i + 1}\n${segundosAMarca(f.inicio, ",")} --> ${segundosAMarca(f.fin, ",")}\n${f.texto}`)
      .join("\n\n") + "\n"
  );
}

/** Conversión directa entre formatos de texto. */
export const srtAVtt = (texto) => aVtt(parsear(texto));
export const vttASrt = (texto) => aSrt(parsear(texto));

/** Desplaza todas las frases (para corregir subtítulos desincronizados). */
export function desplazar(frases, segundos) {
  return frases
    .map((f) => ({ ...f, inicio: f.inicio + segundos, fin: f.fin + segundos }))
    .filter((f) => f.fin > 0)
    .map((f) => ({ ...f, inicio: Math.max(0, f.inicio) }));
}

/**
 * Una pista de subtítulos cargada desde un archivo.
 * Se usa tanto para los subtítulos de vídeo como para las letras de canciones.
 */
export class PistaSubtitulos {
  /**
   * @param {object} o
   * @param {string} o.src        ruta al .vtt o .srt
   * @param {string} [o.idioma]   código (es, en…)
   * @param {string} [o.etiqueta] nombre visible en el menú
   * @param {string} [o.texto]    contenido ya leído (en vez de descargarlo de src)
   */
  constructor({ src = "", idioma = "", etiqueta = "", texto = null }) {
    this.src = src;
    this.texto = texto;
    this.idioma = idioma;
    this.etiqueta = etiqueta || idioma.toUpperCase() || "Subtítulos";
    this.frases = [];
    this.cargada = false;
  }

  async cargar() {
    if (this.cargada) return this;
    if (this.texto !== null) {
      this.frases = parsear(this.texto);
      this.cargada = true;
      return this;
    }
    let respuesta;
    try {
      respuesta = await fetch(this.src);
    } catch (error) {
      throw normalizarError(error);
    }
    if (!respuesta.ok) {
      throw new ErrorCarga(`No se encontró el archivo de subtítulos «${this.src}» (HTTP ${respuesta.status}).`, {
        codigo: "subtitulos-404",
      });
    }
    this.frases = parsear(await respuesta.text());
    this.cargada = true;
    registro.info("subtítulos", `${this.etiqueta}: ${this.frases.length} frases desde ${this.src}`);
    return this;
  }

  /**
   * Índice de la frase activa en el instante t, o -1.
   * Búsqueda binaria: con miles de frases sigue siendo instantáneo.
   */
  indiceEn(t) {
    const f = this.frases;
    let bajo = 0;
    let alto = f.length - 1;
    while (bajo <= alto) {
      const medio = (bajo + alto) >> 1;
      if (f[medio].fin <= t) bajo = medio + 1;
      else if (f[medio].inicio > t) alto = medio - 1;
      else return medio;
    }
    return -1;
  }

  /** Índice de la última frase que ya ha empezado (para letras de karaoke). */
  ultimaIniciadaEn(t) {
    let resultado = -1;
    for (let i = 0; i < this.frases.length && this.frases[i].inicio <= t; i++) resultado = i;
    return resultado;
  }
}
