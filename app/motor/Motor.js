/**
 * Serenia · motor de reproducción
 *
 *   ┌ <audio> A ─ fuente ─ ganancia A ┐
 *   ├ <audio> B ─ fuente ─ ganancia B ┼─► ecualizador (5 bandas) ─┬─ seco ──────────┬─► balance ─► limitador ─► analizador ─► altavoces
 *   └ <video>   ─ fuente ─ ganancia V ┘                           └─ reverb ─ húmedo ┘
 *
 * - Dos <audio> que se alternan: mientras uno termina, el otro empieza (fundido cruzado).
 * - La ganancia de cada elemento aplica la normalización de la canción y los fundidos.
 * - El limitador (DynamicsCompressor) evita saturar al subir el ecualizador.
 *
 * Eventos: "pista", "estado", "cola", "modo", "volumen", "ajustes", "apagado", "error"
 */

import { biblioteca } from "../datos/biblioteca.js";
import { bd } from "../datos/bd.js";
import { obtenerContexto, BANDAS, PRESETS_EQ } from "../../kroma/procesado/cadenaAudio.js";
import { desdeMediaError, normalizarError } from "../../kroma/nucleo/errores.js";
import { registro } from "../../kroma/nucleo/registro.js";

const dbALineal = (db) => 10 ** (db / 20);

export const AJUSTES_INICIALES = {
  volumen: 0.85,
  silencio: false,
  velocidad: 1,
  fundido: 4, //          segundos de fundido cruzado entre canciones (0 = desactivado)
  normalizar: true, //    igualar el volumen de todas las canciones
  ganancias: [0, 0, 0, 0, 0],
  preset: "plano",
  balance: 0,
  reverb: 0, //           0…1
  idiomaSubtitulos: "es",
};

export class Motor extends EventTarget {
  /**
   * @param {object} o
   * @param {HTMLVideoElement} o.video  el <video> del escenario de la app
   * @param {(pista: object, url: string) => void} o.prepararVideo  carga el vídeo con subtítulos/capítulos
   */
  constructor({ video, prepararVideo }) {
    super();
    this.audios = [new Audio(), new Audio()];
    for (const a of this.audios) a.preload = "auto";
    this.video = video;
    this.prepararVideo = prepararVideo;
    this.elementos = [...this.audios, video];

    this.activo = null; //            elemento que suena ahora
    this.pista = null;
    this.ids = []; //                 cola de reproducción (ids)
    this.original = null; //          orden antes de activar el aleatorio
    this.indice = -1;
    this.aleatorio = false;
    this.repetir = "no"; //           "no" | "todas" | "una"
    this.ajustes = { ...AJUSTES_INICIALES };
    this.grafo = null;
    this._fundiendo = null;
    this._contada = false;
    this._apagado = null;

    for (const el of this.elementos) this._escucharElemento(el);
    this._configurarMediaSession();
    window.addEventListener("pagehide", () => this.guardarSesion());
  }

  // ════════════════════════════════════════════════════════════════
  //  Estado
  // ════════════════════════════════════════════════════════════════

  get reproduciendo() {
    return !!this.activo && !this.activo.paused && !this.activo.ended;
  }
  get tiempo() {
    return this.activo?.currentTime ?? 0;
  }
  get duracion() {
    const d = this.activo?.duration;
    return Number.isFinite(d) ? d : this.pista?.duracion || 0;
  }
  get siguienteId() {
    const i = this._indiceSiguiente();
    return i === -1 ? null : this.ids[i];
  }

  _emitir(tipo, detalle = {}) {
    this.dispatchEvent(new CustomEvent(tipo, { detail: detalle }));
  }

  // ════════════════════════════════════════════════════════════════
  //  Cargar y reproducir
  // ════════════════════════════════════════════════════════════════

