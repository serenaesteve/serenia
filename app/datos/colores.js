/**
 * Serenia · color dominante de una imagen
 *
 * Reduce la carátula a 48×48, agrupa los píxeles en "cubos" de color
 * (4 bits por canal) y elige el más representativo dando más peso a los
 * colores saturados. Con él se tiñe la interfaz mientras suena esa canción.
 */

const aHex = (r, g, b) => "#" + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");

function hsl(r, g, b) {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  const s = d === 0 ? 0 : l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (d) h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: (h * 60 + 360) % 360, s, l };
}

function rgbDesdeHsl(h, s, l) {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}

/** Luminancia relativa (WCAG) para decidir si el texto encima va claro u oscuro. */
function luminancia(r, g, b) {
  const c = [r, g, b].map((v) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

/**
 * @param {Blob} imagen
 * @returns {Promise<{principal: string, oscuro: string, claro: boolean} | null>}
 */
export async function extraerColores(imagen) {
  if (!imagen) return null;
  let bitmap;
  try {
    bitmap = await createImageBitmap(imagen, { resizeWidth: 48, resizeHeight: 48, resizeQuality: "low" });
  } catch {
    return null;
  }
  const lienzo = document.createElement("canvas");
  lienzo.width = lienzo.height = 48;
  const ctx = lienzo.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  const d = ctx.getImageData(0, 0, 48, 48).data;

  const cubos = new Map();
  for (let i = 0; i < d.length; i += 4) {
    const clave = ((d[i] >> 4) << 8) | ((d[i + 1] >> 4) << 4) | (d[i + 2] >> 4);
    const c = cubos.get(clave) ?? { n: 0, r: 0, g: 0, b: 0 };
    c.n++;
    c.r += d[i];
    c.g += d[i + 1];
    c.b += d[i + 2];
    cubos.set(clave, c);
  }

  let mejor = null;
  let mejorPuntos = -1;
  let media = { r: 0, g: 0, b: 0, n: 0 };
  for (const c of cubos.values()) {
    const r = c.r / c.n;
    const g = c.g / c.n;
    const b = c.b / c.n;
    media.r += c.r;
    media.g += c.g;
    media.b += c.b;
    media.n += c.n;
    const { s, l } = hsl(r, g, b);
    // Preferimos colores vivos y ni muy oscuros ni muy claros
    const puntos = c.n * (0.15 + s * s) * (l > 0.12 && l < 0.88 ? 1 : 0.1);
    if (puntos > mejorPuntos) {
      mejorPuntos = puntos;
      mejor = { r, g, b };
    }
  }
  if (!mejor) return null;

  // Versión oscura para fondos: el color mezclado con casi negro
  const oscuro = aHex(mejor.r * 0.28 + 8, mejor.g * 0.28 + 9, mejor.b * 0.28 + 14);
  // El acento tiene que verse sobre fondo oscuro: limitamos la luminosidad a 55-72 %
  // y le damos algo de saturación (una carátula azul marino daría un botón invisible)
  const { h, s, l } = hsl(mejor.r, mejor.g, mejor.b);
  const [r, g, b] = rgbDesdeHsl(h, s < 0.1 ? s : Math.max(s, 0.55), Math.min(0.72, Math.max(0.58, l)));
  return {
    principal: aHex(r, g, b),
    oscuro,
    claro: luminancia(r, g, b) > 0.4,
    medio: aHex(media.r / media.n, media.g / media.n, media.b / media.n),
  };
}
