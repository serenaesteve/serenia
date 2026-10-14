/**
 * Kroma · procesado de vídeo
 *
 * Cada fotograma se dibuja en un <canvas>, se leen sus píxeles con
 * getImageData (un array RGBA de 0 a 255) y se modifican con JavaScript.
 *
 *  1. Ajustes de color por píxel: brillo, contraste, saturación, temperatura.
 *     Se precalculan en tablas (LUT) de 256 valores para no repetir cuentas.
 *  2. Un filtro: de color (gris, sepia…), de convolución (bordes, relieve…)
 *     o espacial (pixelado, glitch).
 *  3. Viñeta y modo comparar (mitad original / mitad procesada).
 */

import { limitar } from "../nucleo/utilidades.js";

export const AJUSTES_INICIALES = Object.freeze({
  brillo: 0, //        -100 … 100
  contraste: 0, //     -100 … 100
  saturacion: 100, //     0 … 200 (%)
  temperatura: 0, //   -100 … 100 (frío ↔ cálido)
  vineta: 0, //           0 … 100
  filtro: "ninguno",
  intensidad: 100, //     0 … 100 (%)
  comparar: false,
});

/** Filtros disponibles: nombre visible + muestra de color para el botón. */
export const FILTROS = {
  ninguno: { nombre: "Original", muestra: "linear-gradient(135deg,#ff5e7e,#ffc857,#2de1c2)" },
  gris: { nombre: "Gris", muestra: "linear-gradient(135deg,#222,#ddd)" },
  sepia: { nombre: "Sepia", muestra: "linear-gradient(135deg,#704214,#e8c99b)" },
  negativo: { nombre: "Negativo", muestra: "linear-gradient(135deg,#00a181,#e4e1fd)" },
  umbral: { nombre: "Cómic", muestra: "linear-gradient(135deg,#000 50%,#fff 50%)" },
  posterizar: { nombre: "Póster", muestra: "linear-gradient(135deg,#e63946 33%,#f1c453 33% 66%,#1d3557 66%)" },
  duotono: { nombre: "Duotono", muestra: "linear-gradient(135deg,#3a0ca3,#ff5e7e)" },
  termico: { nombre: "Térmico", muestra: "linear-gradient(135deg,#0b0b3b,#d00000,#ffba08,#fff)" },
  bordes: { nombre: "Neón", muestra: "linear-gradient(135deg,#000 40%,#2de1c2 60%,#000 70%)" },
  relieve: { nombre: "Relieve", muestra: "linear-gradient(135deg,#555,#bbb,#777)" },
  enfocar: { nombre: "Enfocar", muestra: "linear-gradient(135deg,#1b1f3b,#9ad1d4)" },
  desenfocar: { nombre: "Desenfoque", muestra: "radial-gradient(#ffc857,#ff5e7e 70%)" },
  pixelar: { nombre: "Píxel", muestra: "conic-gradient(#2de1c2 25%,#ff5e7e 0 50%,#ffc857 0 75%,#1b1f3b 0)" },
  glitch: { nombre: "Glitch", muestra: "linear-gradient(90deg,#f0f 0 30%,#0ff 30% 60%,#ff0 60%)" },
};

// Núcleos de convolución 3×3
const NUCLEOS = {
  relieve: [-2, -1, 0, -1, 1, 1, 0, 1, 2],
  enfocar: [0, -1, 0, -1, 5, -1, 0, -1, 0],
  desenfocar: [1, 2, 1, 2, 4, 2, 1, 2, 1].map((v) => v / 16),
};

// Paleta "térmica" de 256 colores (negro → azul → rojo → amarillo → blanco)
const PALETA_TERMICA = (() => {
  const paradas = [
    [0, [11, 11, 59]],
    [0.3, [92, 24, 160]],
    [0.55, [208, 0, 0]],
    [0.8, [255, 186, 8]],
    [1, [255, 255, 255]],
  ];
  const paleta = new Uint8ClampedArray(256 * 3);
  for (let i = 0; i < 256; i++) {
    const t = i / 255;
    let k = 0;
    while (k < paradas.length - 2 && t > paradas[k + 1][0]) k++;
    const [t0, c0] = paradas[k];
    const [t1, c1] = paradas[k + 1];
    const f = (t - t0) / (t1 - t0);
    for (let c = 0; c < 3; c++) paleta[i * 3 + c] = c0[c] + (c1[c] - c0[c]) * f;
  }
  return paleta;
})();

/**
 * Procesa los fotogramas de un vídeo sobre un canvas.
 */