  /** Sustituye la cola por `ids` y empieza por `inicio`. */
  async reproducirLista(ids, inicio = 0, { aleatorio = this.aleatorio } = {}) {
    if (!ids.length) return;
    this.ids = [...ids];
    this.original = null;
    this.indice = Math.max(0, Math.min(inicio, ids.length - 1));
    if (aleatorio) this._barajar();
    else this.aleatorio = false;
    this._emitir("modo");
    this._emitir("cola");
    await this.cargar(this.indice, { reproducir: true });
  }

  /** Carga la pista de la posición `indice` de la cola. */
  async cargar(indice, { reproducir = true, posicion = 0 } = {}) {
    const pista = biblioteca.obtener(this.ids[indice]);
    if (!pista) return;
    this._cancelarFundido();
    this.indice = indice;
    this.pista = pista;
    this._contada = false;

    const url = biblioteca.urlMedia(pista);
    let elemento;
    if (pista.tipo === "video") {
      elemento = this.video;
      this.prepararVideo(pista, url);
    } else {
      // Usamos el <audio> que no está sonando
      elemento = this.activo === this.audios[0] ? this.audios[1] : this.audios[0];
      if (elemento.dataset.pista !== pista.id) {
        elemento.src = url;
        elemento.dataset.pista = pista.id;
      }
    }
    for (const el of this.elementos) if (el !== elemento) el.pause();
    this.activo = elemento;
    elemento.playbackRate = this.ajustes.velocidad;
    this._aplicarVolumen();
    this._fijarGananciaElemento(elemento, this._gananciaPista(pista), 0.01);

    if (posicion > 0) {
      const saltar = () => (elemento.currentTime = posicion);
      if (elemento.readyState >= 1) saltar();
      else elemento.addEventListener("loadedmetadata", saltar, { once: true });
    } else if (elemento.currentTime > 0 && elemento.readyState >= 1) {
      elemento.currentTime = 0;
    }

    registro.info("motor", `▶ ${pista.titulo} (${pista.tipo})`);
    this._emitir("pista", { pista, elemento });
    this._emitir("cola");
    this._actualizarMediaSession();
    if (reproducir) await this.reproducir();
    this.guardarSesion();
  }

  async reproducir() {
    if (!this.activo) {
      if (this.ids.length) return this.cargar(Math.max(0, this.indice), { reproducir: true });
      return;
    }
    try {
      this._asegurarGrafo();
      await this.grafo?.ctx.resume();
      await this.activo.play();
    } catch (error) {
      if (error.name === "AbortError") return;
      this._emitir("error", { error: normalizarError(error), pista: this.pista });
    }
  }

  pausar() {
    this.activo?.pause();
    this.guardarSesion();
  }

  alternar() {
    return this.reproduciendo ? this.pausar() : this.reproducir();
  }

  siguiente() {
    const i = this._indiceSiguiente({ manual: true });
    if (i === -1) return;
    return this.cargar(i, { reproducir: true });
  }

  /** Como en cualquier reproductor: si ya llevamos unos segundos, vuelve al principio. */
  anterior() {
    if (this.tiempo > 3) return this.irA(0);
    if (this.indice > 0) return this.cargar(this.indice - 1);
    if (this.repetir === "todas") return this.cargar(this.ids.length - 1);
    return this.irA(0);
  }

  irA(t) {
    if (!this.activo) return;
    this._cancelarFundido();
    this.activo.currentTime = Math.max(0, Math.min(t, this.duracion || t));
  }

  saltar(segundos) {
    this.irA(this.tiempo + segundos);
  }

  /** Índice de la siguiente pista según repetir; -1 si se acaba la cola. */
  _indiceSiguiente({ manual = false } = {}) {
    if (!this.ids.length) return -1;
    if (this.repetir === "una" && !manual) return this.indice;
    if (this.indice + 1 < this.ids.length) return this.indice + 1;
    return this.repetir === "todas" || (manual && this.repetir === "una") ? 0 : -1;
  }

