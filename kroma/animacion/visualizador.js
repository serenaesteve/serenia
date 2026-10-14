/**
 * Kroma · visualizador de audio
 *
 * Bucle de animación con requestAnimationFrame que dibuja en un canvas
 * los datos del AnalyserNode. Tres modos:
 *   - "barras":   espectro simétrico con "tapas" que caen con gravedad
 *   - "circular": barras radiales que giran alrededor de un núcleo que late
 *   - "onda":     osciloscopio con estela
 * Si no hay sonido, dibuja una línea que "respira" para que nunca quede vacío.
 */

import { variableCSS } from "../nucleo/utilidades.js";

export const MODOS_VISUALIZADOR = {
  barras: "Barras",
  circular: "Círculo",
  onda: "Osciloscopio",
};

export class Visualizador {
  /**
   * @param {HTMLCanvasElement} lienzo
   * @param {() => ({frecuencias: () => Uint8Array, onda: () => Uint8Array} | null)} obtenerFuente
   *        función que devuelve la fuente de datos (o null si todavía no existe)
   * @param {object} [o]
   * @param {keyof MODOS_VISUALIZADOR} [o.modo]
   * @param {number} [o.barras] número de barras
   */
  constructor(lienzo, obtenerFuente, { modo = "barras", barras = 64 } = {}) {
    this.lienzo = lienzo;
    this.ctx = lienzo.getContext("2d");
    this.obtenerFuente = obtenerFuente;
    this.modo = modo;
    this.numBarras = barras;
    this.alturas = new Float32Array(barras); // valores suavizados
    this.tapas = new Float32Array(barras); //   "tapas" que caen
    this.velTapas = new Float32Array(barras);
    this.angulo = 0;
    this.activo = false;
    this._frame = 0;
    this._colores = null;

    // Ajustamos la resolución interna al tamaño real y a la densidad de píxeles
    this._observador = new ResizeObserver(() => this._redimensionar());
    this._observador.observe(lienzo);
    this._redimensionar();
  }

  iniciar() {
    if (this.activo) return;
    this.activo = true;
    const paso = (t) => {
      if (!this.activo) return;
      this._dibujar(t);
      this._frame = requestAnimationFrame(paso);
    };
    this._frame = requestAnimationFrame(paso);
  }

  detener() {
    this.activo = false;
    cancelAnimationFrame(this._frame);
  }

  destruir() {
    this.detener();
    this._observador.disconnect();
  }

  /** Vuelve a leer los colores del tema (por si cambian las variables CSS). */
  refrescarColores() {
    this._colores = null;
  }

  _redimensionar() {
    const dpr = window.devicePixelRatio || 1;
    const { width, height } = this.lienzo.getBoundingClientRect();
    if (!width || !height) return;
    this.lienzo.width = Math.round(width * dpr);
    this.lienzo.height = Math.round(height * dpr);
    this._gradiente = null;
  }

  _leerColores() {
    const el = this.lienzo;
    this._colores = [
      variableCSS(el, "--kr-acento-1", "#ff5e7e"),
      variableCSS(el, "--kr-acento-2", "#ffc857"),
      variableCSS(el, "--kr-acento-3", "#2de1c2"),
    ];
    this._gradiente = null;
  }

  _dibujar(t) {
    if (!this._colores) this._leerColores();
    const { ctx, lienzo } = this;
    const fuente = this.obtenerFuente();
    const frecuencias = fuente?.frecuencias();
    const hayAudio = frecuencias && frecuencias.some((v) => v > 0);

    // Estela: en vez de borrar del todo, pintamos encima con transparencia
    ctx.globalCompositeOperation = "destination-out";
    ctx.fillStyle = `rgba(0,0,0,${this.modo === "onda" ? 0.35 : 0.6})`;
    ctx.fillRect(0, 0, lienzo.width, lienzo.height);
    ctx.globalCompositeOperation = "source-over";

    if (!hayAudio) {
      this._reposo(t);
      return;
    }
    if (this.modo === "onda") this._onda(fuente.onda());
    else {
      this._actualizarAlturas(frecuencias);
      if (this.modo === "circular") this._circular();
      else this._barras();
    }
  }

  /** Agrupa las frecuencias en bandas logarítmicas (como las oye el oído). */
  _actualizarAlturas(frecuencias) {
    const n = this.numBarras;
    // Las frecuencias muy altas casi no tienen energía: usamos el 70 % inferior
    const util = Math.floor(frecuencias.length * 0.7);
    for (let i = 0; i < n; i++) {
      const desde = Math.floor(Math.pow(util, i / n));
      const hasta = Math.max(desde + 1, Math.floor(Math.pow(util, (i + 1) / n)));
      let suma = 0;
      for (let j = desde; j < hasta; j++) suma += frecuencias[j];
      const valor = suma / (hasta - desde) / 255;
      // Sube rápido, baja despacio: más agradable a la vista
      this.alturas[i] = valor > this.alturas[i] ? valor : this.alturas[i] * 0.86 + valor * 0.14;
      if (this.alturas[i] >= this.tapas[i]) {
        this.tapas[i] = this.alturas[i];
        this.velTapas[i] = 0;
      } else {
        this.velTapas[i] += 0.0018; // gravedad
        this.tapas[i] = Math.max(0, this.tapas[i] - this.velTapas[i]);
      }
    }
  }

