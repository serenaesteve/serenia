/**
 * Kroma · ReproductorAudio
 *
 * Reproductor de música con:
 *   lista de reproducción (aleatorio, repetir todas / una) · portada animada tipo vinilo
 *   visualizador en tiempo real (3 modos) · forma de onda navegable
 *   ecualizador de 5 bandas con presets y balance · letras sincronizadas (karaoke)
 *   exportación a WAV con el ecualizador aplicado · teclas multimedia del sistema (Media Session)
 *
 * Uso con una canción:
 *   <audio data-kroma src="cancion.mp3" data-titulo="…" data-artista="…" data-letra="cancion.vtt"></audio>
 *
 * Uso con una lista:
 *   <div data-kroma="lista">
 *     <audio src="a.mp3" data-titulo="A"></audio>
 *     <audio data-titulo="B"><source src="b.ogg" type="audio/ogg"><source src="b.mp3"></audio>
 *   </div>
 */

import { ReproductorBase } from "./ReproductorBase.js";
import { CadenaAudio, BANDAS, PRESETS_EQ } from "../procesado/cadenaAudio.js";
import { decodificar, calcularPicos } from "../procesado/formaOnda.js";
import { Visualizador, MODOS_VISUALIZADOR } from "../animacion/visualizador.js";
import { audioBufferAWav, renderizarConEcualizador } from "../conversion/conversor.js";
import { PistaSubtitulos } from "../subtitulos/subtitulos.js";
import { notificar } from "../animacion/notificaciones.js";
import { registro } from "../nucleo/registro.js";
import { normalizarError } from "../nucleo/errores.js";
import { elegirFuente, extension } from "../nucleo/tipos.js";
import {
  crear,
  cambiarIcono,
  formatearTiempo,
  formatearBytes,
  limitar,
  descargar,
  nombreBase,
  sinExtension,
  tonoDesdeTexto,
  variableCSS,
  preferencias,
} from "../nucleo/utilidades.js";

/** Lee la información de una canción a partir de su etiqueta <audio>. */
function leerPista(audio) {
  const fuentes = audio.getAttribute("src")
    ? [{ src: audio.getAttribute("src"), type: "" }]
    : [...audio.querySelectorAll("source")].map((s) => ({ src: s.getAttribute("src"), type: s.type }));
  const primera = fuentes[0]?.src ?? "";
  const letra = audio.dataset.letra === "auto" ? `${sinExtension(primera)}.vtt` : audio.dataset.letra;
  return {
    fuentes,
    titulo: audio.dataset.titulo || nombreBase(primera) || "Sin título",
    artista: audio.dataset.artista || "Artista desconocido",
    portada: audio.dataset.portada || "",
    letra: letra ? new PistaSubtitulos({ src: letra, etiqueta: "Letra" }) : null,
    duracion: NaN,
  };
}

/** Prepara el <audio> que se usará para toda la lista y devuelve las pistas. */
function prepararElemento(elemento) {
  const audios = elemento.tagName === "AUDIO" ? [elemento] : [...elemento.querySelectorAll("audio")];
  if (!audios.length) throw new Error("Kroma: el contenedor de la lista no tiene ningún <audio>.");
  const pistas = audios.map(leerPista);
  const media = audios[0];
  // Un solo <audio> reproduce toda la lista: quitamos las fuentes, las ponemos al cargar cada pista
  media.removeAttribute("src");
  media.replaceChildren();
  media.preload = "metadata";
  return { media, pistas };
}

export class ReproductorAudio extends ReproductorBase {
  /**
   * @param {HTMLAudioElement|HTMLElement} elemento <audio> o contenedor con varios <audio>
   * @param {object} [opciones]
   * @param {boolean} [opciones.compacto] sin visualizador ni lista (para grabaciones)
   */
  constructor(elemento, opciones = {}) {
    const { media, pistas } = prepararElemento(elemento);
    super(media, { compacto: elemento.hasAttribute("data-compacto"), ...opciones });
    this.tituloError = "No se puede reproducir la canción";
    this.pistas = pistas;
    this.indice = 0;
    this.aleatorio = false;
    this.repetir = pistas.length > 1 ? "todas" : "no"; // "no" | "todas" | "una"
    this.nombre = media.id || `audio · ${pistas[0].titulo}`;
    this._picos = null;
    this._buffer = null;
    this._hover = null;
    const eq = preferencias.leer("eq", { ganancias: [0, 0, 0, 0, 0], balance: 0, preset: "plano" });
    this.eq = { ganancias: [...eq.ganancias], balance: eq.balance, preset: eq.preset };

    this._construir(elemento);
    this._conectar();
    this.visualizador = this.opciones.compacto
      ? null
      : new Visualizador(this.lienzoVisualizador, () => this.cadena, { modo: preferencias.leer("visualizador", "barras") });
    this._observarVisibilidad();
    this.cargarPista(0);
    this._leerDuraciones();
    registro.info(this.nombre, `Reproductor de audio listo (${pistas.length} pista/s)`);
  }

