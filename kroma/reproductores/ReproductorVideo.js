/**
 * Kroma · ReproductorVideo
 *
 * Convierte un <video> normal en un reproductor completo:
 *   controles propios que se ocultan solos · barra con buffer y miniatura al pasar el ratón
 *   subtítulos VTT/SRT en varios idiomas · velocidad · captura de fotograma
 *   panel de efectos en tiempo real · Picture-in-Picture · pantalla completa
 *   atajos de teclado con ayuda (tecla ?)
 *
 * Uso:  <video data-kroma src="video.mp4" data-titulo="Mi vídeo">
 *         <track kind="subtitles" src="video.es.srt" srclang="es" label="Español" default>
 *       </video>
 */

import { ReproductorBase, VELOCIDADES } from "./ReproductorBase.js";
import { ProcesadorVideo, FILTROS, AJUSTES_INICIALES } from "../procesado/filtrosVideo.js";
import { PistaSubtitulos, parsear } from "../subtitulos/subtitulos.js";
import { capturarFotograma } from "../conversion/conversor.js";
import { notificar } from "../animacion/notificaciones.js";
import { registro } from "../nucleo/registro.js";
import { normalizarError, desdeMediaError } from "../nucleo/errores.js";
import {
  crear,
  icono,
  cambiarIcono,
  crearDeslizador,
  formatearTiempo,
  limitar,
  limitarFrecuencia,
  descargar,
  nombreBase,
  sinExtension,
} from "../nucleo/utilidades.js";

const OCULTAR_CONTROLES_MS = 2600;

const ATAJOS = [
  ["Espacio / K", "Reproducir o pausar"],
  ["← / →", "Retroceder / avanzar 5 s"],
  ["J / L", "Retroceder / avanzar 10 s"],
  ["↑ / ↓", "Subir / bajar volumen"],
  [", / .", "Fotograma anterior / siguiente (en pausa)"],
  ["< / >", "Menos / más velocidad"],
  ["0 … 9", "Saltar al 0 % … 90 %"],
  ["M", "Silenciar"],
  ["C", "Subtítulos"],
  ["E", "Panel de efectos"],
  ["S", "Capturar fotograma"],
  ["P", "Picture-in-Picture"],
  ["F", "Pantalla completa"],
  ["?", "Mostrar esta ayuda"],
];

export class ReproductorVideo extends ReproductorBase {
  constructor(video, opciones = {}) {
    super(video, opciones);
    this.titulo = video.dataset.titulo ?? "";
    /** @type {PistaSubtitulos[]} */
    this.pistas = [];
    this.pistaActiva = null;
    this.capitulos = [];
    this._indiceFrase = -1;
    this._mostrarRestante = false;

    if (!video.preload || video.preload === "none") video.preload = "metadata";
    video.playsInline = true;

    this._construir();
    this.procesador = new ProcesadorVideo(video, this.lienzo);
    this._construirPanelEfectos();
    this._conectar();
    this._leerPistas();
    this._comprobarEstadoInicial();
    registro.info(this.nombre, "Reproductor de vídeo listo");
  }

  // ════════════════════════════════════════════════════════════════
  //  Interfaz
  // ════════════════════════════════════════════════════════════════

