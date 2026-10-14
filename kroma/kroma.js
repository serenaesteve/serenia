/**
 * ╔═══════════════════════════════════════════════════════════════╗
 * ║  KROMA · librería multimedia para la web                      ║
 * ╚═══════════════════════════════════════════════════════════════╝
 *
 * Punto de entrada. Importa este archivo como módulo y Kroma buscará
 * en la página los elementos con el atributo data-kroma:
 *
 *   <video data-kroma …>                 → ReproductorVideo
 *   <audio data-kroma …>                 → ReproductorAudio
 *   <div data-kroma="lista"> <audio>…    → ReproductorAudio con lista
 *   <div data-kroma="grabadora">         → Grabadora (micro / cámara / pantalla)
 *   <div data-kroma="laboratorio">       → Laboratorio de conversión
 *   <div data-kroma="monitor">           → Monitor de eventos
 *   <div data-kroma="soporte">           → Tabla de soporte del navegador
 *
 *   <script type="module" src="kroma/kroma.js"></script>
 *
 * También se puede usar desde código:
 *   import { Kroma } from "./kroma/kroma.js";
 *   const r = Kroma.video(document.querySelector("#mi-video"));
 *   r.addEventListener("kroma:fin", () => …);
 */

import { ReproductorVideo } from "./reproductores/ReproductorVideo.js";
import { ReproductorAudio } from "./reproductores/ReproductorAudio.js";
import { Grabadora } from "./captura/Grabadora.js";
import { Laboratorio } from "./componentes/Laboratorio.js";
import { Monitor } from "./componentes/Monitor.js";
import { Soporte } from "./componentes/Soporte.js";
import { notificar } from "./animacion/notificaciones.js";
import { registro } from "./nucleo/registro.js";
import * as errores from "./nucleo/errores.js";
import * as tipos from "./nucleo/tipos.js";
import * as subtitulos from "./subtitulos/subtitulos.js";
import * as conversor from "./conversion/conversor.js";

const instancias = new WeakMap();

/** Qué clase se encarga de cada valor de data-kroma. */
const FABRICAS = {
  video: (el, o) => new ReproductorVideo(el, o),
  audio: (el, o) => new ReproductorAudio(el, o),
  lista: (el, o) => new ReproductorAudio(el, o),
  grabadora: (el) => new Grabadora(el),
  laboratorio: (el) => new Laboratorio(el),
  monitor: (el) => new Monitor(el),
  soporte: (el) => new Soporte(el),
};

function tipoDe(el) {
  const valor = el.dataset.kroma;
  if (valor && valor in FABRICAS) return valor;
  if (el instanceof HTMLVideoElement) return "video";
  if (el instanceof HTMLAudioElement) return "audio";
  return null;
}

/** Crea el componente adecuado para un elemento (solo una vez por elemento). */
function mejorar(el, opciones = {}) {
  if (instancias.has(el)) return instancias.get(el);
  const tipo = tipoDe(el);
  if (!tipo) {
    registro.aviso("kroma", `data-kroma="${el.dataset.kroma}" no es un tipo conocido`, el);
    return null;
  }
  try {
    const instancia = FABRICAS[tipo](el, opciones);
    instancias.set(el, instancia);
    if (instancia.media) instancias.set(instancia.media, instancia);
    el.dataset.kromaListo = "";
    return instancia;
  } catch (error) {
    // Un componente roto no debe tumbar el resto de la página
    registro.error("kroma", `No se pudo crear «${tipo}»`, error);
    notificar(errores.normalizarError(error).message, { tipo: "error", titulo: `Kroma · ${tipo}` });
    return null;
  }
}

export const Kroma = {
  version: "1.0.0",

  /** Busca y mejora todos los [data-kroma] dentro de `raiz`. */
  iniciar(raiz = document) {
    const elementos = [...raiz.querySelectorAll("[data-kroma]:not([data-kroma-listo])")];
    // Las listas primero: sus <audio> hijos no deben convertirse por separado
    elementos.sort((a, b) => (a.dataset.kroma === "lista" ? -1 : b.dataset.kroma === "lista" ? 1 : 0));
    const creados = [];
    for (const el of elementos) {
      const lista = el.closest("[data-kroma='lista']");
      if (!el.isConnected || (lista && lista !== el)) continue;
      const instancia = mejorar(el);
      if (instancia) creados.push(instancia);
    }
    registro.info("kroma", `Iniciados ${creados.length} componente(s)`);
    return creados;
  },

  video: (el, opciones) => mejorar(el, opciones),
  audio: (el, opciones) => mejorar(el, opciones),
  lista: (el, opciones) => mejorar(el, opciones),
  grabadora: (el) => ((el.dataset.kroma = "grabadora"), mejorar(el)),
  laboratorio: (el) => ((el.dataset.kroma = "laboratorio"), mejorar(el)),

  /** Devuelve el componente asociado a un elemento (o a su <audio>/<video>). */
  de: (el) => instancias.get(el) ?? null,

  /** Activa los mensajes de depuración en la consola. */
  get depuracion() {
    return registro.activo;
  },
  set depuracion(valor) {
    registro.activo = !!valor;
    registro.info("kroma", `Depuración ${valor ? "activada" : "desactivada"}`);
  },

  notificar,
  registro,
  errores,
  tipos,
  subtitulos,
  conversor,
  clases: { ReproductorVideo, ReproductorAudio, Grabadora, Laboratorio, Monitor, Soporte },
};

// Accesible desde la consola del navegador para depurar: Kroma.depuracion = true
window.Kroma = Kroma;

// ── Arranque automático ──────────────────────────────────────────────
// <html data-kroma-manual> desactiva el arranque para iniciarlo a mano.
if (!document.documentElement.hasAttribute("data-kroma-manual")) {
  if (new URLSearchParams(location.search).has("depurar")) registro.activo = true;
  const arrancar = () => {
    Kroma.iniciar();
    // Si la página añade más elementos después, también se convierten
    new MutationObserver((cambios) => {
      for (const cambio of cambios) {
        for (const nodo of cambio.addedNodes) {
          if (nodo.nodeType !== 1) continue;
          if (nodo.matches("[data-kroma]") || nodo.querySelector("[data-kroma]")) Kroma.iniciar(nodo.parentElement ?? document);
        }
      }
    }).observe(document.body, { childList: true, subtree: true });
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", arrancar, { once: true });
  else arrancar();
}

export default Kroma;