  get pista() {
    return this.pistas[this.indice];
  }

  // ════════════════════════════════════════════════════════════════
  //  Interfaz
  // ════════════════════════════════════════════════════════════════

  _construir(elemento) {
    const compacto = this.opciones.compacto;
    this.raiz = crear("div", {
      clase: `kr kr-audio${compacto ? " kr-compacto" : ""}`,
      atributos: { tabindex: 0, role: "region", "aria-label": "Reproductor de audio" },
    });
    elemento.before(this.raiz);
    if (elemento !== this.media) elemento.remove();

    const b = (icono, titulo, accion, clase = "") =>
      crear("button", { clase: `kr-boton ${clase}`.trim(), icono, titulo, eventos: { click: accion } });

    // Portada + información
    this.portada = crear("div", { clase: "kr-portada" }, [crear("div", { clase: "kr-disco" }), crear("div", { clase: "kr-caratula" })]);
    this.elTitulo = crear("h3", { clase: "kr-audio-titulo" });
    this.elArtista = crear("p", { clase: "kr-audio-artista" });
    this.elMeta = crear("p", { clase: "kr-audio-meta" });

    this.botonesModo = Object.entries(MODOS_VISUALIZADOR).map(([clave, nombre]) =>
      crear("button", {
        clase: "kr-modo",
        texto: nombre,
        datos: { modo: clave },
        eventos: { click: () => this.cambiarVisualizador(clave) },
      }),
    );

    // Visualizador + letra
    this.lienzoVisualizador = crear("canvas", { clase: "kr-visualizador", atributos: { "aria-hidden": "true" } });
    this.listaLetra = crear("ol", { clase: "kr-letra-lineas" });
    this.letra = crear("div", { clase: "kr-letra", atributos: { hidden: "" } }, [this.listaLetra]);

    // Forma de onda
    this.lienzoOnda = crear("canvas", { clase: "kr-onda", atributos: { role: "slider", "aria-label": "Posición", tabindex: -1 } });
    this.elActual = crear("span", { texto: "0:00" });
    this.elTotal = crear("span", { texto: "0:00" });

    // Controles
    this.bAleatorio = b("aleatorio", "Aleatorio", () => this.alternarAleatorio(), "kr-pequeno");
    this.bAnterior = b("anterior", "Anterior (B)", () => this.anterior());
    this.bPlay = b("play", "Reproducir (espacio)", () => this.alternar(), "kr-boton-play");
    this.bSiguiente = b("siguiente", "Siguiente (N)", () => this.siguiente());
    this.bRepetir = b("repetir", `Repetir: ${this.repetir}`, () => this.alternarRepetir(), `kr-pequeno${this.repetir !== "no" ? " kr-activo" : ""}`);
    this.bVolumen = b("volumen", "Silenciar (M)", () => this.alternarSilencio());
    this.deslizadorVolumen = crear("input", {
      clase: "kr-volumen",
      atributos: { type: "range", min: 0, max: 1, step: 0.01, value: this.media.volume, "aria-label": "Volumen" },
      eventos: { input: (e) => (this.volumen = Number(e.target.value)) },
    });
    this.bVelocidad = crear("button", {
      clase: "kr-boton kr-boton-texto",
      texto: "1×",
      titulo: "Velocidad",
      eventos: { click: () => (this.bVelocidad.textContent = `${this.cambiarVelocidadCiclica()}×`) },
    });
    this.bLetra = b("nota", "Letra", () => this.alternarLetra());
    this.bEcualizador = b("ecualizador", "Ecualizador", () => this.alternarEcualizador());
    this.bExportar = b("descargar", "Exportar a WAV", () => this.exportarWav());

    this.panelEq = this._construirEcualizador();
    this.lista = crear("ol", { clase: "kr-lista" });

    this.raiz.append(
      this.media,
      crear("div", { clase: "kr-audio-cabecera" }, [
        this.portada,
        crear("div", { clase: "kr-audio-info" }, [this.elArtista, this.elTitulo, this.elMeta]),
        crear("div", { clase: "kr-modos" }, this.botonesModo),
      ]),
      crear("div", { clase: "kr-audio-escenario" }, [this.lienzoVisualizador, this.letra]),
      crear("div", { clase: "kr-onda-contenedor" }, [this.lienzoOnda]),
      crear("div", { clase: "kr-tiempos" }, [this.elActual, this.elTotal]),
      crear("div", { clase: "kr-audio-controles" }, [
        crear("div", { clase: "kr-grupo kr-transporte" }, [this.bAleatorio, this.bAnterior, this.bPlay, this.bSiguiente, this.bRepetir]),
        crear("div", { clase: "kr-grupo" }, [
          crear("div", { clase: "kr-grupo-volumen" }, [this.bVolumen, this.deslizadorVolumen]),
          this.bVelocidad,
          this.bLetra,
          this.bEcualizador,
          this.bExportar,
        ]),
      ]),
      this.panelEq,
      this.lista,
    );

    if (this.pistas.length < 2) this.raiz.classList.add("kr-sin-lista");
    this._pintarLista();
    this._pintarVolumen();
    this._marcarModo();
  }

