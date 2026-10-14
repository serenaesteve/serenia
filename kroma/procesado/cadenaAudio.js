/**
 * Kroma · cadena de audio (Web Audio API)
 *
 *   <audio> ──► ecualizador de 5 bandas ──► balance L/R ──► analizador ──► altavoces
 *
 * El analizador (AnalyserNode) aplica una FFT y nos da, en cada fotograma,
 * la energía por frecuencias y la forma de onda: con eso se dibujan los visualizadores.
 */

import { registro } from "../nucleo/registro.js";
import { ErrorSoporte } from "../nucleo/errores.js";

/** Frecuencias centrales de las bandas (Hz) y su nombre. */
export const BANDAS = [
  { frecuencia: 60, nombre: "Sub", tipo: "lowshelf" },
  { frecuencia: 250, nombre: "Graves", tipo: "peaking" },
  { frecuencia: 1000, nombre: "Medios", tipo: "peaking" },
  { frecuencia: 4000, nombre: "Presencia", tipo: "peaking" },
  { frecuencia: 12000, nombre: "Brillo", tipo: "highshelf" },
];

/** Ganancias en dB para cada banda. */
export const PRESETS_EQ = {
  plano: { nombre: "Plano", ganancias: [0, 0, 0, 0, 0] },
  graves: { nombre: "Más graves", ganancias: [7, 4, 0, -1, -1] },
  voz: { nombre: "Voz", ganancias: [-4, -1, 3, 4, 1] },
  brillante: { nombre: "Brillante", ganancias: [-1, 0, 1, 4, 7] },
  noche: { nombre: "Modo noche", ganancias: [3, 1, 0, -3, -6] },
  radio: { nombre: "Radio antigua", ganancias: [-12, -4, 6, 2, -12] },
};

let contexto = null;

/** Un único AudioContext para toda la página (los navegadores limitan cuántos se pueden crear). */
export function obtenerContexto() {
  if (!contexto) {
    const Clase = window.AudioContext ?? window.webkitAudioContext;
    if (!Clase) throw new ErrorSoporte("Este navegador no soporta la Web Audio API.", { codigo: "sin-webaudio" });
    contexto = new Clase();
    registro.info("audio", `AudioContext creado a ${contexto.sampleRate} Hz`);
  }
  return contexto;
}

export class CadenaAudio {
  /** @param {HTMLMediaElement} media */
  constructor(media) {
    const ctx = obtenerContexto();
    this.ctx = ctx;

    // Solo se puede crear UNA fuente por elemento: a partir de aquí el sonido
    // del <audio> pasa obligatoriamente por esta cadena.
    this.fuente = ctx.createMediaElementSource(media);

    this.filtros = BANDAS.map(({ frecuencia, tipo }) => {
      const f = ctx.createBiquadFilter();
      f.type = tipo;
      f.frequency.value = frecuencia;
      f.Q.value = 1.1;
      f.gain.value = 0;
      return f;
    });

    this.balance = ctx.createStereoPanner();

    this.analizador = ctx.createAnalyser();
    this.analizador.fftSize = 2048;
    this.analizador.smoothingTimeConstant = 0.82;

    // Conectamos en serie: fuente → filtros… → balance → analizador → salida
    let nodo = this.fuente;
    for (const filtro of this.filtros) {
      nodo.connect(filtro);
      nodo = filtro;
    }
    nodo.connect(this.balance);
    this.balance.connect(this.analizador);
    this.analizador.connect(ctx.destination);

    this._frecuencias = new Uint8Array(this.analizador.frequencyBinCount);
    this._onda = new Uint8Array(this.analizador.fftSize);
  }

  /** Los navegadores arrancan el contexto "suspendido" hasta que el usuario interactúa. */
  async reanudar() {
    if (this.ctx.state === "suspended") await this.ctx.resume();
  }

  /** Cambia la ganancia (dB) de una banda con una transición suave para evitar chasquidos. */
  ganancia(indice, db) {
    this.filtros[indice].gain.setTargetAtTime(db, this.ctx.currentTime, 0.03);
  }

  aplicarGanancias(ganancias) {
    ganancias.forEach((db, i) => this.ganancia(i, db));
  }

  /** -1 = todo a la izquierda, 1 = todo a la derecha. */
  fijarBalance(valor) {
    this.balance.pan.setTargetAtTime(valor, this.ctx.currentTime, 0.03);
  }

  get ganancias() {
    return this.filtros.map((f) => f.gain.value);
  }

  /** Energía por frecuencia (0-255) de graves a agudos. */
  frecuencias() {
    this.analizador.getByteFrequencyData(this._frecuencias);
    return this._frecuencias;
  }

  /** Forma de onda en el dominio del tiempo (128 = silencio). */
  onda() {
    this.analizador.getByteTimeDomainData(this._onda);
    return this._onda;
  }

  /** Nivel RMS entre 0 y 1 (para medidores de volumen). */
  nivel() {
    const datos = this.onda();
    let suma = 0;
    for (const v of datos) suma += ((v - 128) / 128) ** 2;
    return Math.sqrt(suma / datos.length);
  }
}

/**
 * Analizador ligero para un MediaStream (micrófono en la grabadora).
 * No se conecta a los altavoces para no provocar acoples.
 */
export class AnalizadorStream {
  constructor(stream) {
    const ctx = obtenerContexto();
    this.ctx = ctx;
    this.fuente = ctx.createMediaStreamSource(stream);
    this.analizador = ctx.createAnalyser();
    this.analizador.fftSize = 1024;
    this.fuente.connect(this.analizador);
    this._frecuencias = new Uint8Array(this.analizador.frequencyBinCount);
    this._onda = new Uint8Array(this.analizador.fftSize);
  }
  frecuencias() {
    this.analizador.getByteFrequencyData(this._frecuencias);
    return this._frecuencias;
  }
  onda() {
    this.analizador.getByteTimeDomainData(this._onda);
    return this._onda;
  }
  nivel() {
    const datos = this.onda();
    let suma = 0;
    for (const v of datos) suma += ((v - 128) / 128) ** 2;
    return Math.sqrt(suma / datos.length);
  }
  desconectar() {
    this.fuente.disconnect();
  }
}
