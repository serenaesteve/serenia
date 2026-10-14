/**
 * Kroma · registro de depuración
 *
 * Todos los módulos escriben aquí en vez de usar console.log directamente.
 * Así se puede activar/desactivar la depuración de golpe (Kroma.depuracion = true)
 * y el monitor de eventos puede mostrar el historial en la propia página.
 */

const COLORES = { info: "#2de1c2", aviso: "#ffc857", error: "#ff5e7e" };
const MAX_HISTORIAL = 500;

const oyentes = new Set();

export const registro = {
  /** Si es false solo se muestran avisos y errores en la consola. */
  activo: false,

  /** Últimas entradas, incluso con la depuración apagada. */
  historial: [],

  info(origen, ...datos) {
    escribir("info", origen, datos);
  },
  aviso(origen, ...datos) {
    escribir("aviso", origen, datos);
  },
  error(origen, ...datos) {
    escribir("error", origen, datos);
  },

  /** Permite a otros componentes (monitor) recibir cada entrada. */
  suscribir(fn) {
    oyentes.add(fn);
    return () => oyentes.delete(fn);
  },

  /** Mide cuánto tarda una operación (útil para ver el coste de los filtros). */
  async medir(origen, etiqueta, fn) {
    const inicio = performance.now();
    try {
      return await fn();
    } finally {
      escribir("info", origen, [`${etiqueta}: ${(performance.now() - inicio).toFixed(1)} ms`]);
    }
  },
};

function escribir(nivel, origen, datos) {
  const entrada = { nivel, origen, datos, hora: new Date() };
  registro.historial.push(entrada);
  if (registro.historial.length > MAX_HISTORIAL) registro.historial.shift();

  if (registro.activo || nivel !== "info") {
    const metodo = nivel === "error" ? "error" : nivel === "aviso" ? "warn" : "log";
    console[metodo](`%c Kroma · ${origen} `, `background:${COLORES[nivel]};color:#111;border-radius:4px;font-weight:600`, ...datos);
  }
  for (const fn of oyentes) fn(entrada);
}