  _construirEcualizador() {
    this._slidersEq = BANDAS.map(({ frecuencia, nombre }, i) => {
      const input = crear("input", {
        atributos: { type: "range", min: -12, max: 12, step: 0.5, value: this.eq.ganancias[i], "aria-label": `${nombre} ${frecuencia} Hz`, orient: "vertical" },
        eventos: { input: (e) => this.fijarBanda(i, Number(e.target.value)) },
      });
      const valor = crear("output", { texto: `${this.eq.ganancias[i] > 0 ? "+" : ""}${this.eq.ganancias[i]} dB` });
      const etiqueta = frecuencia >= 1000 ? `${frecuencia / 1000}k` : `${frecuencia}`;
      return { input, valor, raiz: crear("label", { clase: "kr-banda" }, [valor, input, crear("span", { texto: `${etiqueta} Hz` }), crear("small", { texto: nombre })]) };
    });

    this.selectorPreset = crear(
      "select",
      { atributos: { "aria-label": "Preajuste" }, eventos: { change: (e) => this.aplicarPreset(e.target.value) } },
      [...Object.entries(PRESETS_EQ).map(([clave, { nombre }]) => crear("option", { texto: nombre, atributos: { value: clave } })), crear("option", { texto: "Personalizado", atributos: { value: "personalizado", hidden: "" } })],
    );
    this.selectorPreset.value = this.eq.preset;

    this.deslizadorBalance = crear("input", {
      atributos: { type: "range", min: -1, max: 1, step: 0.05, value: this.eq.balance, "aria-label": "Balance" },
      eventos: { input: (e) => this.fijarBalance(Number(e.target.value)) },
    });

    return crear("section", { clase: "kr-eq", atributos: { hidden: "" } }, [
      crear("header", {}, [crear("h4", { texto: "Ecualizador" }), this.selectorPreset]),
      crear("div", { clase: "kr-bandas" }, this._slidersEq.map((s) => s.raiz)),
      crear("label", { clase: "kr-balance" }, [crear("span", { texto: "I" }), this.deslizadorBalance, crear("span", { texto: "D" })]),
      crear("button", { clase: "kr-boton-texto", icono: "descargar", eventos: { click: () => this.exportarWav({ conEcualizador: true }) } }, [" Exportar con ecualizador (WAV)"]),
    ]);
  }

  // ════════════════════════════════════════════════════════════════
  //  Eventos
  // ════════════════════════════════════════════════════════════════