  _alTerminar() {
    if (this._apagado?.fin) {
      // Temporizador "al terminar la canción"
      this._apagado = null;
      this._emitir("apagado", { activo: false, ejecutado: true });
      this._emitir("estado", { reproduciendo: false });
      return;
    }
    const i = this._indiceSiguiente();
    if (i === -1) {
      this._emitir("estado", { reproduciendo: false, fin: true });
      this.activo.currentTime = 0;
      return;
    }
    if (i === this.indice) {
      this.activo.currentTime = 0;
      this.reproducir();
    } else this.cargar(i, { reproducir: true });
  }

  // ════════════════════════════════════════════════════════════════
  //  Cola
  // ════════════════════════════════════════════════════════════════

  /** "Reproducir a continuación": justo detrás de la actual. */
  anadirSiguiente(ids) {
    if (!this.ids.length) return this.reproducirLista(ids);
    this.ids.splice(this.indice + 1, 0, ...ids);
    this.original?.push(...ids);
    this._emitir("cola");
    this.guardarSesion();
  }

  anadirAlFinal(ids) {
    if (!this.ids.length) return this.reproducirLista(ids);
    this.ids.push(...ids);
    this.original?.push(...ids);
    this._emitir("cola");
    this.guardarSesion();
  }

  /** Inserta pistas en una posición concreta de la cola (arrastrar y soltar). */
  insertarEnCola(posicion, ids) {
    this.ids.splice(posicion, 0, ...ids);
    if (posicion <= this.indice) this.indice += ids.length;
    this.original?.push(...ids);
    this._emitir("cola");
  }

  quitarDeCola(posicion) {
    if (posicion === this.indice) return;
    this.ids.splice(posicion, 1);
    if (posicion < this.indice) this.indice--;
    this._emitir("cola");
  }

  /** Arrastrar y soltar dentro de la cola. */
  moverEnCola(de, a) {
    if (de === a) return;
    const [id] = this.ids.splice(de, 1);
    this.ids.splice(a, 0, id);
    if (de === this.indice) this.indice = a;
    else if (de < this.indice && a >= this.indice) this.indice--;
    else if (de > this.indice && a <= this.indice) this.indice++;
    this._emitir("cola");
  }

  vaciarSiguientes() {
    this.ids.splice(this.indice + 1);
    this._emitir("cola");
  }

  /** Fisher–Yates: baraja todo menos la pista actual, que pasa a ser la primera. */
  _barajar() {
    this.original = [...this.ids];
    const actual = this.ids[this.indice];
    const resto = this.ids.filter((_, i) => i !== this.indice);
    for (let i = resto.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [resto[i], resto[j]] = [resto[j], resto[i]];
    }
    this.ids = actual ? [actual, ...resto] : resto;
    this.indice = 0;
    this.aleatorio = true;
  }

  alternarAleatorio() {
    if (this.aleatorio) {
      const actual = this.ids[this.indice];
      if (this.original) this.ids = this.original;
      this.indice = Math.max(0, this.ids.indexOf(actual));
      this.original = null;
      this.aleatorio = false;
    } else this._barajar();
    this._emitir("modo");
    this._emitir("cola");
    this.guardarSesion();
  }

  cambiarRepetir() {
    const orden = ["no", "todas", "una"];
    this.repetir = orden[(orden.indexOf(this.repetir) + 1) % 3];
    this._emitir("modo");
    this.guardarSesion();
  }

  // ════════════════════════════════════════════════════════════════
  //  Volumen, velocidad y sonido
  // ════════════════════════════════════════════════════════════════

  fijarVolumen(v) {
    this.ajustes.volumen = Math.max(0, Math.min(1, v));
    if (v > 0) this.ajustes.silencio = false;
    this._aplicarVolumen();
  }

  alternarSilencio() {
    this.ajustes.silencio = !this.ajustes.silencio;
    this._aplicarVolumen();
  }