  _construir() {
    const v = this.media;

    this.raiz = crear("div", {
      clase: "kr kr-video kr-inicio",
      atributos: { tabindex: 0, role: "region", "aria-label": `Reproductor de vídeo ${this.titulo}`.trim() },
    });
    v.before(this.raiz);

    // Capas de la escena (de abajo a arriba)
    this.lienzo = crear("canvas", { clase: "kr-lienzo", atributos: { "aria-hidden": "true" } });
    this.capaSubtitulos = crear("div", { clase: "kr-subtitulos", atributos: { "aria-live": "polite" } });
    this.capaFeedback = crear("div", { clase: "kr-feedback" });
    this.capaCargando = crear("div", { clase: "kr-cargando" }, [crear("span"), crear("span"), crear("span")]);
    this.capaError = crear("div", { clase: "kr-error-capa" });
    this.botonGrande = crear("button", {
      clase: "kr-boton-grande",
      icono: "play",
      titulo: "Reproducir",
      eventos: {
        click: (e) => {
          e.stopPropagation();
          // El botón desaparece al reproducir: pasamos el foco al reproductor para que sigan funcionando los atajos
          this.raiz.focus({ preventScroll: true });
          this.reproducir();
        },
      },
    });
    this.cabecera = crear("div", { clase: "kr-cabecera" }, [
      crear("span", { clase: "kr-cabecera-titulo", texto: this.titulo }),
      (this.chipInfo = crear("span", { clase: "kr-chip" })),
      (this.chipFx = crear("span", { clase: "kr-chip kr-chip-fx", texto: "FX" })),
    ]);
    this.ayuda = this._construirAyuda();

    // Barra de progreso
    this.relleno = crear("div", { clase: "kr-progreso-relleno" });
    this.buffer = crear("div", { clase: "kr-progreso-buffer" });
    this.marcasCapitulos = crear("div", { clase: "kr-capitulos" });
    this.previaLienzo = crear("canvas", { atributos: { width: 192, height: 108 } });
    this.previaTiempo = crear("span");
    this.previa = crear("div", { clase: "kr-previa" }, [this.previaLienzo, this.previaTiempo]);
    this.progreso = crear(
      "div",
      {
        clase: "kr-progreso",
        atributos: { role: "slider", "aria-label": "Posición", "aria-valuemin": 0, tabindex: -1 },
      },
      [crear("div", { clase: "kr-progreso-carril" }, [this.buffer, this.relleno, this.marcasCapitulos]), crear("div", { clase: "kr-progreso-cabezal" }), this.previa],
    );

    // Botones
    const b = (icono, titulo, accion, clase = "") =>
      crear("button", { clase: `kr-boton ${clase}`.trim(), icono, titulo, eventos: { click: accion } });

    this.bPlay = b("play", "Reproducir (K)", () => this.alternar(), "kr-boton-play");
    this.bAtras = b("atras", "Retroceder 10 s (J)", () => this._saltarConFeedback(-10));
    this.bAdelante = b("adelante", "Avanzar 10 s (L)", () => this._saltarConFeedback(10));
    this.bVolumen = b("volumen", "Silenciar (M)", () => this.alternarSilencio());
    this.deslizadorVolumen = crear("input", {
      clase: "kr-volumen",
      atributos: { type: "range", min: 0, max: 1, step: 0.01, value: v.volume, "aria-label": "Volumen" },
      eventos: { input: (e) => (this.volumen = Number(e.target.value)) },
    });
    this.tiempo = crear("button", {
      clase: "kr-tiempo",
      texto: "0:00 / 0:00",
      titulo: "Cambiar entre tiempo transcurrido y restante",
      eventos: { click: () => ((this._mostrarRestante = !this._mostrarRestante), this._pintarTiempo()) },
    });
    this.bVelocidad = crear("button", {
      clase: "kr-boton kr-boton-texto",
      texto: "1×",
      titulo: "Velocidad",
      eventos: { click: () => this._menuVelocidad() },
    });
    this.bSubtitulos = b("subtitulos", "Subtítulos (C)", () => this._menuSubtitulos());
    this.bEfectos = b("efectos", "Efectos en tiempo real (E)", () => this.alternarPanel());
    this.bCaptura = b("camara", "Capturar fotograma (S)", () => this.capturar());
    this.bPip = b("pip", "Picture-in-Picture (P)", () => this.alternarPip());
    this.bAyuda = b("teclado", "Atajos de teclado (?)", () => this.alternarAyuda());
    this.bCompleta = b("completa", "Pantalla completa (F)", () => this.alternarPantallaCompleta());

    if (!document.pictureInPictureEnabled) this.bPip.hidden = true;
    if (!document.fullscreenEnabled && !document.webkitFullscreenEnabled) this.bCompleta.hidden = true;

    this.controles = crear("div", { clase: "kr-controles" }, [
      this.progreso,
      crear("div", { clase: "kr-fila" }, [
        crear("div", { clase: "kr-grupo" }, [
          this.bPlay,
          this.bAtras,
          this.bAdelante,
          crear("div", { clase: "kr-grupo-volumen" }, [this.bVolumen, this.deslizadorVolumen]),
          this.tiempo,
        ]),
        crear("div", { clase: "kr-grupo" }, [this.bVelocidad, this.bSubtitulos, this.bEfectos, this.bCaptura, this.bPip, this.bAyuda, this.bCompleta]),
      ]),
    ]);

    this.escena = crear("div", { clase: "kr-escena" }, [
      v,
      this.lienzo,
      this.capaSubtitulos,
      this.capaFeedback,
      this.capaCargando,
      this.botonGrande,
      this.capaError,
      this.cabecera,
      this.ayuda,
      this.controles,
    ]);
    this.raiz.append(this.escena);
    this._pintarVolumen();
  }

  _construirAyuda() {
    return crear("div", { clase: "kr-ayuda", atributos: { hidden: "" } }, [
      crear("div", { clase: "kr-ayuda-caja" }, [
        crear("h3", { texto: "Atajos de teclado" }),
        crear(
          "dl",
          {},
          ATAJOS.flatMap(([tecla, accion]) => [crear("dt", {}, [crear("kbd", { texto: tecla })]), crear("dd", { texto: accion })]),
        ),
        crear("button", { clase: "kr-boton-texto kr-ayuda-cerrar", texto: "Cerrar", eventos: { click: () => this.alternarAyuda(false) } }),
      ]),
    ]);
  }