  _conectar() {
    const a = this.media;
    const on = (obj, ev, fn) => this._escuchar(obj, ev, fn);

    on(a, "play", () => {
      cambiarIcono(this.bPlay, "pausa", "Pausar (espacio)");
      this.raiz.classList.add("kr-sonando");
      this._iniciarBucle();
      this._pintarLista();
      this.emitir("reproducir", { pista: this.pista });
    });
    on(a, "pause", () => {
      cambiarIcono(this.bPlay, "play", "Reproducir (espacio)");
      this.raiz.classList.remove("kr-sonando");
      cancelAnimationFrame(this._frame);
      this._pintarTodo();
      this._pintarLista();
      this.emitir("pausa", { pista: this.pista });
    });
    on(a, "ended", () => this._alTerminar());
    on(a, "loadedmetadata", () => {
      this.pista.duracion = a.duration;
      this.elTotal.textContent = formatearTiempo(a.duration);
      this._pintarLista();
    });
    on(a, "timeupdate", () => this.reproduciendo || this._pintarTodo());
    on(a, "seeked", () => this._pintarTodo());
    on(a, "volumechange", () => this._pintarVolumen());
    on(a, "ratechange", () => (this.bVelocidad.textContent = `${a.playbackRate}×`));
    on(a, "waiting", () => this.raiz.classList.add("kr-esperando"));
    on(a, "playing", () => this.raiz.classList.remove("kr-esperando"));

    // Forma de onda: clic/arrastrar para buscar, hover para ver el tiempo
    let arrastrando = false;
    const fraccion = (e) => {
      const r = this.lienzoOnda.getBoundingClientRect();
      return limitar((e.clientX - r.left) / r.width, 0, 1);
    };
    on(this.lienzoOnda, "pointerdown", (e) => {
      arrastrando = true;
      this.lienzoOnda.setPointerCapture(e.pointerId);
      this.irA(fraccion(e) * a.duration);
    });
    on(this.lienzoOnda, "pointermove", (e) => {
      this._hover = fraccion(e);
      if (arrastrando) this.irA(this._hover * a.duration);
      this._pintarOnda();
    });
    on(this.lienzoOnda, "pointerup", () => (arrastrando = false));
    on(this.lienzoOnda, "pointerleave", () => {
      this._hover = null;
      this._pintarOnda();
    });

    // Redibujar la onda si cambia el tamaño
    this._observadorTam = new ResizeObserver(() => this._recalcularPicos());
    this._observadorTam.observe(this.lienzoOnda);
    this._limpiezas.push(() => this._observadorTam.disconnect());

    on(this.raiz, "keydown", (e) => this._tecla(e));
  }

  _tecla(e) {
    if (e.target.matches("input, select, textarea") || e.ctrlKey || e.metaKey || e.altKey) return;
    const acciones = {
      " ": () => this.alternar(),
      k: () => this.alternar(),
      arrowleft: () => this.saltar(-5),
      arrowright: () => this.saltar(5),
      arrowup: () => (this.volumen = this.media.volume + 0.05),
      arrowdown: () => (this.volumen = this.media.volume - 0.05),
      m: () => this.alternarSilencio(),
      n: () => this.siguiente(),
      b: () => this.anterior(),
    };
    const accion = acciones[e.key.toLowerCase()];
    if (!accion || (e.key === " " && e.target.matches("button"))) return;
    e.preventDefault();
    accion();
  }

  /** El visualizador solo se anima cuando el reproductor está en pantalla (ahorra CPU). */
  _observarVisibilidad() {
    if (!this.visualizador) return;
    const observador = new IntersectionObserver(([entrada]) => {
      if (entrada.isIntersecting) this.visualizador.iniciar();
      else this.visualizador.detener();
    });
    observador.observe(this.raiz);
    this._limpiezas.push(() => {
      observador.disconnect();
      this.visualizador.destruir();
    });
  }

  // ════════════════════════════════════════════════════════════════
  //  Lista de reproducción
  // ════════════════════════════════════════════════════════════════

  /** Carga la pista i. Si `reproducir` es true empieza a sonar. */
  async cargarPista(i, { reproducir = false } = {}) {
    this.indice = (i + this.pistas.length) % this.pistas.length;
    const pista = this.pista;
    const fuente = elegirFuente(pista.fuentes);
    if (!fuente) {
      this.informarError(new Error(`La pista «${pista.titulo}» no tiene ninguna fuente.`));
      return;
    }
    registro.info(this.nombre, `Cargando «${pista.titulo}» desde ${fuente.src}`);
    this.raiz.classList.remove("kr-con-error");
    this.media.src = fuente.src;
    this._fuenteActual = fuente.src;
    this._picos = null;
    this._buffer = null;

    this.elTitulo.textContent = pista.titulo;
    this.elArtista.textContent = pista.artista;
    this.elMeta.textContent = extension(fuente.src).toUpperCase();
    this.elActual.textContent = "0:00";
    this.elTotal.textContent = formatearTiempo(pista.duracion);
    this._pintarPortada();
    this._pintarLista();
    this._pintarOnda();
    this._actualizarMediaSession();
    this._cargarLetra();
    this._cargarOnda(fuente.src);
    this.emitir("pista", { pista, indice: this.indice });

    if (reproducir) await this.reproducir();
  }