export class ProcesadorVideo {
  /**
   * @param {HTMLVideoElement} video
   * @param {HTMLCanvasElement} lienzo
   * @param {object} [o]
   * @param {number} [o.anchoMaximo] se procesa a esta resolución como mucho (rendimiento)
   */
  constructor(video, lienzo, { anchoMaximo = 960 } = {}) {
    this.video = video;
    this.lienzo = lienzo;
    this.ctx = lienzo.getContext("2d", { willReadFrequently: true });
    this.anchoMaximo = anchoMaximo;
    this.ajustes = { ...AJUSTES_INICIALES };
    this.fps = 0;
    this.msPorFotograma = 0;
    this._marcas = [];
    this._mascaraVineta = null;
    this._lut = null;
    this._recalcularLUT();
  }

  /** ¿Hay que procesar algo o el vídeo se ve tal cual? */
  get activo() {
    const a = this.ajustes;
    return (
      a.filtro !== "ninguno" ||
      a.brillo !== 0 ||
      a.contraste !== 0 ||
      a.saturacion !== 100 ||
      a.temperatura !== 0 ||
      a.vineta !== 0
    );
  }

  /** Cambia uno o varios ajustes. */
  configurar(cambios) {
    Object.assign(this.ajustes, cambios);
    if ("brillo" in cambios || "contraste" in cambios || "temperatura" in cambios) this._recalcularLUT();
    if ("vineta" in cambios) this._mascaraVineta = null;
  }

  restablecer() {
    this.configurar({ ...AJUSTES_INICIALES });
  }

  /**
   * Dibuja y procesa el fotograma actual.
   * Lanza SecurityError si el vídeo viene de otro origen sin CORS
   * (el canvas queda "contaminado" y no deja leer los píxeles).
   */
  procesar() {
    const { video, lienzo, ctx } = this;
    if (!video.videoWidth) return;
    const inicio = performance.now();

    // Resolución de trabajo: limitamos el ancho para mantener buenos FPS
    const escala = Math.min(1, this.anchoMaximo / video.videoWidth);
    const ancho = Math.round(video.videoWidth * escala);
    const alto = Math.round(video.videoHeight * escala);
    if (lienzo.width !== ancho || lienzo.height !== alto) {
      lienzo.width = ancho;
      lienzo.height = alto;
      this._mascaraVineta = null;
    }

    ctx.drawImage(video, 0, 0, ancho, alto);
    const imagen = ctx.getImageData(0, 0, ancho, alto);
    const original = this.ajustes.comparar ? new Uint8ClampedArray(imagen.data) : null;

    this._ajustarColor(imagen.data);
    this._aplicarFiltro(imagen);
    if (this.ajustes.vineta > 0) this._aplicarVineta(imagen);
    if (original) this._mitadOriginal(imagen, original);

    ctx.putImageData(imagen, 0, 0);
    if (original) {
      // Línea divisoria del modo comparar
      ctx.fillStyle = "rgba(255,255,255,.85)";
      ctx.fillRect(Math.floor(ancho / 2) - 1, 0, 2, alto);
    }
    this._medir(inicio);
  }

  // ── 1. Color ──────────────────────────────────────────────────────

  /** Tablas de 256 entradas con brillo + contraste + temperatura ya aplicados. */
  _recalcularLUT() {
    const { brillo, contraste, temperatura } = this.ajustes;
    const c = contraste * 2.55;
    const factor = (259 * (c + 255)) / (255 * (259 - c));
    const lut = { r: new Uint8ClampedArray(256), g: new Uint8ClampedArray(256), b: new Uint8ClampedArray(256) };
    for (let v = 0; v < 256; v++) {
      const base = factor * (v + brillo * 1.28 - 128) + 128;
      lut.r[v] = base + temperatura * 0.4;
      lut.g[v] = base + temperatura * 0.08;
      lut.b[v] = base - temperatura * 0.4;
    }
    this._lut = lut;
  }

  _ajustarColor(d) {
    const { saturacion } = this.ajustes;
    const tocarLUT = this.ajustes.brillo !== 0 || this.ajustes.contraste !== 0 || this.ajustes.temperatura !== 0;
    const s = saturacion / 100;
    if (!tocarLUT && s === 1) return;
    const { r: R, g: G, b: B } = this._lut;
    for (let i = 0; i < d.length; i += 4) {
      let r = R[d[i]];
      let g = G[d[i + 1]];
      let b = B[d[i + 2]];
      if (s !== 1) {
        // Luminancia perceptual (pesos ITU-R BT.601)
        const l = 0.299 * r + 0.587 * g + 0.114 * b;
        r = l + (r - l) * s;
        g = l + (g - l) * s;
        b = l + (b - l) * s;
      }
      d[i] = r; // Uint8ClampedArray ya recorta a 0…255
      d[i + 1] = g;
      d[i + 2] = b;
    }
  }