  _degradado(x0, y0, x1, y1) {
    const g = this.ctx.createLinearGradient(x0, y0, x1, y1);
    const [a, b, c] = this._colores;
    g.addColorStop(0, a);
    g.addColorStop(0.5, b);
    g.addColorStop(1, c);
    return g;
  }

  _barras() {
    const { ctx, lienzo } = this;
    const w = lienzo.width;
    const h = lienzo.height;
    const medio = h / 2;
    const n = this.numBarras;
    const hueco = Math.max(1, w / n / 4);
    const ancho = w / n - hueco;
    this._gradiente ??= this._degradado(0, 0, w, 0);
    ctx.fillStyle = this._gradiente;
    for (let i = 0; i < n; i++) {
      const x = i * (ancho + hueco) + hueco / 2;
      const alto = Math.max(2, this.alturas[i] * medio * 0.92);
      ctx.globalAlpha = 1;
      ctx.beginPath();
      ctx.roundRect(x, medio - alto, ancho, alto * 2, ancho / 2);
      ctx.fill();
      // Tapas arriba y abajo
      const tapa = this.tapas[i] * medio * 0.92;
      ctx.globalAlpha = 0.75;
      ctx.fillRect(x, medio - tapa - 4, ancho, 2);
      ctx.fillRect(x, medio + tapa + 2, ancho, 2);
    }
    ctx.globalAlpha = 1;
  }

  _circular() {
    const { ctx, lienzo } = this;
    const w = lienzo.width;
    const h = lienzo.height;
    const cx = w / 2;
    const cy = h / 2;
    const n = this.numBarras;
    const graves = (this.alturas[0] + this.alturas[1] + this.alturas[2]) / 3;
    const radio = Math.min(w, h) * (0.18 + graves * 0.05);
    const largo = Math.min(w, h) * 0.23;
    this.angulo += 0.003 + graves * 0.01;

    // Núcleo que late con los graves
    const brillo = ctx.createRadialGradient(cx, cy, 0, cx, cy, radio);
    brillo.addColorStop(0, this._colores[1] + "aa");
    brillo.addColorStop(1, this._colores[0] + "00");
    ctx.fillStyle = brillo;
    ctx.beginPath();
    ctx.arc(cx, cy, radio, 0, Math.PI * 2);
    ctx.fill();

    ctx.lineCap = "round";
    ctx.lineWidth = Math.max(2, ((Math.PI * 2 * radio) / (n * 2)) * 0.6);
    for (let i = 0; i < n * 2; i++) {
      // Duplicamos en espejo para que el círculo sea simétrico
      const indice = i < n ? i : n * 2 - 1 - i;
      const a = (i / (n * 2)) * Math.PI * 2 + this.angulo;
      const l = 4 + this.alturas[indice] * largo;
      ctx.strokeStyle = this._colores[i % 3];
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * radio, cy + Math.sin(a) * radio);
      ctx.lineTo(cx + Math.cos(a) * (radio + l), cy + Math.sin(a) * (radio + l));
      ctx.stroke();
    }
  }

  _onda(datos) {
    const { ctx, lienzo } = this;
    const w = lienzo.width;
    const h = lienzo.height;
    this._gradiente ??= this._degradado(0, 0, w, 0);
    ctx.lineWidth = Math.max(2, h / 60);
    ctx.strokeStyle = this._gradiente;
    ctx.shadowColor = this._colores[2];
    ctx.shadowBlur = 12;
    ctx.beginPath();
    const paso = w / (datos.length - 1);
    for (let i = 0; i < datos.length; i++) {
      const y = (datos[i] / 255) * h;
      if (i === 0) ctx.moveTo(0, y);
      else ctx.lineTo(i * paso, y);
    }
    ctx.stroke();
    ctx.shadowBlur = 0;
  }

  /** Animación de reposo: una onda suave que respira. */
  _reposo(t) {
    const { ctx, lienzo } = this;
    const w = lienzo.width;
    const h = lienzo.height;
    this._gradiente ??= this._degradado(0, 0, w, 0);
    ctx.lineWidth = Math.max(1.5, h / 90);
    ctx.strokeStyle = this._gradiente;
    ctx.globalAlpha = 0.55;
    ctx.beginPath();
    const amplitud = h * 0.06 * (0.6 + 0.4 * Math.sin(t / 900));
    for (let x = 0; x <= w; x += 4) {
      const y = h / 2 + Math.sin(x / (w / 6) + t / 600) * amplitud * Math.sin((x / w) * Math.PI);
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
    // Las barras vuelven a cero poco a poco
    this.alturas.fill(0);
    this.tapas.fill(0);
  }
}
