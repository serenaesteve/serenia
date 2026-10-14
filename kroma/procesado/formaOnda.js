/**
 * Kroma · forma de onda
 *
 * Descarga un archivo de audio, lo decodifica a muestras (AudioBuffer)
 * y lo resume en N "picos" para dibujarlo como una barra de progreso.
 */

import { ErrorCarga, ErrorFormato, normalizarError } from "../nucleo/errores.js";
import { registro } from "../nucleo/registro.js";

const cache = new Map();

/**
 * Descarga y decodifica un audio (MP3, OGG, WAV… lo que soporte el navegador).
 * Se usa un OfflineAudioContext: decodifica sin necesidad de que el usuario
 * haya interactuado con la página.
 * @param {string|Blob} origen URL o Blob
 * @returns {Promise<AudioBuffer>}
 */
export async function decodificar(origen) {
  const clave = typeof origen === "string" ? origen : null;
  if (clave && cache.has(clave)) return cache.get(clave);

  const tarea = (async () => {
    let datos;
    if (typeof origen === "string") {
      let respuesta;
      try {
        respuesta = await fetch(origen);
      } catch (error) {
        throw normalizarError(error);
      }
      if (!respuesta.ok) throw new ErrorCarga(`No se pudo descargar «${origen}» (HTTP ${respuesta.status}).`, { codigo: "404" });
      datos = await respuesta.arrayBuffer();
    } else {
      datos = await origen.arrayBuffer();
    }
    const ctx = new OfflineAudioContext(2, 1, 44100);
    try {
      const buffer = await ctx.decodeAudioData(datos);
      registro.info(
        "onda",
        `Decodificado: ${buffer.duration.toFixed(1)} s · ${buffer.sampleRate} Hz · ${buffer.numberOfChannels} canal(es)`,
      );
      return buffer;
    } catch (error) {
      throw new ErrorFormato("No se ha podido decodificar el audio (archivo dañado o códec no soportado).", {
        codigo: "decodificacion",
        causa: error,
      });
    }
  })();

  if (clave) {
    cache.set(clave, tarea);
    tarea.catch(() => cache.delete(clave));
  }
  return tarea;
}

/**
 * Resume cada canal en `cantidad` valores entre 0 y 1 (pico absoluto de cada tramo).
 * @param {AudioBuffer} buffer
 * @param {number} cantidad
 * @returns {Float32Array[]} un array por canal (máximo 2)
 */
export function calcularPicos(buffer, cantidad) {
  const canales = Math.min(2, buffer.numberOfChannels);
  const resultado = [];
  for (let c = 0; c < canales; c++) {
    const muestras = buffer.getChannelData(c);
    const tramo = Math.max(1, Math.floor(muestras.length / cantidad));
    // No hace falta mirar todas las muestras de cada tramo: con ~200 basta
    const salto = Math.max(1, Math.floor(tramo / 200));
    const picos = new Float32Array(cantidad);
    for (let i = 0; i < cantidad; i++) {
      let maximo = 0;
      const fin = Math.min(muestras.length, (i + 1) * tramo);
      for (let j = i * tramo; j < fin; j += salto) {
        const v = Math.abs(muestras[j]);
        if (v > maximo) maximo = v;
      }
      picos[i] = maximo;
    }
    resultado.push(picos);
  }
  // Normalizamos para que la onda ocupe todo el alto aunque el audio sea flojo
  const global = Math.max(...resultado.map((p) => Math.max(...p)), 0.0001);
  for (const picos of resultado) for (let i = 0; i < picos.length; i++) picos[i] /= global;
  return resultado;
}

/** Estadísticas de un AudioBuffer: pico y RMS en dBFS. */
export function analizarBuffer(buffer) {
  let pico = 0;
  let suma = 0;
  let total = 0;
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const d = buffer.getChannelData(c);
    for (let i = 0; i < d.length; i++) {
      const v = Math.abs(d[i]);
      if (v > pico) pico = v;
      suma += v * v;
    }
    total += d.length;
  }
  const rms = Math.sqrt(suma / Math.max(1, total));
  const db = (v) => (v > 0 ? 20 * Math.log10(v) : -Infinity);
  return { picoDb: db(pico), rmsDb: db(rms) };
}
