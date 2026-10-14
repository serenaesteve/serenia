/**
 * Kroma · ReproductorBase
 *
 * Lo que comparten el reproductor de vídeo y el de audio:
 *  - reproducir/pausar controlando las excepciones de play()
 *  - volumen, silencio y velocidad (recordados entre visitas)
 *  - detección y traducción de errores del elemento multimedia
 *  - emisión de eventos propios ("kroma:…") para que la página reaccione
 *
 * Extiende EventTarget: se puede hacer  reproductor.addEventListener("kroma:error", …)
 */

import { desdeMediaError, normalizarError } from "../nucleo/errores.js";
import { registro } from "../nucleo/registro.js";
import { preferencias, limitar } from "../nucleo/utilidades.js";
import { notificar } from "../animacion/notificaciones.js";

export const VELOCIDADES = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

export class ReproductorBase extends EventTarget {
  /**
   * @param {HTMLMediaElement} media
   * @param {object} [opciones]
   * @param {boolean} [opciones.notificaciones] mostrar tostadas de error (por defecto sí)
   */
  constructor(media, opciones = {}) {
    super();
    this.media = media;
    this.opciones = { notificaciones: true, ...opciones };
    this.nombre = media.id || media.dataset.titulo || media.getAttribute("src") || media.tagName.toLowerCase();
    this._limpiezas = [];
    this._errorMostrado = false;

    media.controls = false; // los controles los ponemos nosotros
    media.volume = preferencias.leer("volumen", 1);
    media.muted = media.muted || preferencias.leer("silencio", false);

    this._escucharErrores();
    this._escuchar(media, "volumechange", () => {
      preferencias.guardar("volumen", media.volume);
      preferencias.guardar("silencio", media.muted);
    });
    this._escuchar(media, "loadedmetadata", () => this._arreglarDuracionInfinita());
  }

  // ── Control ─────────────────────────────────────────────────────

  get reproduciendo() {
    return !this.media.paused && !this.media.ended;
  }

  /**
   * play() devuelve una promesa que puede fallar:
   *  - NotAllowedError: el navegador bloquea el autoplay con sonido
   *  - NotSupportedError: no hay ninguna fuente válida
   *  - AbortError: se cambió de archivo mientras cargaba (no es un error real)
   */
  async reproducir() {
    try {
      await this.antesDeReproducir();
      await this.media.play();
    } catch (error) {
      if (error.name === "AbortError") return;
      this.informarError(normalizarError(error));
    }
  }

  /** Gancho para las subclases (p. ej. reanudar el AudioContext). */
  async antesDeReproducir() {}

  pausar() {
    this.media.pause();
  }

  alternar() {
    return this.media.paused || this.media.ended ? this.reproducir() : this.pausar();
  }

  /** Salta `segundos` hacia delante (positivo) o atrás (negativo). */
  saltar(segundos) {
    this.irA(this.media.currentTime + segundos);
  }

  irA(segundos) {
    const duracion = this.duracion;
    if (!Number.isFinite(duracion)) return;
    this.media.currentTime = limitar(segundos, 0, duracion);
  }

  get duracion() {
    return this.media.duration;
  }

  set volumen(v) {
    this.media.volume = limitar(v, 0, 1);
    if (v > 0) this.media.muted = false;
  }

  get volumen() {
    return this.media.muted ? 0 : this.media.volume;
  }

  alternarSilencio() {
    this.media.muted = !this.media.muted;
    // Si estaba a 0 y lo "des-silenciamos", le damos algo de volumen
    if (!this.media.muted && this.media.volume === 0) this.media.volume = 0.5;
  }

  set velocidad(v) {
    this.media.playbackRate = v;
    this.media.preservesPitch = true; // que la voz no suene a ardilla
  }

  get velocidad() {
    return this.media.playbackRate;
  }

  /** Pasa a la siguiente velocidad de la lista (o anterior con direccion = -1). */
  cambiarVelocidad(direccion = 1) {
    const i = VELOCIDADES.indexOf(this.velocidad);
    const siguiente = VELOCIDADES[limitar((i === -1 ? 3 : i) + direccion, 0, VELOCIDADES.length - 1)];
    this.velocidad = siguiente;
    return siguiente;
  }

  // ── Eventos propios ─────────────────────────────────────────────

  emitir(nombre, detalle = {}) {
    const evento = new CustomEvent(`kroma:${nombre}`, { detail: { reproductor: this, ...detalle } });
    this.dispatchEvent(evento);
    // También en el elemento, para poder escuchar con addEventListener desde el HTML
    this.media.dispatchEvent(new CustomEvent(`kroma:${nombre}`, { detail: evento.detail, bubbles: true }));
  }

  // ── Errores ─────────────────────────────────────────────────────

  _escucharErrores() {
    // Error del propio elemento (archivo dañado, formato no soportado…)
    this._escuchar(this.media, "error", () => {
      if (this.media.error) this.informarError(desdeMediaError(this.media.error));
    });
    // Con varias <source>, los errores llegan a cada <source>, no al <video>.
    // Cuando falla la última, networkState pasa a NETWORK_NO_SOURCE.
    for (const fuente of this.media.querySelectorAll("source")) {
      this._escuchar(fuente, "error", () => {
        registro.aviso(this.nombre, `Fuente descartada: ${fuente.src} (${fuente.type || "sin tipo"})`);
        if (this.media.networkState === HTMLMediaElement.NETWORK_NO_SOURCE) {
          this.informarError(desdeMediaError({ code: 4 }));
        }
      });
    }
    this._escuchar(this.media, "loadstart", () => {
      this._errorMostrado = false;
    });
  }

  /** Muestra el error una sola vez por carga, lo registra y lo emite como evento. */
  informarError(error) {
    registro.error(this.nombre, error.message, error.cause ?? "");
    this.emitir("error", { error });
    if (this._errorMostrado) return;
    this._errorMostrado = true;
    if (this.opciones.notificaciones) {
      notificar(error.message, { tipo: "error", titulo: this.tituloError ?? "No se puede reproducir" });
    }
    this.mostrarError?.(error);
  }

  /**
   * Chrome guarda las grabaciones de MediaRecorder sin duración (Infinity).
   * Truco conocido: saltar al final obliga al navegador a calcularla.
   */
  _arreglarDuracionInfinita() {
    if (this.media.duration !== Infinity) return;
    registro.aviso(this.nombre, "Duración infinita (archivo de MediaRecorder): calculándola…");
    const alActualizar = () => {
      if (this.media.duration === Infinity) return;
      this.media.removeEventListener("durationchange", alActualizar);
      this.media.currentTime = 0;
      this.emitir("duracion", { duracion: this.media.duration });
    };
    this.media.addEventListener("durationchange", alActualizar);
    this.media.currentTime = 1e101;
  }

  // ── Utilidades internas ─────────────────────────────────────────

  /** addEventListener que se deshace automáticamente al destruir el reproductor. */
  _escuchar(objetivo, evento, fn, opciones) {
    objetivo.addEventListener(evento, fn, opciones);
    this._limpiezas.push(() => objetivo.removeEventListener(evento, fn, opciones));
  }

  destruir() {
    for (const limpiar of this._limpiezas) limpiar();
    this._limpiezas = [];
  }
}
