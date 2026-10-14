/**
 * Kroma · Monitor de eventos
 *
 * Muestra en directo los eventos de TODOS los <audio> y <video> de la página
 * y los avisos/errores del registro de Kroma. Sirve para entender el ciclo
 * de vida de un elemento multimedia y para depurar.
 *
 * Truco: los eventos multimedia no "burbujean", pero sí pasan por la fase de
 * captura. Con addEventListener(…, true) en document los vemos todos.
 *
 * Uso:  <div data-kroma="monitor"></div>
 */

import { registro } from "../nucleo/registro.js";
import { crear, nombreBase } from "../nucleo/utilidades.js";

export const EVENTOS_MEDIA = {
  carga: ["loadstart", "durationchange", "loadedmetadata", "loadeddata", "canplay", "canplaythrough", "progress", "suspend", "stalled", "emptied", "abort"],
  reproduccion: ["play", "playing", "pause", "ended", "waiting", "seeking", "seeked", "ratechange", "volumechange", "timeupdate"],
  error: ["error"],
};

const KROMA = ["kroma:reproducir", "kroma:pausa", "kroma:fin", "kroma:error", "kroma:pista", "kroma:subtitulos", "kroma:efectos", "kroma:captura", "kroma:ecualizador", "kroma:exportar"];
const RUIDOSOS = new Set(["timeupdate", "progress"]);
const MAXIMO = 250;

export class Monitor {
  constructor(contenedor) {
    this.contenedor = contenedor;
    this.pausado = false;
    this.ocultarRuidosos = true;
    this.contadores = {};
    this._construir();
    this._escuchar();
  }

  _construir() {
    this.lista = crear("ol", { clase: "kr-monitor-lista", atributos: { "aria-live": "off" } });
    this.contador = crear("span", { clase: "kr-monitor-contador", texto: "0 eventos" });
    const casilla = crear("input", { atributos: { type: "checkbox", checked: "" }, eventos: { change: (e) => (this.ocultarRuidosos = e.target.checked) } });
    this.bPausa = crear("button", { clase: "kr-boton-secundario", texto: "Pausar", eventos: { click: () => this._alternarPausa() } });
    this.raiz = crear("div", { clase: "kr kr-monitor" }, [
      crear("header", {}, [
        this.contador,
        crear("label", { clase: "kr-interruptor" }, [casilla, crear("span", { texto: "Ocultar timeupdate / progress" })]),
        this.bPausa,
        crear("button", { clase: "kr-boton-secundario", texto: "Limpiar", eventos: { click: () => this.limpiar() } }),
      ]),
      crear("div", { clase: "kr-monitor-leyenda" }, [
        crear("span", { clase: "kr-ev-carga", texto: "carga" }),
        crear("span", { clase: "kr-ev-reproduccion", texto: "reproducción" }),
        crear("span", { clase: "kr-ev-kroma", texto: "kroma" }),
        crear("span", { clase: "kr-ev-aviso", texto: "aviso" }),
        crear("span", { clase: "kr-ev-error", texto: "error" }),
      ]),
      this.lista,
    ]);
    this.contenedor.append(this.raiz);
    this.inicio = performance.now();
  }

  _escuchar() {
    for (const [categoria, eventos] of Object.entries(EVENTOS_MEDIA)) {
      for (const tipo of eventos) {
        document.addEventListener(tipo, (e) => this._alEventoMedia(e, categoria), true);
      }
    }
    for (const tipo of KROMA) {
      document.addEventListener(tipo, (e) => this.anotar("kroma", tipo, this._origen(e.target), this._detalleKroma(e)));
    }
    registro.suscribir((entrada) => {
      if (entrada.nivel === "info") return;
      const texto = entrada.datos.map((d) => (d instanceof Error ? d.message : typeof d === "object" ? "" : String(d))).join(" ");
      this.anotar(entrada.nivel, entrada.nivel, entrada.origen, texto);
    });
  }

  _alEventoMedia(e, categoria) {
    const m = e.target;
    if (!(m instanceof HTMLMediaElement)) return;
    let detalle = `t=${m.currentTime.toFixed(2)} s`;
    if (e.type === "loadedmetadata") detalle += m.videoWidth ? ` · ${m.videoWidth}×${m.videoHeight}` : "";
    if (e.type === "durationchange") detalle = `duración=${Number.isFinite(m.duration) ? m.duration.toFixed(2) + " s" : m.duration}`;
    if (e.type === "volumechange") detalle = `volumen=${Math.round(m.volume * 100)} %${m.muted ? " (silencio)" : ""}`;
    if (e.type === "ratechange") detalle = `velocidad=${m.playbackRate}×`;
    if (e.type === "error") detalle = `MediaError código ${m.error?.code ?? "?"} ${m.error?.message ?? ""}`;
    if (e.type === "loadstart") detalle = `readyState=${m.readyState} networkState=${m.networkState}`;
    this.anotar(categoria, e.type, this._origen(m), detalle);
  }

  _origen(el) {
    if (!el) return "?";
    const media = el instanceof HTMLMediaElement ? el : el.querySelector?.("audio, video");
    return media?.dataset.titulo || media?.id || nombreBase(media?.currentSrc || "") || el.tagName?.toLowerCase() || "?";
  }

  _detalleKroma(e) {
    const d = e.detail ?? {};
    if (d.error) return d.error.message;
    if (d.pista?.titulo) return d.pista.titulo;
    if (d.pista?.etiqueta) return d.pista.etiqueta;
    if (d.ajustes) return `filtro=${d.ajustes.filtro}`;
    if (d.blob) return `${d.blob.type} · ${Math.round(d.blob.size / 1024)} KB`;
    return "";
  }

  /** Añade una fila al monitor. */
  anotar(categoria, tipo, origen, detalle = "") {
    this.contadores[tipo] = (this.contadores[tipo] ?? 0) + 1;
    const total = Object.values(this.contadores).reduce((a, b) => a + b, 0);
    this.contador.textContent = `${total} eventos`;
    if (this.pausado || (this.ocultarRuidosos && RUIDOSOS.has(tipo))) return;

    const segundos = (performance.now() - this.inicio) / 1000;
    const fila = crear("li", { clase: `kr-ev-${categoria}` }, [
      crear("time", { texto: segundos.toFixed(3).padStart(8, " ") }),
      crear("b", { texto: tipo }),
      crear("span", { clase: "kr-ev-origen", texto: origen }),
      crear("span", { clase: "kr-ev-detalle", texto: detalle }),
    ]);
    this.lista.prepend(fila);
    while (this.lista.children.length > MAXIMO) this.lista.lastElementChild.remove();
  }

  limpiar() {
    this.lista.replaceChildren();
    this.contadores = {};
    this.contador.textContent = "0 eventos";
  }

  _alternarPausa() {
    this.pausado = !this.pausado;
    this.bPausa.textContent = this.pausado ? "Reanudar" : "Pausar";
  }
}