  _aplicarVolumen() {
    this._sincronizando = true;
    for (const el of this.elementos) {
      el.volume = this.ajustes.volumen;
      el.muted = this.ajustes.silencio;
    }
    this._sincronizando = false;
    this._emitir("volumen", { volumen: this.ajustes.volumen, silencio: this.ajustes.silencio });
    this._guardarAjustes();
  }

  fijarVelocidad(v) {
    this.ajustes.velocidad = v;
    for (const el of this.elementos) {
      el.playbackRate = v;
      el.preservesPitch = true;
    }
    this._emitir("ajustes");
    this._guardarAjustes();
  }

  /** Cambia ajustes de sonido (ganancias, preset, balance, reverb, normalizar, fundido…). */
  configurar(cambios) {
    Object.assign(this.ajustes, cambios);
    if (cambios.preset && PRESETS_EQ[cambios.preset]) this.ajustes.ganancias = [...PRESETS_EQ[cambios.preset].ganancias];
    this._aplicarSonido();
    if ("normalizar" in cambios && this.activo && this.pista) this._fijarGananciaElemento(this.activo, this._gananciaPista(this.pista), 0.2);
    this._emitir("ajustes");
    this._guardarAjustes();
  }

  _gananciaPista(pista) {
    return this.ajustes.normalizar && pista?.ganancia ? dbALineal(pista.ganancia) : 1;
  }

  // ── Grafo de Web Audio ─────────────────────────────────────────────

  /** Se crea en el primer play: los navegadores exigen un gesto del usuario. */
  _asegurarGrafo() {
    if (this.grafo || this._sinGrafo) return;
    try {
      const ctx = obtenerContexto();
      const entrada = ctx.createGain();
      const ganancias = new Map();
      for (const el of this.elementos) {
        const fuente = ctx.createMediaElementSource(el);
        const g = ctx.createGain();
        fuente.connect(g).connect(entrada);
        ganancias.set(el, g);
      }
      // Ecualizador
      const filtros = BANDAS.map(({ frecuencia, tipo }) => {
        const f = ctx.createBiquadFilter();
        f.type = tipo;
        f.frequency.value = frecuencia;
        f.Q.value = 1.1;
        return f;
      });
      filtros.reduce((anterior, f) => anterior.connect(f), entrada);
      const salidaEq = filtros.at(-1);

      // Reverb: convolución con una respuesta al impulso sintética (ruido que decae)
      const seco = ctx.createGain();
      const humedo = ctx.createGain();
      const convolver = ctx.createConvolver();
      convolver.buffer = respuestaImpulso(ctx, 2.6);
      salidaEq.connect(seco);
      salidaEq.connect(convolver).connect(humedo);

      const balance = ctx.createStereoPanner();
      seco.connect(balance);
      humedo.connect(balance);

      // Limitador: casi una pared en -1 dBFS
      const limitador = ctx.createDynamicsCompressor();
      limitador.threshold.value = -1;
      limitador.knee.value = 0;
      limitador.ratio.value = 20;
      limitador.attack.value = 0.003;
      limitador.release.value = 0.25;

      const analizador = ctx.createAnalyser();
      analizador.fftSize = 2048;
      analizador.smoothingTimeConstant = 0.8;
      balance.connect(limitador).connect(analizador).connect(ctx.destination);

      this.grafo = { ctx, ganancias, filtros, seco, humedo, balance, limitador, analizador, frec: new Uint8Array(analizador.frequencyBinCount), onda: new Uint8Array(analizador.fftSize) };
      this._aplicarSonido();
      if (this.activo) this._fijarGananciaElemento(this.activo, this._gananciaPista(this.pista), 0.01);
      registro.info("motor", `Grafo de audio listo a ${ctx.sampleRate} Hz`);
    } catch (error) {
      this._sinGrafo = true;
      registro.aviso("motor", "Sin Web Audio: no habrá ecualizador ni visualizador", error);
    }
  }

