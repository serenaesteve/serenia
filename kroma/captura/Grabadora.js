/**
 * Kroma · Grabadora
 *
 * Captura audio del micrófono, vídeo de la cámara o la pantalla:
 *   getUserMedia / getDisplayMedia  →  MediaStream  →  MediaRecorder  →  Blob
 * y guarda cada grabación en IndexedDB para que siga ahí al recargar.
 *
 * Uso:  <div data-kroma="grabadora"></div>
 */

import { Almacen } from "./almacen.js";
import { AnalizadorStream } from "../procesado/cadenaAudio.js";
import { Visualizador } from "../animacion/visualizador.js";
import { decodificar } from "../procesado/formaOnda.js";
import { audioBufferAWav } from "../conversion/conversor.js";
import { ReproductorAudio } from "../reproductores/ReproductorAudio.js";
import { ReproductorVideo } from "../reproductores/ReproductorVideo.js";
import { notificar } from "../animacion/notificaciones.js";
import { registro } from "../nucleo/registro.js";
import { normalizarError, exigirContextoSeguro, ErrorSoporte } from "../nucleo/errores.js";
import { formatosGrabacion, extensionDeMime } from "../nucleo/tipos.js";
import { crear, icono, cambiarIcono, formatearTiempo, formatearBytes, descargar } from "../nucleo/utilidades.js";

const FUENTES = {
  micro: { nombre: "Micrófono", icono: "micro", tipo: "audio" },
  camara: { nombre: "Cámara", icono: "video", tipo: "video" },
  pantalla: { nombre: "Pantalla", icono: "pantalla", tipo: "video" },
};

export class Grabadora {
  /**
   * @param {HTMLElement} contenedor
   * @param {object} [opciones]
   * @param {Array<{icono: string, titulo: string, fn: (grabacion: object) => void}>} [opciones.acciones]
   *        botones extra en cada grabación (la app los usa para "Añadir a la biblioteca")
   */
  constructor(contenedor, opciones = {}) {
    this.contenedor = contenedor;
    this.accionesExtra = opciones.acciones ?? [];
    this.almacen = new Almacen();
    this.fuente = "micro";
    this.estado = "parada"; // "parada" | "cuenta" | "grabando" | "pausada"
    this.stream = null;
    this.grabador = null;
    this.trozos = [];
    this._abiertos = new Map(); // id → { fila, url, reproductor }

    this._construir();
    this._elegirFuente("micro");
    this._refrescarLista();
  }

  // ── Interfaz ─────────────────────────────────────────────────────

  _construir() {
    this.pestanas = Object.entries(FUENTES).map(([clave, { nombre, icono: ic }]) =>
      crear("button", { clase: "kr-pestana", datos: { fuente: clave }, icono: ic, eventos: { click: () => this._elegirFuente(clave) } }, [nombre]),
    );
    this.selectorFormato = crear("select", { atributos: { "aria-label": "Formato de grabación" } });

    this.previa = crear("video", { clase: "kr-grab-previa", atributos: { muted: "", playsinline: "", autoplay: "" } });
    this.previa.muted = true;
    this.lienzo = crear("canvas", { clase: "kr-grab-lienzo" });
    this.cuenta = crear("div", { clase: "kr-grab-cuenta" });
    this.marcador = crear("div", { clase: "kr-grab-rec" }, [crear("i"), crear("span", { texto: "REC" })]);
    this.escena = crear("div", { clase: "kr-grab-escena" }, [this.lienzo, this.previa, this.cuenta, this.marcador]);

    this.bGrabar = crear("button", { clase: "kr-grab-boton", icono: "grabar", titulo: "Empezar a grabar", eventos: { click: () => this.alternar() } });
    this.bPausa = crear("button", { clase: "kr-boton", icono: "pausa", titulo: "Pausar grabación", atributos: { disabled: "" }, eventos: { click: () => this.alternarPausa() } });
    this.reloj = crear("span", { clase: "kr-grab-reloj", texto: "0:00" });
    this.nivel = crear("div", { clase: "kr-medidor" }, [crear("i")]);

    this.listado = crear("ul", { clase: "kr-grabaciones" });
    this.resumen = crear("p", { clase: "kr-grab-resumen" });

    this.raiz = crear("div", { clase: "kr kr-grabadora" }, [
      crear("div", { clase: "kr-grab-barra" }, [crear("div", { clase: "kr-pestanas", atributos: { role: "tablist" } }, this.pestanas), crear("label", { clase: "kr-campo" }, [crear("span", { texto: "Formato" }), this.selectorFormato])]),
      this.escena,
      crear("div", { clase: "kr-grab-controles" }, [this.bPausa, this.bGrabar, crear("div", { clase: "kr-grab-estado" }, [this.reloj, this.nivel])]),
      crear("div", { clase: "kr-grab-cabecera-lista" }, [crear("h4", { texto: "Grabaciones guardadas" }), this.resumen]),
      this.listado,
    ]);
    this.contenedor.append(this.raiz);

    this.visualizador = new Visualizador(this.lienzo, () => this.analizador, { modo: "onda" });
    this.visualizador.iniciar();
  }