  siguiente() {
    if (this.aleatorio && this.pistas.length > 1) {
      let i;
      do i = Math.floor(Math.random() * this.pistas.length);
      while (i === this.indice);
      return this.cargarPista(i, { reproducir: true });
    }
    return this.cargarPista(this.indice + 1, { reproducir: true });
  }

  anterior() {
    // Como en cualquier reproductor: si ya llevamos unos segundos, vuelve al principio
    if (this.media.currentTime > 3) return this.irA(0);
    return this.cargarPista(this.indice - 1, { reproducir: !this.media.paused });
  }

  _alTerminar() {
    this.emitir("fin", { pista: this.pista });
    const esLaUltima = this.indice === this.pistas.length - 1;
    if (this.repetir === "una") {
      this.media.currentTime = 0;
      this.reproducir();
    } else if (this.repetir === "todas" || this.aleatorio || !esLaUltima) {
      this.siguiente();
    }
    // repetir = "no" y era la última: nos quedamos parados
  }

  alternarAleatorio() {
    this.aleatorio = !this.aleatorio;
    this.bAleatorio.classList.toggle("kr-activo", this.aleatorio);
    notificar(this.aleatorio ? "Modo aleatorio activado" : "Modo aleatorio desactivado", { duracion: 1500 });
  }

  alternarRepetir() {
    const orden = ["todas", "una", "no"];
    this.repetir = orden[(orden.indexOf(this.repetir) + 1) % orden.length];
    const textos = { todas: "Repetir: todas", una: "Repetir: una", no: "Repetir: no" };
    cambiarIcono(this.bRepetir, this.repetir === "una" ? "repetirUna" : "repetir", textos[this.repetir]);
    this.bRepetir.classList.toggle("kr-activo", this.repetir !== "no");
  }

  cambiarVelocidadCiclica() {
    const ciclo = [1, 1.25, 1.5, 2, 0.75];
    const v = ciclo[(ciclo.indexOf(this.velocidad) + 1) % ciclo.length];
    this.velocidad = v;
    return v;
  }

  /** Lee la duración de todas las pistas sin descargarlas enteras (preload="metadata"). */
  _leerDuraciones() {
    this.pistas.forEach((pista, i) => {
      if (i === this.indice || Number.isFinite(pista.duracion)) return;
      const fuente = elegirFuente(pista.fuentes);
      if (!fuente) return;
      const sonda = new Audio();
      sonda.preload = "metadata";
      sonda.onloadedmetadata = () => {
        pista.duracion = sonda.duration;
        this._pintarLista();
        sonda.removeAttribute("src");
      };
      sonda.onerror = () => {
        pista.error = true;
        this._pintarLista();
      };
      sonda.src = fuente.src;
    });
  }

  _pintarLista() {
    if (this.pistas.length < 2) return;
    this.lista.replaceChildren(
      ...this.pistas.map((p, i) =>
        crear(
          "li",
          {
            clase: `kr-lista-item${i === this.indice ? " kr-actual" : ""}${p.error ? " kr-erronea" : ""}`,
            eventos: { click: () => (i === this.indice ? this.alternar() : this.cargarPista(i, { reproducir: true })) },
          },
          [
            crear("span", { clase: "kr-lista-num" }, [
              i === this.indice && this.reproduciendo
                ? crear("span", { clase: "kr-ecualizando" }, [crear("i"), crear("i"), crear("i")])
                : String(i + 1).padStart(2, "0"),
            ]),
            crear("span", { clase: "kr-lista-texto" }, [crear("strong", { texto: p.titulo }), crear("small", { texto: p.artista })]),
            crear("span", { clase: "kr-lista-duracion", texto: p.error ? "error" : formatearTiempo(p.duracion) }),
          ],
        ),
      ),
    );
  }

  _pintarPortada() {
    const { titulo, portada } = this.pista;
    const caratula = this.portada.querySelector(".kr-caratula");
    if (portada) {
      caratula.style.background = `center / cover url("${portada}")`;
      caratula.textContent = "";
    } else {
      // Portada generativa: el color sale del título, así cada canción tiene la suya
      const h = tonoDesdeTexto(titulo);
      caratula.style.background = `radial-gradient(circle at 30% 25%, hsl(${(h + 40) % 360} 95% 70%), transparent 55%),
        conic-gradient(from ${h}deg at 70% 70%, hsl(${h} 85% 58%), hsl(${(h + 70) % 360} 85% 55%), hsl(${(h + 160) % 360} 80% 45%), hsl(${h} 85% 58%))`;
      caratula.textContent = titulo
        .split(/\s+/)
        .slice(0, 2)
        .map((p) => p[0])
        .join("")
        .toUpperCase();
    }
  }