  _aplicarSonido() {
    const g = this.grafo;
    if (!g) return;
    const t = g.ctx.currentTime;
    this.ajustes.ganancias.forEach((db, i) => g.filtros[i].gain.setTargetAtTime(db, t, 0.03));
    g.balance.pan.setTargetAtTime(this.ajustes.balance, t, 0.03);
    // Mezcla seco/húmedo con potencia constante
    const r = this.ajustes.reverb;
    g.seco.gain.setTargetAtTime(Math.cos((r * Math.PI) / 2), t, 0.05);
    g.humedo.gain.setTargetAtTime(Math.sin((r * Math.PI) / 2) * 0.9, t, 0.05);
  }

  _fijarGananciaElemento(el, valor, rampa = 0.05) {
    const g = this.grafo?.ganancias.get(el);
    if (!g) return;
    g.gain.cancelScheduledValues(this.grafo.ctx.currentTime);
    g.gain.setTargetAtTime(valor, this.grafo.ctx.currentTime, rampa);
  }

  /** Datos para el visualizador (misma forma que CadenaAudio). */
  get analisis() {
    const g = this.grafo;
    if (!g) return null;
    return {
      frecuencias: () => (g.analizador.getByteFrequencyData(g.frec), g.frec),
      onda: () => (g.analizador.getByteTimeDomainData(g.onda), g.onda),
    };
  }

  // ════════════════════════════════════════════════════════════════
  //  Fundido cruzado
  // ════════════════════════════════════════════════════════════════

  _comprobarFundido() {
    const el = this.activo;
    if (!el || this._fundiendo || !this.grafo || this.pista?.tipo !== "audio" || el.paused) return;
    const fundido = this.ajustes.fundido;
    if (!fundido || this.repetir === "una" || this._apagado?.fin) return;
    const restante = el.duration - el.currentTime;
    if (!Number.isFinite(restante)) return;
    const siguiente = biblioteca.obtener(this.siguienteId);
    if (!siguiente || siguiente.tipo !== "audio" || siguiente.id === this.pista.id) return;
    const otro = el === this.audios[0] ? this.audios[1] : this.audios[0];

    // Precarga unos segundos antes para que no haya silencio
    if (restante < fundido + 8 && otro.dataset.pista !== siguiente.id) {
      otro.src = biblioteca.urlMedia(siguiente);
      otro.dataset.pista = siguiente.id;
      otro.load();
    }
    if (restante <= fundido && restante > 0.3) this._fundir(el, otro, siguiente, restante);
  }

  _fundir(saliente, entrante, siguiente, segundos) {
    const ctx = this.grafo.ctx;
    const t = ctx.currentTime;
    const gs = this.grafo.ganancias.get(saliente).gain;
    const ge = this.grafo.ganancias.get(entrante).gain;
    gs.cancelScheduledValues(t);
    gs.setValueAtTime(gs.value, t);
    gs.linearRampToValueAtTime(0, t + segundos);
    ge.cancelScheduledValues(t);
    ge.setValueAtTime(0, t);
    ge.linearRampToValueAtTime(this._gananciaPista(siguiente), t + segundos);

    entrante.currentTime = 0;
    entrante.playbackRate = this.ajustes.velocidad;
    entrante.play().catch(() => {});
    this._fundiendo = { saliente, temporizador: setTimeout(() => this._terminarFundido(), segundos * 1000 + 100) };

    // Para la interfaz ya suena la siguiente
    this.indice = this._indiceSiguiente();
    this.pista = siguiente;
    this.activo = entrante;
    this._contada = false;
    registro.info("motor", `Fundido de ${segundos.toFixed(1)} s hacia «${siguiente.titulo}»`);
    this._emitir("pista", { pista: siguiente, elemento: entrante, fundido: true });
    this._emitir("cola");
    this._actualizarMediaSession();
  }