  _elegirFuente(clave) {
    if (this.estado !== "parada") return notificar("Detén la grabación antes de cambiar de fuente.", { tipo: "aviso", duracion: 2200 });
    this.fuente = clave;
    for (const p of this.pestanas) p.setAttribute("aria-selected", p.dataset.fuente === clave);
    const tipo = FUENTES[clave].tipo;
    this.raiz.dataset.tipo = tipo;

    // Formatos que este navegador sabe grabar (MediaRecorder.isTypeSupported)
    const formatos = formatosGrabacion(tipo);
    this.selectorFormato.replaceChildren(...formatos.map((m) => crear("option", { texto: m.replace(";codecs=", " · "), atributos: { value: m } })));
    this.selectorFormato.disabled = !formatos.length;
    if (!formatos.length) this.selectorFormato.append(crear("option", { texto: "No soportado" }));
  }

  // ── Grabar ───────────────────────────────────────────────────────

  alternar() {
    return this.estado === "parada" ? this.empezar() : this.estado === "cuenta" ? null : this.parar();
  }

  async empezar() {
    try {
      exigirContextoSeguro();
      if (typeof MediaRecorder === "undefined") throw new ErrorSoporte("Este navegador no soporta MediaRecorder.", { codigo: "sin-mediarecorder" });
      this.stream = await this._pedirStream();
    } catch (error) {
      return this._error(error, "No se pudo acceder al dispositivo");
    }

    // Vista previa y análisis del sonido
    if (this.stream.getVideoTracks().length) {
      this.previa.srcObject = this.stream;
      this.previa.play().catch(() => {});
    }
    if (this.stream.getAudioTracks().length) {
      try {
        this.analizador = new AnalizadorStream(this.stream);
        await this.analizador.ctx.resume();
      } catch (error) {
        registro.aviso("grabadora", "Sin analizador de audio", error);
      }
    }
    // Si el usuario deja de compartir desde el propio navegador, paramos
    for (const pista of this.stream.getTracks()) pista.addEventListener("ended", () => this.estado !== "parada" && this.parar());

    this.raiz.classList.add("kr-activa");
    this._medir();
    await this._cuentaAtras();
    if (!this.stream) return; // cancelado durante la cuenta atrás

    const mimeType = this.selectorFormato.value || undefined;
    try {
      this.grabador = new MediaRecorder(this.stream, { mimeType, audioBitsPerSecond: 128_000, videoBitsPerSecond: 2_500_000 });
    } catch (error) {
      this._liberar();
      return this._error(error, "Formato de grabación no válido");
    }
    this.trozos = [];
    this.grabador.ondataavailable = (e) => e.data.size && this.trozos.push(e.data);
    const grabador = this.grabador;
    grabador.onstop = () => this._alParar(grabador);
    this.grabador.onerror = (e) => this._error(e.error ?? e, "Error durante la grabación");
    this.grabador.start(250); // un trozo cada 250 ms: si algo falla no se pierde todo

    this.estado = "grabando";
    this._inicio = performance.now();
    this._acumulado = 0;
    this.raiz.classList.add("kr-grabando");
    this.bPausa.disabled = false;
    cambiarIcono(this.bGrabar, "parar", "Detener y guardar");
    registro.info("grabadora", `Grabando ${FUENTES[this.fuente].nombre} en ${this.grabador.mimeType}`);
  }