  _construirPanelEfectos() {
    const p = this.procesador;

    const chips = Object.entries(FILTROS).map(([clave, { nombre, muestra }]) =>
      crear(
        "button",
        {
          clase: "kr-filtro",
          datos: { filtro: clave },
          atributos: { "aria-pressed": clave === "ninguno" },
          eventos: { click: () => this.aplicarEfectos({ filtro: clave }) },
        },
        [crear("span", { clase: "kr-filtro-muestra", atributos: { style: `background:${muestra}` } }), crear("span", { texto: nombre })],
      ),
    );
    this._chipsFiltro = chips;

    const porcentaje = (v) => `${v} %`;
    const conSigno = (v) => (v > 0 ? `+${v}` : `${v}`);
    this._deslizadores = {
      intensidad: crearDeslizador({ etiqueta: "Intensidad", min: 0, max: 100, valor: 100, formato: porcentaje, alCambiar: (v) => this.aplicarEfectos({ intensidad: v }) }),
      brillo: crearDeslizador({ etiqueta: "Brillo", min: -100, max: 100, valor: 0, formato: conSigno, alCambiar: (v) => this.aplicarEfectos({ brillo: v }) }),
      contraste: crearDeslizador({ etiqueta: "Contraste", min: -100, max: 100, valor: 0, formato: conSigno, alCambiar: (v) => this.aplicarEfectos({ contraste: v }) }),
      saturacion: crearDeslizador({ etiqueta: "Saturación", min: 0, max: 200, valor: 100, formato: porcentaje, alCambiar: (v) => this.aplicarEfectos({ saturacion: v }) }),
      temperatura: crearDeslizador({ etiqueta: "Temperatura", min: -100, max: 100, valor: 0, formato: conSigno, alCambiar: (v) => this.aplicarEfectos({ temperatura: v }) }),
      vineta: crearDeslizador({ etiqueta: "Viñeta", min: 0, max: 100, valor: 0, formato: porcentaje, alCambiar: (v) => this.aplicarEfectos({ vineta: v }) }),
    };

    this._casillaComparar = crear("input", {
      atributos: { type: "checkbox" },
      eventos: { change: (e) => this.aplicarEfectos({ comparar: e.target.checked }) },
    });
    this.estadisticas = crear("p", { clase: "kr-estadisticas", texto: "Sin procesar: el vídeo se muestra directamente." });

    this.panel = crear("aside", { clase: "kr-panel", atributos: { "aria-label": "Efectos de vídeo", hidden: "" } }, [
      crear("header", {}, [
        crear("h3", { texto: "Efectos en vivo" }),
        crear("button", { clase: "kr-boton", icono: "cerrar", titulo: "Cerrar panel", eventos: { click: () => this.alternarPanel(false) } }),
      ]),
      crear("div", { clase: "kr-filtros" }, chips),
      ...Object.values(this._deslizadores).map((d) => d.raiz),
      crear("label", { clase: "kr-interruptor" }, [this._casillaComparar, crear("span", { texto: "Comparar antes / después" })]),
      crear("div", { clase: "kr-panel-acciones" }, [
        crear("button", { clase: "kr-boton-texto", icono: "reiniciar", texto: "", eventos: { click: () => this.restablecerEfectos() } }, [" Restablecer"]),
        crear("button", { clase: "kr-boton-texto", icono: "camara", eventos: { click: () => this.capturar() } }, [" Capturar"]),
      ]),
      this.estadisticas,
    ]);
    // Que los clics en el panel no pausen el vídeo
    this.panel.addEventListener("click", (e) => e.stopPropagation());
    this.escena.append(this.panel);
  }

  // ════════════════════════════════════════════════════════════════
  //  Eventos
  // ════════════════════════════════════════════════════════════════