  _terminarFundido() {
    if (!this._fundiendo) return;
    const { saliente } = this._fundiendo;
    saliente.pause();
    this._fundiendo = null;
  }

  _cancelarFundido() {
    if (!this._fundiendo) return;
    clearTimeout(this._fundiendo.temporizador);
    this._fundiendo.saliente.pause();
    this._fundiendo = null;
    if (this.activo && this.pista) this._fijarGananciaElemento(this.activo, this._gananciaPista(this.pista), 0.02);
  }

  // ════════════════════════════════════════════════════════════════
  //  Eventos de los elementos
  // ════════════════════════════════════════════════════════════════

  _escucharElemento(el) {
    const esActivo = () => el === this.activo;
    el.addEventListener("play", () => esActivo() && this._emitir("estado", { reproduciendo: true }));
    el.addEventListener("pause", () => esActivo() && this._emitir("estado", { reproduciendo: false }));
    el.addEventListener("waiting", () => esActivo() && this._emitir("estado", { reproduciendo: true, esperando: true }));
    el.addEventListener("playing", () => esActivo() && this._emitir("estado", { reproduciendo: true }));
    el.addEventListener("ended", () => esActivo() && this._alTerminar());
    el.addEventListener("timeupdate", () => {
      if (!esActivo()) return;
      this._comprobarFundido();
      this._contarReproduccion();
      // Recordar por dónde iba (para vídeos y la sesión)
      if (Math.abs(el.currentTime - (this._ultimoGuardado ?? -10)) > 5) {
        this._ultimoGuardado = el.currentTime;
        this.guardarSesion();
        if (this.pista?.tipo === "video") biblioteca.actualizar(this.pista.id, { posicion: el.currentTime > el.duration - 8 ? 0 : el.currentTime }, { silencioso: true });
      }
    });
    el.addEventListener("volumechange", () => {
      // El reproductor de vídeo tiene su propio control de volumen: lo sincronizamos
      if (this._sincronizando || this._ignorarVolumen || !esActivo()) return;
      if (el.volume !== this.ajustes.volumen || el.muted !== this.ajustes.silencio) {
        this.ajustes.volumen = el.volume;
        this.ajustes.silencio = el.muted;
        this._aplicarVolumen();
      }
    });
    el.addEventListener("ratechange", () => {
      if (esActivo() && el.playbackRate !== this.ajustes.velocidad) this.fijarVelocidad(el.playbackRate);
    });
    el.addEventListener("error", () => {
      if (!esActivo() || !el.error) return;
      const error = desdeMediaError(el.error);
      registro.error("motor", this.pista?.titulo, error.message);
      this._emitir("error", { error, pista: this.pista });
    });
  }

  _contarReproduccion() {
    if (this._contada || !this.pista) return;
    const t = this.activo.currentTime;
    if (t > 30 || (this.duracion && t > this.duracion * 0.5)) {
      this._contada = true;
      biblioteca.registrarReproduccion(this.pista.id);
    }
  }

  // ════════════════════════════════════════════════════════════════
  //  Temporizador de apagado
  // ════════════════════════════════════════════════════════════════

  /** @param {number|"fin"|null} minutos  null cancela; "fin" = al acabar la pista actual */
  programarApagado(minutos) {
    clearTimeout(this._apagado?.temporizador);
    this._apagado = null;
    if (minutos === "fin") {
      // _alTerminar() lo comprueba y no pasa a la siguiente
      this._apagado = { fin: true };
    } else if (minutos) {
      const hora = Date.now() + minutos * 60_000;
      this._apagado = { hora, temporizador: setTimeout(() => this._apagarSuave(), minutos * 60_000) };
    }
    this._emitir("apagado", { activo: !!this._apagado, ...this._apagado });
  }

  get apagado() {
    return this._apagado;
  }

