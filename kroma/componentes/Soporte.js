/**
 * Kroma · Soporte del navegador
 *
 * Analiza el entorno de ejecución: qué formatos puede reproducir
 * (canPlayType), cuáles puede grabar (MediaRecorder.isTypeSupported)
 * y qué APIs multimedia están disponibles.
 *
 * Uso:  <div data-kroma="soporte"></div>
 */

import { puedeReproducir, inventarioAPIs, FORMATOS_GRABACION } from "../nucleo/tipos.js";
import { crear } from "../nucleo/utilidades.js";

const PRUEBAS_REPRODUCCION = [
  ["MP4 · H.264 + AAC", 'video/mp4; codecs="avc1.42E01E, mp4a.40.2"'],
  ["MP4 · H.265/HEVC", 'video/mp4; codecs="hvc1.1.6.L93.B0"'],
  ["MP4 · AV1", 'video/mp4; codecs="av01.0.05M.08"'],
  ["WebM · VP8 + Vorbis", 'video/webm; codecs="vp8, vorbis"'],
  ["WebM · VP9 + Opus", 'video/webm; codecs="vp9, opus"'],
  ["Ogg · Theora", 'video/ogg; codecs="theora"'],
  ["MP3", "audio/mpeg"],
  ["AAC (M4A)", 'audio/mp4; codecs="mp4a.40.2"'],
  ["Ogg · Opus", 'audio/ogg; codecs="opus"'],
  ["Ogg · Vorbis", 'audio/ogg; codecs="vorbis"'],
  ["WAV · PCM", 'audio/wav; codecs="1"'],
  ["FLAC", "audio/flac"],
];

function insignia(texto, clase) {
  return crear("span", { clase: `kr-insignia ${clase}`, texto });
}

function tabla(titulo, filas) {
  return crear("section", { clase: "kr-soporte-bloque" }, [
    crear("h4", { texto: titulo }),
    crear("table", {}, [crear("tbody", {}, filas.map(([nombre, celda, pista]) => crear("tr", {}, [crear("th", { texto: nombre, titulo: pista }), crear("td", {}, [celda])])))]),
  ]);
}

export class Soporte {
  constructor(contenedor) {
    const reproduccion = PRUEBAS_REPRODUCCION.map(([nombre, mime]) => {
      const r = puedeReproducir(mime);
      return [nombre, r === "probably" ? insignia("Sí", "kr-si") : r === "maybe" ? insignia("Quizá", "kr-quiza") : insignia("No", "kr-no"), mime];
    });

    const hayGrabador = typeof MediaRecorder !== "undefined";
    const grabacion = [...FORMATOS_GRABACION.audio, ...FORMATOS_GRABACION.video].map((mime) => [
      mime.replace(";codecs=", " · "),
      hayGrabador && MediaRecorder.isTypeSupported(mime) ? insignia("Sí", "kr-si") : insignia("No", "kr-no"),
      mime,
    ]);

    const apis = inventarioAPIs().map(([nombre, ok]) => [nombre, ok ? insignia("Disponible", "kr-si") : insignia("No", "kr-no")]);

    const agente = navigator.userAgentData?.brands?.filter((m) => !/not.a.brand/i.test(m.brand)).map((m) => `${m.brand} ${m.version}`).join(" · ") || navigator.userAgent;

    contenedor.append(
      crear("div", { clase: "kr kr-soporte" }, [
        crear("p", { clase: "kr-soporte-agente", texto: `Navegador: ${agente}` }),
        crear("div", { clase: "kr-soporte-rejilla" }, [tabla("Reproducción (canPlayType)", reproduccion), tabla("Grabación (MediaRecorder)", grabacion), tabla("APIs multimedia", apis)]),
      ]),
    );
  }
}