  // ════════════════════════════════════════════════════════════════
  //  Web Audio: se crea al primer play (los navegadores lo exigen)
  // ════════════════════════════════════════════════════════════════

  async antesDeReproducir() {
    if (!this.cadena && !this._sinCadena) {
      try {
        this.cadena = new CadenaAudio(this.media);
        this.cadena.aplicarGanancias(this.eq.ganancias);
        this.cadena.fijarBalance(this.eq.balance);
      } catch (error) {
        // Sin Web Audio el audio sigue sonando, solo perdemos ecualizador y visualizador
        this._sinCadena = true;
        registro.aviso(this.nombre, "Web Audio no disponible:", error);
      }
    }
    await this.cadena?.reanudar();
  }

  fijarBanda(i, db) {
    this.eq.ganancias[i] = db;
    this._slidersEq[i].valor.textContent = `${db > 0 ? "+" : ""}${db} dB`;
    this.cadena?.ganancia(i, db);
    this.eq.preset = "personalizado";
    this.selectorPreset.value = "personalizado";
    this._guardarEq();
  }

  aplicarPreset(clave) {
    const preset = PRESETS_EQ[clave];
    if (!preset) return;
    preset.ganancias.forEach((db, i) => {
      this.eq.ganancias[i] = db;
      this._slidersEq[i].input.value = db;
      this._slidersEq[i].valor.textContent = `${db > 0 ? "+" : ""}${db} dB`;
    });
    this.cadena?.aplicarGanancias(preset.ganancias);
    this.eq.preset = clave;
    this.selectorPreset.value = clave;
    this._guardarEq();
    this.emitir("ecualizador", { ganancias: [...this.eq.ganancias] });
  }

  fijarBalance(v) {
    this.eq.balance = v;
    this.cadena?.fijarBalance(v);
    this._guardarEq();
  }

  _guardarEq() {
    preferencias.guardar("eq", this.eq);
  }

  alternarEcualizador(mostrar = this.panelEq.hidden) {
    this.panelEq.hidden = !mostrar;
    this.bEcualizador.classList.toggle("kr-activo", mostrar);
  }

  cambiarVisualizador(modo) {
    if (!this.visualizador) return;
    this.visualizador.modo = modo;
    preferencias.guardar("visualizador", modo);
    this._marcarModo();
  }

  _marcarModo() {
    const actual = preferencias.leer("visualizador", "barras");
    for (const boton of this.botonesModo) boton.classList.toggle("kr-activo", boton.dataset.modo === actual);
  }

  // ════════════════════════════════════════════════════════════════
  //  Forma de onda
  // ════════════════════════════════════════════════════════════════

  async _cargarOnda(src) {
    try {
      const buffer = await decodificar(src);
      if (this._fuenteActual !== src) return; // el usuario ya cambió de canción
      this._buffer = buffer;
      const canales = buffer.numberOfChannels === 1 ? "mono" : buffer.numberOfChannels === 2 ? "estéreo" : `${buffer.numberOfChannels} canales`;
      this.elMeta.textContent = `${extension(src).toUpperCase()} · ${(buffer.sampleRate / 1000).toFixed(1)} kHz · ${canales}`;
      this._recalcularPicos();
    } catch (error) {
      registro.aviso(this.nombre, "Sin forma de onda:", normalizarError(error).message);
      this._pintarOnda();
    }
  }

  _recalcularPicos() {
    const dpr = window.devicePixelRatio || 1;
    const { width, height } = this.lienzoOnda.getBoundingClientRect();
    if (!width) return;
    this.lienzoOnda.width = Math.round(width * dpr);
    this.lienzoOnda.height = Math.round(height * dpr);
    if (this._buffer) this._picos = calcularPicos(this._buffer, Math.max(20, Math.floor(width / 4)));
    this._pintarOnda();
  }