  _conectar() {
    const v = this.media;
    const on = (obj, ev, fn, op) => this._escuchar(obj, ev, fn, op);

    // ── Estado del vídeo → interfaz
    on(v, "play", () => {
      this.raiz.classList.remove("kr-inicio", "kr-terminado");
      cambiarIcono(this.bPlay, "pausa", "Pausar (K)");
      this._iniciarBucleInterfaz();
      if (this.procesador.activo) this._iniciarBucleProcesado();
      this._programarOcultar();
      this.emitir("reproducir");
    });
    on(v, "pause", () => {
      cambiarIcono(this.bPlay, "play", "Reproducir (K)");
      this._detenerBucleInterfaz();
      this._detenerBucleProcesado();
      this._mostrarControles();
      this.emitir("pausa");
    });
    on(v, "ended", () => {
      this.raiz.classList.add("kr-terminado");
      cambiarIcono(this.bPlay, "reiniciar", "Volver a ver");
      cambiarIcono(this.botonGrande, "reiniciar", "Volver a ver");
      this.emitir("fin");
    });
    on(v, "waiting", () => this.raiz.classList.add("kr-esperando"));
    for (const ev of ["playing", "canplay", "seeked", "error"]) on(v, ev, () => this.raiz.classList.remove("kr-esperando"));
    on(v, "loadedmetadata", () => {
      this.chipInfo.textContent = `${v.videoWidth}×${v.videoHeight}`;
      if (v.videoWidth) this.escena.style.setProperty("--kr-aspecto", `${v.videoWidth} / ${v.videoHeight}`);
      this.progreso.setAttribute("aria-valuemax", Math.round(v.duration) || 0);
      this._pintarTiempo();
    });
    on(v, "loadeddata", () => this.procesador.activo && this._dibujarFotograma());
    on(v, "timeupdate", () => this.reproduciendo || this._pintarProgreso());
    on(v, "progress", () => this._pintarBuffer());
    on(v, "seeked", () => {
      this._pintarProgreso();
      if (this.procesador.activo) this._dibujarFotograma();
    });
    on(v, "volumechange", () => this._pintarVolumen());
    on(v, "ratechange", () => (this.bVelocidad.textContent = `${v.playbackRate}×`));
    on(v, "enterpictureinpicture", () => this.raiz.classList.add("kr-en-pip"));
    on(v, "leavepictureinpicture", () => this.raiz.classList.remove("kr-en-pip"));

    // ── Ratón sobre la escena
    on(this.escena, "click", (e) => {
      if (e.target.closest(".kr-controles, .kr-menu, .kr-ayuda, .kr-boton-grande")) return;
      this.raiz.focus({ preventScroll: true });
      const estabaPausado = v.paused || v.ended;
      this.alternar();
      this._feedback(estabaPausado ? "play" : "pausa");
    });
    on(this.escena, "dblclick", (e) => {
      if (e.target.closest(".kr-controles, .kr-panel")) return;
      this.alternarPantallaCompleta();
    });
    on(this.raiz, "pointermove", () => this._programarOcultar());
    on(this.raiz, "pointerleave", () => this.reproduciendo && this._ocultarControles());

    // ── Barra de progreso: clic, arrastrar y vista previa
    let arrastrando = false;
    const aTiempo = (e) => {
      const r = this.progreso.getBoundingClientRect();
      return limitar((e.clientX - r.left) / r.width, 0, 1) * (v.duration || 0);
    };
    on(this.progreso, "pointerdown", (e) => {
      arrastrando = true;
      this.progreso.setPointerCapture(e.pointerId);
      this.raiz.classList.add("kr-arrastrando");
      this.irA(aTiempo(e));
      this._pintarProgreso(aTiempo(e));
    });
    on(this.progreso, "pointermove", (e) => {
      const t = aTiempo(e);
      this._moverPrevia(e, t);
      if (arrastrando) {
        this._pintarProgreso(t);
        this._irALimitado(t);
      }
    });
    on(this.progreso, "pointerup", (e) => {
      if (!arrastrando) return;
      arrastrando = false;
      this.raiz.classList.remove("kr-arrastrando");
      this.irA(aTiempo(e));
    });
    on(this.progreso, "pointerleave", () => this.previa.classList.remove("kr-visible"));
    this._irALimitado = limitarFrecuencia((t) => this.irA(t), 80);

    // ── Teclado
    on(this.raiz, "keydown", (e) => this._tecla(e));

    // ── Pantalla completa
    on(document, "fullscreenchange", () => this._alCambiarPantallaCompleta());
    on(document, "webkitfullscreenchange", () => this._alCambiarPantallaCompleta());

    // ── Cerrar menús al pulsar fuera
    on(document, "pointerdown", (e) => {
      if (this._menu && !this._menu.contains(e.target) && !e.target.closest(".kr-boton, .kr-boton-texto")) this._cerrarMenu();
    });
  }

  _comprobarEstadoInicial() {
    // Si el archivo ya falló antes de que se cargara la librería, lo detectamos aquí
    const v = this.media;
    if (v.error) this.informarError(desdeMediaError(v.error));
    else if (v.networkState === HTMLMediaElement.NETWORK_NO_SOURCE && v.readyState === 0 && v.querySelector("source")) {
      // Puede que las <source> ya hayan fallado antes de que llegáramos: reiniciamos la
      // selección de fuente para que los errores pasen por nuestros oyentes.
      v.load();
    }
    if (v.readyState >= 1) v.dispatchEvent(new Event("loadedmetadata"));
  }

  _tecla(e) {
    if (e.target.matches("input, select, textarea") || e.ctrlKey || e.metaKey || e.altKey) return;
    const v = this.media;
    const acciones = {
      " ": () => (e.target.matches("button") ? null : this.alternar()),
      k: () => this.alternar(),
      arrowleft: () => this._saltarConFeedback(-5),
      arrowright: () => this._saltarConFeedback(5),
      j: () => this._saltarConFeedback(-10),
      l: () => this._saltarConFeedback(10),
      arrowup: () => ((this.volumen = v.volume + 0.05), this._feedback("volumen", `${Math.round(v.volume * 100)} %`)),
      arrowdown: () => ((this.volumen = v.volume - 0.05), this._feedback("volumen", `${Math.round(v.volume * 100)} %`)),
      m: () => (this.alternarSilencio(), this._feedback(v.muted ? "silencio" : "volumen")),
      ",": () => v.paused && this.saltar(-1 / 30),
      ".": () => v.paused && this.saltar(1 / 30),
      "<": () => this._feedback("velocidad", `${this.cambiarVelocidad(-1)}×`),
      ">": () => this._feedback("velocidad", `${this.cambiarVelocidad(1)}×`),
      c: () => this.alternarSubtitulos(),
      e: () => this.alternarPanel(),
      s: () => this.capturar(),
      p: () => this.alternarPip(),
      f: () => this.alternarPantallaCompleta(),
      "?": () => this.alternarAyuda(),
      escape: () => (this._cerrarMenu(), this.alternarAyuda(false)),
    };
    const clave = e.key.length === 1 ? e.key.toLowerCase() : e.key.toLowerCase();
    let accion = acciones[clave];
    if (!accion && /^[0-9]$/.test(e.key)) accion = () => this.irA((Number(e.key) / 10) * v.duration);
    if (!accion) return;
    if (clave === " " && e.target.matches("button")) return; // el botón ya hace su clic
    e.preventDefault();
    accion();
    this._programarOcultar();
  }