  // ── 2. Filtros ────────────────────────────────────────────────────

  _aplicarFiltro(imagen) {
    const { filtro, intensidad } = this.ajustes;
    if (filtro === "ninguno" || intensidad === 0) return;
    const k = intensidad / 100;
    const d = imagen.data;

    // Copia para mezclar con el resultado según la intensidad
    const antes = k < 1 ? new Uint8ClampedArray(d) : null;

    switch (filtro) {
      case "gris":
      case "sepia":
      case "negativo":
      case "umbral":
      case "posterizar":
      case "duotono":
      case "termico":
        this._filtroPuntual(d, filtro);
        break;
      case "bordes":
        this._bordesNeon(imagen);
        break;
      case "relieve":
      case "enfocar":
      case "desenfocar":
        convolucionar(imagen, NUCLEOS[filtro], filtro === "relieve" ? 128 : 0);
        break;
      case "pixelar":
        this._pixelar(imagen, Math.round(4 + k * 16));
        break;
      case "glitch":
        this._glitch(imagen, Math.round(4 + k * 18));
        break;
    }

    if (antes && filtro !== "pixelar" && filtro !== "glitch") {
      for (let i = 0; i < d.length; i += 4) {
        d[i] = antes[i] + (d[i] - antes[i]) * k;
        d[i + 1] = antes[i + 1] + (d[i + 1] - antes[i + 1]) * k;
        d[i + 2] = antes[i + 2] + (d[i + 2] - antes[i + 2]) * k;
      }
    }
  }