  _pintarOnda() {
    const lienzo = this.lienzoOnda;
    const ctx = lienzo.getContext("2d");
    const w = lienzo.width;
    const h = lienzo.height;
    if (!w) return;
    ctx.clearRect(0, 0, w, h);
    const d = this.media.duration;
    const progreso = Number.isFinite(d) && d > 0 ? this.media.currentTime / d : 0;
    const apagado = variableCSS(lienzo, "--kr-onda-apagada", "#3a3f55");
    const degradado = ctx.createLinearGradient(0, 0, w, 0);
    degradado.addColorStop(0, variableCSS(lienzo, "--kr-acento-1", "#ff5e7e"));
    degradado.addColorStop(0.5, variableCSS(lienzo, "--kr-acento-2", "#ffc857"));
    degradado.addColorStop(1, variableCSS(lienzo, "--kr-acento-3", "#2de1c2"));

    if (!this._picos) {
      // Aún no hay datos: una línea con la parte reproducida coloreada
      ctx.fillStyle = apagado;
      ctx.fillRect(0, h / 2 - 1, w, 2);
      ctx.fillStyle = degradado;
      ctx.fillRect(0, h / 2 - 1, w * progreso, 2);
    } else {
      const [izq, der = izq] = this._picos;
      const n = izq.length;
      const ancho = w / n;
      const barra = Math.max(1, ancho * 0.6);
      const medio = h / 2;
      for (let i = 0; i < n; i++) {
        const x = i * ancho;
        // Canal izquierdo hacia arriba, derecho hacia abajo
        const arriba = Math.max(1.5, izq[i] * medio * 0.95);
        const abajo = Math.max(1.5, der[i] * medio * 0.95);
        ctx.fillStyle = x / w < progreso ? degradado : apagado;
        ctx.globalAlpha = this._hover !== null && x / w < this._hover && x / w >= progreso ? 0.75 : 1;
        ctx.beginPath();
        ctx.roundRect(x, medio - arriba, barra, arriba + abajo, barra / 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    if (this._hover !== null && Number.isFinite(d)) {
      const x = this._hover * w;
      const dpr = window.devicePixelRatio || 1;
      ctx.fillStyle = variableCSS(lienzo, "--kr-texto", "#fff");
      ctx.fillRect(x - dpr / 2, 0, dpr, h);
      ctx.font = `600 ${11 * dpr}px system-ui, sans-serif`;
      const texto = formatearTiempo(this._hover * d);
      const ancho = ctx.measureText(texto).width + 10 * dpr;
      const tx = limitar(x - ancho / 2, 0, w - ancho);
      ctx.fillStyle = "rgba(0,0,0,.75)";
      ctx.beginPath();
      ctx.roundRect(tx, 0, ancho, 16 * dpr, 4 * dpr);
      ctx.fill();
      ctx.fillStyle = "#fff";
      ctx.fillText(texto, tx + 5 * dpr, 12 * dpr);
    }
  }

  // ════════════════════════════════════════════════════════════════
  //  Letra sincronizada
  // ════════════════════════════════════════════════════════════════

  async _cargarLetra() {
    const pista = this.pista;
    this._lineaActual = -1;
    this.listaLetra.replaceChildren();
    this.bLetra.hidden = !pista.letra;
    if (!pista.letra) {
      this.letra.hidden = true;
      this.raiz.classList.remove("kr-con-letra");
      return;
    }
    try {
      await pista.letra.cargar();
      if (pista !== this.pista) return;
      this.listaLetra.replaceChildren(
        ...pista.letra.frases.map((f) =>
          crear("li", { texto: f.texto, eventos: { click: () => (this.irA(f.inicio), this.media.paused && this.reproducir()) } }),
        ),
      );
      // Si el usuario no la ha cerrado, se muestra al cargar
      if (preferencias.leer("letra", true)) this.alternarLetra(true);
    } catch (error) {
      this.bLetra.hidden = true;
      registro.aviso(this.nombre, normalizarError(error).message);
    }
  }

  alternarLetra(mostrar = this.letra.hidden) {
    this.letra.hidden = !mostrar;
    this.raiz.classList.toggle("kr-con-letra", mostrar);
    this.bLetra.classList.toggle("kr-activo", mostrar);
    preferencias.guardar("letra", mostrar);
    this._lineaActual = -1;
    this._pintarLetra();
  }

  _pintarLetra() {
    const letra = this.pista.letra;
    if (!letra?.cargada || this.letra.hidden) return;
    const i = letra.ultimaIniciadaEn(this.media.currentTime);
    if (i === this._lineaActual) return;
    this._lineaActual = i;
    const lineas = this.listaLetra.children;
    for (let n = 0; n < lineas.length; n++) {
      lineas[n].classList.toggle("kr-cantada", n < i);
      lineas[n].classList.toggle("kr-actual", n === i);
    }
    // Centramos la línea actual moviendo la lista con una transición CSS
    const objetivo = lineas[Math.max(0, i)];
    if (objetivo) {
      const desplazamiento = objetivo.offsetTop + objetivo.offsetHeight / 2 - this.letra.clientHeight / 2;
      this.listaLetra.style.transform = `translateY(${-Math.max(0, desplazamiento)}px)`;
    }
  }

  // ════════════════════════════════════════════════════════════════
  //  Bucle de pintado
  // ════════════════════════════════════════════════════════════════

  _iniciarBucle() {
    cancelAnimationFrame(this._frame);
    const paso = () => {
      this._pintarTodo();
      this._frame = requestAnimationFrame(paso);
    };
    paso();
  }

  _pintarTodo() {
    const t = this.media.currentTime;
    const texto = formatearTiempo(t);
    if (this.elActual.textContent !== texto) this.elActual.textContent = texto;
    this.lienzoOnda.setAttribute("aria-valuenow", Math.round(t));
    this._pintarOnda();
    this._pintarLetra();
    if (!this.opciones.compacto && "mediaSession" in navigator && Number.isFinite(this.media.duration) && navigator.mediaSession.setPositionState) {
      try {
        navigator.mediaSession.setPositionState({ duration: this.media.duration, position: Math.min(t, this.media.duration), playbackRate: this.media.playbackRate });
      } catch {
        /* algunos navegadores son quisquillosos con los valores */
      }
    }
  }

  _pintarVolumen() {
    const nivel = this.media.muted ? 0 : this.media.volume;
    this.deslizadorVolumen.value = nivel;
    this.deslizadorVolumen.style.setProperty("--valor", nivel);
    cambiarIcono(this.bVolumen, nivel === 0 ? "silencio" : "volumen", nivel === 0 ? "Activar sonido (M)" : "Silenciar (M)");
  }

  mostrarError() {
    this.raiz.classList.add("kr-con-error");
    this.elMeta.textContent = "No se puede reproducir este archivo";
    this.pista.error = true;
    this._pintarLista();
  }

  // ════════════════════════════════════════════════════════════════
  //  Media Session: controles en la pantalla de bloqueo / teclas multimedia
  // ════════════════════════════════════════════════════════════════

  _actualizarMediaSession() {
    if (!("mediaSession" in navigator) || this.opciones.compacto) return;
    const { titulo, artista, portada } = this.pista;
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: titulo,
        artist: artista,
        album: "Kroma",
        artwork: portada ? [{ src: portada, sizes: "512x512" }] : [],
      });
      const acciones = {
        play: () => this.reproducir(),
        pause: () => this.pausar(),
        previoustrack: () => this.anterior(),
        nexttrack: () => this.siguiente(),
        seekbackward: () => this.saltar(-10),
        seekforward: () => this.saltar(10),
        seekto: (d) => this.irA(d.seekTime),
      };
      for (const [accion, fn] of Object.entries(acciones)) navigator.mediaSession.setActionHandler(accion, fn);
    } catch (error) {
      registro.aviso(this.nombre, "Media Session no disponible", error);
    }
  }