  // ════════════════════════════════════════════════════════════════
  //  Pintar estado
  // ════════════════════════════════════════════════════════════════

  /** Bucle de interfaz a 60 fps mientras se reproduce: barra fluida y subtítulos exactos. */
  _iniciarBucleInterfaz() {
    cancelAnimationFrame(this._frameInterfaz);
    const paso = () => {
      this._pintarProgreso();
      this._frameInterfaz = requestAnimationFrame(paso);
    };
    paso();
  }

  _detenerBucleInterfaz() {
    cancelAnimationFrame(this._frameInterfaz);
    this._pintarProgreso();
  }

  _pintarProgreso(t = this.media.currentTime) {
    const d = this.media.duration;
    const fraccion = Number.isFinite(d) && d > 0 ? t / d : 0;
    this.progreso.style.setProperty("--progreso", fraccion);
    this.progreso.setAttribute("aria-valuenow", Math.round(t));
    this.progreso.setAttribute("aria-valuetext", formatearTiempo(t));
    this._pintarTiempo(t);
    this._pintarSubtitulo(t);
  }

  _pintarTiempo(t = this.media.currentTime) {
    const d = this.media.duration;
    const actual = this._mostrarRestante ? `-${formatearTiempo((d || 0) - t)}` : formatearTiempo(t);
    const texto = `${actual} / ${formatearTiempo(d)}`;
    if (this.tiempo.textContent !== texto) this.tiempo.textContent = texto;
  }

  _pintarBuffer() {
    const v = this.media;
    if (!v.duration || !v.buffered.length) return;
    // Buscamos el tramo descargado que contiene la posición actual
    let fin = 0;
    for (let i = 0; i < v.buffered.length; i++) {
      if (v.buffered.start(i) <= v.currentTime + 0.5) fin = v.buffered.end(i);
    }
    this.progreso.style.setProperty("--buffer", fin / v.duration);
  }

  _pintarVolumen() {
    const v = this.media;
    const nivel = v.muted ? 0 : v.volume;
    this.deslizadorVolumen.value = nivel;
    this.deslizadorVolumen.style.setProperty("--valor", nivel);
    cambiarIcono(this.bVolumen, nivel === 0 ? "silencio" : "volumen", nivel === 0 ? "Activar sonido (M)" : "Silenciar (M)");
  }

  /** Icono animado en el centro (como al pulsar en YouTube). */
  _feedback(nombreIcono, texto = "") {
    const capa = this.capaFeedback;
    capa.replaceChildren(icono(nombreIcono), texto ? crear("span", { texto }) : "");
    capa.classList.remove("kr-animar");
    void capa.offsetWidth; // fuerza un reflow para reiniciar la animación CSS
    capa.classList.add("kr-animar");
  }

  _saltarConFeedback(segundos) {
    this.saltar(segundos);
    this._feedback(segundos < 0 ? "atras" : "adelante", `${segundos > 0 ? "+" : ""}${segundos} s`);
  }

  mostrarError(error) {
    this.raiz.classList.add("kr-con-error");
    this.capaError.replaceChildren(icono("error"), crear("strong", { texto: "No se puede reproducir" }), crear("p", { texto: error.message }));
  }

  // ── Autoocultar controles ───────────────────────────────────────

  _mostrarControles() {
    this.raiz.classList.remove("kr-inactivo");
  }

  _ocultarControles() {
    if (this._menu || !this.panel.hidden || !this.ayuda.hidden) return;
    this.raiz.classList.add("kr-inactivo");
  }

  _programarOcultar() {
    this._mostrarControles();
    clearTimeout(this._temporizadorOcultar);
    if (this.reproduciendo) this._temporizadorOcultar = setTimeout(() => this._ocultarControles(), OCULTAR_CONTROLES_MS);
  }

  // ════════════════════════════════════════════════════════════════
  //  Vista previa en la barra (miniaturas)
  // ════════════════════════════════════════════════════════════════

  _moverPrevia(e, t) {
    const r = this.progreso.getBoundingClientRect();
    const x = limitar(e.clientX - r.left, 96, r.width - 96);
    this.previa.style.left = `${x}px`;
    this.previa.classList.add("kr-visible");
    const capitulo = this.capituloEn(t);
    this.previaTiempo.textContent = capitulo ? `${formatearTiempo(t)} · ${capitulo.texto}` : formatearTiempo(t);
    this._pedirMiniatura(t);
  }