  /** Filtros que solo dependen del propio píxel. */
  _filtroPuntual(d, filtro) {
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i];
      const g = d[i + 1];
      const b = d[i + 2];
      const l = 0.299 * r + 0.587 * g + 0.114 * b;
      switch (filtro) {
        case "gris":
          d[i] = d[i + 1] = d[i + 2] = l;
          break;
        case "sepia":
          d[i] = 0.393 * r + 0.769 * g + 0.189 * b;
          d[i + 1] = 0.349 * r + 0.686 * g + 0.168 * b;
          d[i + 2] = 0.272 * r + 0.534 * g + 0.131 * b;
          break;
        case "negativo":
          d[i] = 255 - r;
          d[i + 1] = 255 - g;
          d[i + 2] = 255 - b;
          break;
        case "umbral":
          d[i] = d[i + 1] = d[i + 2] = l > 128 ? 255 : 0;
          break;
        case "posterizar": {
          // 4 niveles por canal
          const paso = 255 / 3;
          d[i] = Math.round(r / paso) * paso;
          d[i + 1] = Math.round(g / paso) * paso;
          d[i + 2] = Math.round(b / paso) * paso;
          break;
        }
        case "duotono": {
          // Sombras violeta (#3a0ca3) → luces coral (#ff5e7e)
          const t = l / 255;
          d[i] = 58 + (255 - 58) * t;
          d[i + 1] = 12 + (94 - 12) * t;
          d[i + 2] = 163 + (126 - 163) * t;
          break;
        }
        case "termico": {
          const p = Math.round(l) * 3;
          d[i] = PALETA_TERMICA[p];
          d[i + 1] = PALETA_TERMICA[p + 1];
          d[i + 2] = PALETA_TERMICA[p + 2];
          break;
        }
      }
    }
  }

  /** Detector de bordes de Sobel coloreado según la dirección del borde. */
  _bordesNeon(imagen) {
    const { width: w, height: h, data: d } = imagen;
    const gris = new Float32Array(w * h);
    for (let p = 0, i = 0; p < gris.length; p++, i += 4) gris[p] = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        if (x === 0 || y === 0 || x === w - 1 || y === h - 1) {
          d[i] = d[i + 1] = d[i + 2] = 0;
          continue;
        }
        const p = y * w + x;
        const gx =
          -gris[p - w - 1] - 2 * gris[p - 1] - gris[p + w - 1] + gris[p - w + 1] + 2 * gris[p + 1] + gris[p + w + 1];
        const gy =
          -gris[p - w - 1] - 2 * gris[p - w] - gris[p - w + 1] + gris[p + w - 1] + 2 * gris[p + w] + gris[p + w + 1];
        const fuerza = Math.min(255, Math.hypot(gx, gy));
        // Ángulo del borde → mezcla entre turquesa y coral
        const t = (Math.atan2(gy, gx) + Math.PI) / (2 * Math.PI);
        d[i] = fuerza * (0.18 + 0.82 * t);
        d[i + 1] = fuerza * (0.88 - 0.5 * t);
        d[i + 2] = fuerza * (0.76 - 0.3 * t);
      }
    }
  }

  _pixelar(imagen, bloque) {
    const { width: w, height: h, data: d } = imagen;
    for (let y = 0; y < h; y += bloque) {
      for (let x = 0; x < w; x += bloque) {
        // Color del centro del bloque
        const cx = Math.min(w - 1, x + (bloque >> 1));
        const cy = Math.min(h - 1, y + (bloque >> 1));
        const c = (cy * w + cx) * 4;
        const r = d[c];
        const g = d[c + 1];
        const b = d[c + 2];
        for (let yy = y; yy < Math.min(y + bloque, h); yy++) {
          for (let xx = x; xx < Math.min(x + bloque, w); xx++) {
            const i = (yy * w + xx) * 4;
            d[i] = r;
            d[i + 1] = g;
            d[i + 2] = b;
          }
        }
      }
    }
  }

  /** Separa los canales rojo y azul y añade franjas desplazadas. */
  _glitch(imagen, desplazamiento) {
    const { width: w, height: h, data: d } = imagen;
    const copia = new Uint8ClampedArray(d);
    const tiempo = Math.floor(performance.now() / 120);
    for (let y = 0; y < h; y++) {
      // Franjas que se mueven "aleatoriamente" pero de forma determinista
      const franja = Math.sin(y * 0.05 + tiempo) > 0.96 ? desplazamiento * 2 : 0;
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        const xr = limitar(x + desplazamiento + franja, 0, w - 1);
        const xb = limitar(x - desplazamiento + franja, 0, w - 1);
        d[i] = copia[(y * w + xr) * 4];
        d[i + 2] = copia[(y * w + xb) * 4 + 2];
      }
    }
  }

  // ── 3. Viñeta y comparar ──────────────────────────────────────────

  _aplicarVineta(imagen) {
    const { width: w, height: h, data: d } = imagen;
    if (!this._mascaraVineta || this._mascaraVineta.length !== w * h) {
      const mascara = new Float32Array(w * h);
      const fuerza = this.ajustes.vineta / 100;
      const cx = w / 2;
      const cy = h / 2;
      const maximo = Math.hypot(cx, cy);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const dist = Math.hypot(x - cx, y - cy) / maximo;
          mascara[y * w + x] = 1 - fuerza * Math.pow(dist, 2.2);
        }
      }
      this._mascaraVineta = mascara;
    }
    const m = this._mascaraVineta;
    for (let p = 0, i = 0; p < m.length; p++, i += 4) {
      d[i] *= m[p];
      d[i + 1] *= m[p];
      d[i + 2] *= m[p];
    }
  }

  _mitadOriginal(imagen, original) {
    const { width: w, height: h, data: d } = imagen;
    const mitad = Math.floor(w / 2);
    for (let y = 0; y < h; y++) {
      const inicio = y * w * 4;
      d.set(original.subarray(inicio, inicio + mitad * 4), inicio);
    }
  }

  _medir(inicio) {
    const ahora = performance.now();
    this.msPorFotograma = ahora - inicio;
    this._marcas.push(ahora);
    while (this._marcas.length && ahora - this._marcas[0] > 1000) this._marcas.shift();
    this.fps = this._marcas.length;
  }
}

/**
 * Convolución 3×3 genérica sobre un ImageData.
 * Cada píxel nuevo es la suma ponderada de sus 9 vecinos.
 */
export function convolucionar(imagen, nucleo, desfase = 0) {
  const { width: w, height: h, data: d } = imagen;
  const origen = new Uint8ClampedArray(d);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (let ky = -1; ky <= 1; ky++) {
        for (let kx = -1; kx <= 1; kx++) {
          const peso = nucleo[(ky + 1) * 3 + (kx + 1)];
          const i = ((y + ky) * w + (x + kx)) * 4;
          r += origen[i] * peso;
          g += origen[i + 1] * peso;
          b += origen[i + 2] * peso;
        }
      }
      const i = (y * w + x) * 4;
      d[i] = r + desfase;
      d[i + 1] = g + desfase;
      d[i + 2] = b + desfase;
    }
  }
}