  // ════════════════════════════════════════════════════════════════
  //  Conversión: exportar a WAV
  // ════════════════════════════════════════════════════════════════

  /** Decodifica la pista actual y la guarda como WAV (opcionalmente con el ecualizador). */
  async exportarWav({ conEcualizador = false } = {}) {
    const aviso = notificar("Decodificando y convirtiendo a WAV…", { tipo: "info", duracion: 0 });
    try {
      let buffer = this._buffer ?? (await decodificar(this._fuenteActual));
      if (conEcualizador) buffer = await renderizarConEcualizador(buffer, this.eq.ganancias, this.eq.balance);
      const wav = audioBufferAWav(buffer);
      const nombre = `${this.pista.titulo}${conEcualizador ? " (ecualizado)" : ""}.wav`;
      descargar(wav, nombre);
      aviso.cerrar();
      notificar(`${nombre} · ${formatearBytes(wav.size)} · ${buffer.sampleRate} Hz, 16 bits`, { tipo: "exito", titulo: "Conversión terminada" });
      this.emitir("exportar", { blob: wav });
    } catch (error) {
      aviso.cerrar();
      const e = normalizarError(error);
      registro.error(this.nombre, "Exportación fallida", e);
      notificar(e.message, { tipo: "error", titulo: "No se pudo exportar" });
    }
  }

  destruir() {
    cancelAnimationFrame(this._frame);
    super.destruir();
  }
}