  /** Baja el volumen poco a poco durante 8 s y pausa. */
  _apagarSuave() {
    const inicial = this.ajustes.volumen;
    const pasos = 40;
    let n = 0;
    this._ignorarVolumen = true; // que el fundido no se guarde como volumen del usuario
    const id = setInterval(() => {
      n++;
      for (const el of this.elementos) el.volume = inicial * (1 - n / pasos);
      if (n >= pasos) {
        clearInterval(id);
        this.pausar();
        this._aplicarVolumen();
        setTimeout(() => (this._ignorarVolumen = false), 100);
        this._apagado = null;
        this._emitir("apagado", { activo: false, ejecutado: true });
      }
    }, 200);
  }

  // ════════════════════════════════════════════════════════════════
  //  Media Session (pantalla de bloqueo, teclas multimedia)
  // ════════════════════════════════════════════════════════════════

  _configurarMediaSession() {
    if (!("mediaSession" in navigator)) return;
    const acciones = {
      play: () => this.reproducir(),
      pause: () => this.pausar(),
      previoustrack: () => this.anterior(),
      nexttrack: () => this.siguiente(),
      seekbackward: (d) => this.saltar(-(d.seekOffset || 10)),
      seekforward: (d) => this.saltar(d.seekOffset || 10),
      seekto: (d) => this.irA(d.seekTime),
    };
    for (const [accion, fn] of Object.entries(acciones)) {
      try {
        navigator.mediaSession.setActionHandler(accion, fn);
      } catch {
        /* acción no soportada en este navegador */
      }
    }
  }

  _actualizarMediaSession() {
    if (!("mediaSession" in navigator) || !this.pista) return;
    const portada = biblioteca.urlPortada(this.pista);
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: this.pista.titulo,
        artist: this.pista.artista,
        album: this.pista.album,
        artwork: portada ? [{ src: portada, sizes: "512x512" }] : [],
      });
    } catch {
      /* sin soporte */
    }
  }

  // ════════════════════════════════════════════════════════════════
  //  Sesión: al volver a abrir la app, todo sigue donde estaba
  // ════════════════════════════════════════════════════════════════

  guardarSesion() {
    if (!this.ids.length) return;
    bd.guardarAjuste("sesion", {
      ids: this.ids,
      original: this.original,
      indice: this.indice,
      posicion: this.tiempo,
      aleatorio: this.aleatorio,
      repetir: this.repetir,
    });
  }

  _guardarAjustes() {
    clearTimeout(this._tGuardar);
    this._tGuardar = setTimeout(() => bd.guardarAjuste("sonido", this.ajustes), 300);
  }

  async restaurar() {
    const ajustes = await bd.leerAjuste("sonido", null);
    if (ajustes) this.ajustes = { ...AJUSTES_INICIALES, ...ajustes };
    this._aplicarVolumen();
    this.fijarVelocidad(this.ajustes.velocidad);
    const s = await bd.leerAjuste("sesion", null);
    if (!s?.ids?.length) return false;
    this.ids = s.ids.filter((id) => biblioteca.obtener(id));
    if (!this.ids.length) return false;
    this.original = s.original?.filter((id) => biblioteca.obtener(id)) ?? null;
    this.aleatorio = !!s.aleatorio;
    this.repetir = s.repetir ?? "no";
    const indice = Math.max(0, this.ids.indexOf(s.ids[s.indice]));
    this._emitir("modo");
    await this.cargar(indice, { reproducir: false, posicion: s.posicion || 0 });
    return true;
  }
}

/** Respuesta al impulso estéreo: ruido blanco con caída exponencial (sala mediana). */
function respuestaImpulso(ctx, segundos) {
  const largo = Math.floor(ctx.sampleRate * segundos);
  const buffer = ctx.createBuffer(2, largo, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = buffer.getChannelData(c);
    for (let i = 0; i < largo; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / largo) ** 3;
  }
  return buffer;
}