  /**
   * Usamos un segundo <video> invisible con el mismo archivo: lo movemos al
   * instante señalado y pintamos su fotograma en el canvas de la vista previa.
   */
  _pedirMiniatura(t) {
    if (!this.media.currentSrc) return;
    if (!this._sombra) {
      const sombra = document.createElement("video");
      sombra.muted = true;
      sombra.preload = "auto";
      sombra.src = this.media.currentSrc;
      sombra.addEventListener("seeked", () => {
        const ctx = this.previaLienzo.getContext("2d");
        ctx.drawImage(sombra, 0, 0, this.previaLienzo.width, this.previaLienzo.height);
        this.previa.classList.add("kr-con-imagen");
        this._buscandoMiniatura = false;
        if (this._miniaturaPendiente !== null) {
          const siguiente = this._miniaturaPendiente;
          this._miniaturaPendiente = null;
          this._pedirMiniatura(siguiente);
        }
      });
      sombra.addEventListener("error", () => (this._sombra = null), { once: true });
      this._sombra = sombra;
    }
    // Si todavía está buscando el anterior, guardamos solo el último pedido
    if (this._buscandoMiniatura) {
      this._miniaturaPendiente = t;
      return;
    }
    this._buscandoMiniatura = true;
    this._miniaturaPendiente = null;
    this._sombra.currentTime = t;
  }

  // ════════════════════════════════════════════════════════════════
  //  Subtítulos
  // ════════════════════════════════════════════════════════════════

  /** Lee las etiquetas <track> y el atributo data-subtitulos. */
  _leerPistas() {
    const v = this.media;
    let porDefecto = null;
    for (const track of [...v.querySelectorAll("track")]) {
      if (track.getAttribute("kind") === "chapters") {
        fetch(track.getAttribute("src"))
          .then((r) => (r.ok ? r.text() : null))
          .then((texto) => this.fijarCapitulos(texto))
          .catch((e) => registro.aviso(this.nombre, "Capítulos no disponibles", e));
        track.remove();
        continue;
      }
      if (!["subtitles", "captions", ""].includes(track.getAttribute("kind") ?? "")) continue;
      const pista = new PistaSubtitulos({ src: track.getAttribute("src"), idioma: track.srclang, etiqueta: track.label });
      this.pistas.push(pista);
      if (track.default) porDefecto = pista;
      // Quitamos la pista nativa: los subtítulos los pintamos nosotros
      track.remove();
    }
    const extra = v.dataset.subtitulos;
    if (extra) {
      // data-subtitulos="auto" → busca <nombre-del-video>.vtt como hacíamos en clase
      const src = extra === "auto" ? `${sinExtension(v.currentSrc || v.getAttribute("src") || v.querySelector("source")?.getAttribute("src") || "")}.vtt` : extra;
      this.pistas.push(new PistaSubtitulos({ src, etiqueta: "Subtítulos" }));
      porDefecto ??= extra === "auto" ? null : this.pistas.at(-1);
    }
    if (!this.pistas.length) this.bSubtitulos.classList.add("kr-desactivado");
    if (porDefecto) this.activarPista(porDefecto, { silencioso: true });
  }

  /** Activa una pista (la descarga si hace falta) o desactiva con null. */
  async activarPista(pista, { silencioso = false } = {}) {
    this._indiceFrase = -1;
    this.capaSubtitulos.replaceChildren();
    if (!pista) {
      this.pistaActiva = null;
      this.bSubtitulos.classList.remove("kr-activo");
      this.emitir("subtitulos", { pista: null });
      return;
    }
    try {
      await pista.cargar();
      this.pistaActiva = pista;
      this._ultimaPista = pista;
      this.bSubtitulos.classList.add("kr-activo");
      this._pintarSubtitulo(this.media.currentTime);
      if (!silencioso) notificar(`Subtítulos: ${pista.etiqueta}`, { tipo: "info", duracion: 1800 });
      this.emitir("subtitulos", { pista });
    } catch (error) {
      const e = normalizarError(error);
      registro.aviso(this.nombre, e.message);
      if (!silencioso) notificar(e.message, { tipo: "aviso", titulo: "Subtítulos" });
    }
  }

  // ── Cambiar de vídeo y capítulos ────────────────────────────────

  /**
   * Cambia de vídeo reutilizando el mismo reproductor (la app lo usa con su cola).
   * @param {object} o
   * @param {string} o.src
   * @param {string} [o.titulo]
   * @param {Array<{src?: string, texto?: string, idioma?: string, etiqueta?: string}>} [o.subtitulos]
   * @param {string} [o.capitulos] texto WebVTT con los capítulos
   * @param {string} [o.idiomaPreferido] idioma de subtítulos que se activa solo
   */
  cargar({ src, titulo = "", subtitulos = [], capitulos = null, idiomaPreferido = "" }) {
    this.raiz.classList.remove("kr-con-error", "kr-terminado", "kr-esperando");
    this.raiz.classList.add("kr-inicio");
    cambiarIcono(this.botonGrande, "play", "Reproducir");
    this.titulo = titulo;
    this.nombre = titulo || src;
    this.cabecera.querySelector(".kr-cabecera-titulo").textContent = titulo;
    this.chipInfo.textContent = "";
    this._cerrarMenu();

    // La miniatura usa un segundo <video>: hay que olvidar el anterior
    this._sombra?.removeAttribute("src");
    this._sombra = null;
    this._buscandoMiniatura = false;
    this.previa.classList.remove("kr-con-imagen");

    this.media.src = src;

    this.pistas = subtitulos.map((s) => new PistaSubtitulos(s));
    this.bSubtitulos.classList.toggle("kr-desactivado", !this.pistas.length);
    const preferida = idiomaPreferido ? this.pistas.find((p) => p.idioma === idiomaPreferido) : null;
    this.activarPista(preferida ?? null, { silencioso: true });
    this.fijarCapitulos(capitulos);
  }