  _pedirStream() {
    const md = navigator.mediaDevices;
    if (!md) throw new ErrorSoporte("navigator.mediaDevices no existe: abre la página en https o localhost.", { codigo: "sin-mediadevices" });
    switch (this.fuente) {
      case "micro":
        return md.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      case "camara":
        return md.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 } }, audio: true });
      case "pantalla":
        if (!md.getDisplayMedia) throw new ErrorSoporte("Este navegador no permite grabar la pantalla.", { codigo: "sin-pantalla" });
        return md.getDisplayMedia({ video: { frameRate: 30 }, audio: true });
    }
  }

  /** 3, 2, 1… con animación CSS en cada número. */
  async _cuentaAtras() {
    this.estado = "cuenta";
    for (const n of [3, 2, 1]) {
      if (!this.stream) break;
      this.cuenta.textContent = n;
      this.cuenta.classList.remove("kr-animar");
      void this.cuenta.offsetWidth;
      this.cuenta.classList.add("kr-animar");
      await new Promise((r) => setTimeout(r, 700));
    }
    this.cuenta.textContent = "";
    this.cuenta.classList.remove("kr-animar");
  }

  alternarPausa() {
    if (!this.grabador) return;
    if (this.estado === "grabando") {
      this.grabador.pause();
      this._acumulado += performance.now() - this._inicio;
      this.estado = "pausada";
      this.raiz.classList.add("kr-pausada");
      cambiarIcono(this.bPausa, "play", "Continuar grabación");
    } else if (this.estado === "pausada") {
      this.grabador.resume();
      this._inicio = performance.now();
      this.estado = "grabando";
      this.raiz.classList.remove("kr-pausada");
      cambiarIcono(this.bPausa, "pausa", "Pausar grabación");
    }
  }

  parar() {
    if (this.estado === "cuenta" || !this.grabador) {
      this._liberar();
      return;
    }
    if (this.estado === "grabando") this._acumulado += performance.now() - this._inicio;
    this.estado = "parada";
    if (this.grabador.state !== "inactive") this.grabador.stop(); // dispara onstop
  }

  async _alParar(grabador) {
    const mime = grabador.mimeType || this.selectorFormato.value;
    const blob = new Blob(this.trozos, { type: mime });
    const duracion = this._acumulado / 1000;
    const tipo = FUENTES[this.fuente].tipo;
    this._liberar();

    if (!blob.size) return notificar("La grabación está vacía.", { tipo: "aviso" });
    const fecha = new Date();
    const grabacion = {
      nombre: `${FUENTES[this.fuente].nombre} · ${fecha.toLocaleDateString()} ${fecha.toLocaleTimeString().slice(0, 5)}`,
      tipo,
      mime,
      fecha: fecha.getTime(),
      duracion,
      tamano: blob.size,
      blob,
    };
    try {
      grabacion.id = await this.almacen.guardar(grabacion);
      notificar(`${formatearTiempo(duracion)} · ${formatearBytes(blob.size)} · ${mime.split(";")[0]}`, { tipo: "exito", titulo: "Grabación guardada" });
    } catch (error) {
      // Si no se puede guardar, al menos ofrecemos la descarga
      this._error(error, "No se pudo guardar en el navegador");
      descargar(blob, `grabacion.${extensionDeMime(mime)}`);
    }
    this._refrescarLista(grabacion.id);
  }

  /** Detiene todo y devuelve la interfaz al estado inicial. */
  _liberar() {
    this.stream?.getTracks().forEach((t) => t.stop()); // apaga el piloto de la cámara/micro
    this.stream = null;
    this.analizador?.desconectar();
    this.analizador = null;
    this.previa.srcObject = null;
    this.grabador = null;
    this.estado = "parada";
    cancelAnimationFrame(this._frameMedidor);
    this.raiz.classList.remove("kr-activa", "kr-grabando", "kr-pausada");
    this.bPausa.disabled = true;
    cambiarIcono(this.bPausa, "pausa", "Pausar grabación");
    cambiarIcono(this.bGrabar, "grabar", "Empezar a grabar");
    this.reloj.textContent = "0:00";
    this.nivel.style.setProperty("--nivel", 0);
  }

  /** Reloj y medidor de nivel, a 60 fps mientras hay stream. */
  _medir() {
    const paso = () => {
      if (!this.stream) return;
      if (this.estado === "grabando" || this.estado === "pausada") {
        const ms = this._acumulado + (this.estado === "grabando" ? performance.now() - this._inicio : 0);
        this.reloj.textContent = formatearTiempo(ms / 1000);
      }
      const nivel = this.analizador ? Math.min(1, this.analizador.nivel() * 3) : 0;
      this.nivel.style.setProperty("--nivel", nivel.toFixed(3));
      this._frameMedidor = requestAnimationFrame(paso);
    };
    paso();
  }

  _error(error, titulo) {
    const e = normalizarError(error);
    registro.error("grabadora", titulo, e.message, error);
    notificar(e.message, { tipo: "error", titulo });
  }

  // ── Lista de grabaciones ─────────────────────────────────────────

  async _refrescarLista(resaltar) {
    let grabaciones = [];
    try {
      grabaciones = await this.almacen.todas();
    } catch (error) {
      this.resumen.textContent = normalizarError(error).message;
      return;
    }
    // Cerramos los reproductores abiertos antes de redibujar
    for (const id of [...this._abiertos.keys()]) this._cerrarReproductor(id);

    if (!grabaciones.length) {
      this.listado.replaceChildren(crear("li", { clase: "kr-vacio", texto: "Todavía no hay grabaciones. Pulsa el botón rojo para empezar." }));
    } else {
      this.listado.replaceChildren(...grabaciones.map((g) => this._fila(g, g.id === resaltar)));
    }
    const total = grabaciones.reduce((s, g) => s + g.tamano, 0);
    const espacio = await Almacen.espacio();
    this.resumen.textContent = `${grabaciones.length} grabación/es · ${formatearBytes(total)}${espacio?.quota ? ` · cuota del navegador: ${formatearBytes(espacio.quota)}` : ""}`;
  }

  _fila(g, nueva) {
    const acciones = crear("div", { clase: "kr-grab-acciones" }, [
      crear("button", { clase: "kr-boton", icono: "play", titulo: "Reproducir", eventos: { click: () => this._alternarReproductor(g, fila) } }),
      crear("button", { clase: "kr-boton", icono: "descargar", titulo: "Descargar original", eventos: { click: () => descargar(g.blob, `${g.nombre.replace(/[^\w-]+/g, "_")}.${extensionDeMime(g.mime)}`) } }),
      g.tipo === "audio" ? crear("button", { clase: "kr-boton kr-boton-texto", texto: "WAV", titulo: "Convertir a WAV", eventos: { click: () => this._aWav(g) } }) : "",
      ...this.accionesExtra.map((a) => crear("button", { clase: "kr-boton", icono: a.icono, titulo: a.titulo, eventos: { click: () => a.fn(g) } })),
      crear("button", { clase: "kr-boton kr-peligro", icono: "borrar", titulo: "Borrar", eventos: { click: () => this._borrar(g) } }),
    ]);
    const nombre = crear("strong", {
      texto: g.nombre,
      titulo: "Doble clic para renombrar",
      eventos: { dblclick: () => this._renombrar(g, nombre) },
    });
    const fila = crear("li", { clase: `kr-grabacion${nueva ? " kr-nueva" : ""}`, datos: { id: g.id } }, [
      crear("span", { clase: "kr-grab-tipo" }, [icono(g.tipo === "audio" ? "micro" : "video")]),
      crear("div", { clase: "kr-grab-datos" }, [nombre, crear("small", { texto: `${formatearTiempo(g.duracion)} · ${formatearBytes(g.tamano)} · ${g.mime.split(";")[0]}` })]),
      acciones,
    ]);
    return fila;
  }

  /** Abre un reproductor Kroma dentro de la fila (la librería se usa a sí misma). */
  _alternarReproductor(g, fila) {
    if (this._abiertos.has(g.id)) return this._cerrarReproductor(g.id);
    const url = URL.createObjectURL(g.blob);
    const elemento = crear(g.tipo === "audio" ? "audio" : "video", { atributos: { src: url, "data-titulo": g.nombre } });
    const caja = crear("div", { clase: "kr-grab-reproductor" }, [elemento]);
    fila.append(caja);
    const reproductor = g.tipo === "audio" ? new ReproductorAudio(elemento, { compacto: true }) : new ReproductorVideo(elemento);
    this._abiertos.set(g.id, { caja, url, reproductor });
    reproductor.reproducir();
  }

  _cerrarReproductor(id) {
    const abierto = this._abiertos.get(id);
    if (!abierto) return;
    abierto.reproductor.pausar();
    abierto.reproductor.destruir();
    abierto.caja.remove();
    URL.revokeObjectURL(abierto.url);
    this._abiertos.delete(id);
  }

  async _aWav(g) {
    const aviso = notificar("Convirtiendo a WAV…", { duracion: 0 });
    try {
      const buffer = await decodificar(g.blob);
      const wav = audioBufferAWav(buffer);
      descargar(wav, `${g.nombre.replace(/[^\w-]+/g, "_")}.wav`);
      notificar(`${formatearBytes(g.tamano)} → ${formatearBytes(wav.size)} (sin compresión)`, { tipo: "exito", titulo: "WAV listo" });
    } catch (error) {
      this._error(error, "No se pudo convertir");
    } finally {
      aviso.cerrar();
    }
  }

  /** Apaga cámara/micro y libera todo (al salir de la vista que la contiene). */
  destruir() {
    if (this.estado !== "parada") this.parar();
    this._liberar();
    this.visualizador.destruir();
    for (const id of [...this._abiertos.keys()]) this._cerrarReproductor(id);
    this.raiz.remove();
  }

  async _borrar(g) {
    if (!confirm(`¿Borrar «${g.nombre}»?`)) return;
    await this.almacen.borrar(g.id);
    notificar("Grabación borrada", { duracion: 1800 });
    this._refrescarLista();
  }

  async _renombrar(g, elemento) {
    const nombre = prompt("Nuevo nombre:", g.nombre)?.trim();
    if (!nombre) return;
    await this.almacen.renombrar(g.id, nombre);
    g.nombre = nombre;
    elemento.textContent = nombre;
  }
}