  /** Lee capítulos (WebVTT) y los marca en la barra de progreso. */
  fijarCapitulos(texto) {
    this.capitulos = [];
    this.marcasCapitulos.replaceChildren();
    if (!texto) return;
    try {
      this.capitulos = parsear(texto);
    } catch (error) {
      registro.aviso(this.nombre, "Capítulos no válidos", error);
      return;
    }
    const pintar = () => {
      const d = this.media.duration;
      if (!Number.isFinite(d) || !d) return;
      this.marcasCapitulos.replaceChildren(
        ...this.capitulos.slice(1).map((c) => crear("i", { titulo: c.texto, atributos: { style: `left:${(c.inicio / d) * 100}%` } })),
      );
    };
    if (this.media.readyState >= 1) pintar();
    else this.media.addEventListener("loadedmetadata", pintar, { once: true });
  }

  /** Capítulo que contiene el instante t (o null). */
  capituloEn(t) {
    return this.capitulos.findLast((c) => c.inicio <= t) ?? null;
  }

  alternarSubtitulos() {
    if (!this.pistas.length) return notificar("Este vídeo no tiene subtítulos.", { tipo: "info", duracion: 2000 });
    this.activarPista(this.pistaActiva ? null : this._ultimaPista ?? this.pistas[0]);
  }

  _pintarSubtitulo(t) {
    const pista = this.pistaActiva;
    if (!pista) return;
    const i = pista.indiceEn(t);
    if (i === this._indiceFrase) return;
    this._indiceFrase = i;
    if (i === -1) {
      this.capaSubtitulos.replaceChildren();
      return;
    }
    const lineas = pista.frases[i].texto.split("\n").flatMap((l, n) => (n ? [crear("br"), l] : [l]));
    this.capaSubtitulos.replaceChildren(crear("span", { clase: "kr-frase" }, lineas));
  }

  // ════════════════════════════════════════════════════════════════
  //  Menús
  // ════════════════════════════════════════════════════════════════

  _abrirMenu(boton, titulo, opciones) {
    const yaAbierto = this._menu?.dataset.para === titulo;
    this._cerrarMenu();
    if (yaAbierto) return;
    this._menu = crear("div", { clase: "kr-menu", datos: { para: titulo }, atributos: { role: "menu" } }, [
      crear("p", { clase: "kr-menu-titulo", texto: titulo }),
      ...opciones.map(({ etiqueta, activo, accion }) =>
        crear("button", {
          clase: `kr-menu-opcion${activo ? " kr-activo" : ""}`,
          texto: etiqueta,
          atributos: { role: "menuitemradio", "aria-checked": !!activo },
          eventos: { click: () => (accion(), this._cerrarMenu()) },
        }),
      ),
    ]);
    // Lo colocamos encima del botón
    const r = boton.getBoundingClientRect();
    const re = this.escena.getBoundingClientRect();
    this._menu.style.right = `${Math.max(8, re.right - r.right)}px`;
    this.escena.append(this._menu);
    this._mostrarControles();
  }

  _cerrarMenu() {
    this._menu?.remove();
    this._menu = null;
  }

  _menuVelocidad() {
    this._abrirMenu(
      this.bVelocidad,
      "Velocidad",
      VELOCIDADES.map((vel) => ({
        etiqueta: vel === 1 ? "Normal" : `${vel}×`,
        activo: this.velocidad === vel,
        accion: () => (this.velocidad = vel),
      })),
    );
  }

  _menuSubtitulos() {
    if (!this.pistas.length) return this.alternarSubtitulos();
    this._abrirMenu(this.bSubtitulos, "Subtítulos", [
      { etiqueta: "Desactivados", activo: !this.pistaActiva, accion: () => this.activarPista(null) },
      ...this.pistas.map((p) => ({ etiqueta: p.etiqueta, activo: this.pistaActiva === p, accion: () => this.activarPista(p) })),
    ]);
  }

  // ════════════════════════════════════════════════════════════════
  //  Efectos (procesado de fotogramas)
  // ════════════════════════════════════════════════════════════════

  alternarPanel(mostrar = this.panel.hidden) {
    this.panel.hidden = !mostrar;
    this.bEfectos.classList.toggle("kr-activo", mostrar);
    this._mostrarControles();
  }

  /** Cambia ajustes del procesador y actualiza la interfaz. */
  aplicarEfectos(cambios) {
    this.procesador.configurar(cambios);
    const a = this.procesador.ajustes;
    for (const chip of this._chipsFiltro) chip.setAttribute("aria-pressed", chip.dataset.filtro === a.filtro);
    for (const [clave, d] of Object.entries(this._deslizadores)) {
      if (Number(d.input.value) !== a[clave]) d.fijar(a[clave]);
    }
    this._casillaComparar.checked = a.comparar;

    const activo = this.procesador.activo;
    this.raiz.classList.toggle("kr-procesando", activo);
    if (activo) {
      this._dibujarFotograma();
      if (this.reproduciendo) this._iniciarBucleProcesado();
    } else {
      this._detenerBucleProcesado();
      this.estadisticas.textContent = "Sin procesar: el vídeo se muestra directamente.";
    }
    this.emitir("efectos", { ajustes: { ...a } });
  }

  restablecerEfectos() {
    this.aplicarEfectos({ ...AJUSTES_INICIALES });
  }

  _dibujarFotograma() {
    try {
      this.procesador.procesar();
      const p = this.procesador;
      this.estadisticas.textContent = `${p.lienzo.width}×${p.lienzo.height} px · ${p.msPorFotograma.toFixed(1)} ms/fotograma${
        this.reproduciendo ? ` · ${p.fps} fps` : ""
      }`;
    } catch (error) {
      // SecurityError: vídeo de otro dominio sin CORS (o abierto con file://)
      this._detenerBucleProcesado();
      this.procesador.restablecer();
      this.raiz.classList.remove("kr-procesando");
      const e = normalizarError(error);
      registro.error(this.nombre, "No se pueden leer los píxeles del vídeo", error);
      notificar(`${e.message} Los efectos necesitan que el vídeo se sirva desde el mismo origen que la página.`, {
        tipo: "error",
        titulo: "Efectos no disponibles",
      });
    }
  }

  /** requestVideoFrameCallback avisa en cada fotograma nuevo del vídeo (mejor que requestAnimationFrame). */
  _iniciarBucleProcesado() {
    if (this._bucleProcesado) return;
    this._bucleProcesado = true;
    const v = this.media;
    const usarRVFC = "requestVideoFrameCallback" in v;
    const paso = () => {
      if (!this._bucleProcesado) return;
      this._dibujarFotograma();
      this._idProcesado = usarRVFC ? v.requestVideoFrameCallback(paso) : requestAnimationFrame(paso);
    };
    this._idProcesado = usarRVFC ? v.requestVideoFrameCallback(paso) : requestAnimationFrame(paso);
  }

  _detenerBucleProcesado() {
    if (!this._bucleProcesado) return;
    this._bucleProcesado = false;
    if ("cancelVideoFrameCallback" in this.media) this.media.cancelVideoFrameCallback(this._idProcesado);
    cancelAnimationFrame(this._idProcesado);
  }

  // ════════════════════════════════════════════════════════════════
  //  Captura, PiP, pantalla completa, ayuda
  // ════════════════════════════════════════════════════════════════

  /** Guarda el fotograma actual como PNG (con los efectos aplicados, si los hay). */
  async capturar({ tipo = "image/png", calidad = 0.92 } = {}) {
    try {
      const origen = this.procesador.activo ? this.lienzo : this.media;
      const blob = await capturarFotograma(origen, { tipo, calidad });
      const marca = formatearTiempo(this.media.currentTime).replaceAll(":", "-");
      const extension = tipo.split("/")[1].replace("jpeg", "jpg");
      descargar(blob, `${nombreBase(this.media.currentSrc) || "captura"}_${marca}.${extension}`);
      this.escena.classList.remove("kr-flash");
      void this.escena.offsetWidth;
      this.escena.classList.add("kr-flash");
      notificar(`Fotograma guardado (${extension.toUpperCase()}, ${Math.round(blob.size / 1024)} KB)`, { tipo: "exito", duracion: 2500 });
      this.emitir("captura", { blob });
    } catch (error) {
      this.informarErrorSuave(error, "No se pudo capturar");
    }
  }

  async alternarPip() {
    try {
      if (document.pictureInPictureElement === this.media) await document.exitPictureInPicture();
      else await this.media.requestPictureInPicture();
    } catch (error) {
      this.informarErrorSuave(error, "Picture-in-Picture");
    }
  }

  async alternarPantallaCompleta() {
    try {
      const actual = document.fullscreenElement ?? document.webkitFullscreenElement;
      if (actual) await (document.exitFullscreen?.() ?? document.webkitExitFullscreen?.());
      else await (this.raiz.requestFullscreen?.() ?? this.raiz.webkitRequestFullscreen?.());
    } catch (error) {
      this.informarErrorSuave(error, "Pantalla completa");
    }
  }

  _alCambiarPantallaCompleta() {
    const dentro = (document.fullscreenElement ?? document.webkitFullscreenElement) === this.raiz;
    this.raiz.classList.toggle("kr-completa", dentro);
    cambiarIcono(this.bCompleta, dentro ? "salirCompleta" : "completa", dentro ? "Salir de pantalla completa (F)" : "Pantalla completa (F)");
  }

  alternarAyuda(mostrar = this.ayuda.hidden) {
    this.ayuda.hidden = !mostrar;
    if (mostrar) this.pausar();
  }

  /** Errores que no impiden seguir usando el reproductor: solo avisamos. */
  informarErrorSuave(error, titulo) {
    const e = normalizarError(error);
    registro.aviso(this.nombre, titulo, e.message);
    notificar(e.message, { tipo: "aviso", titulo });
  }

  destruir() {
    super.destruir();
    this._detenerBucleInterfaz();
    this._detenerBucleProcesado();
    this._sombra?.removeAttribute("src");
  }
}
