/**
 * Serenia · contexto compartido
 *
 * Objetos que usan casi todas las vistas. Se rellenan al arrancar (main.js)
 * y así evitamos importaciones circulares entre módulos.
 */
export const app = {
  /** @type {import("./motor/Motor.js").Motor} */
  motor: null,
  /** @type {import("../kroma/reproductores/ReproductorVideo.js").ReproductorVideo} */
  video: null,
  /** Cambia de vista: app.navegar("#/album/…") */
  navegar: (ruta) => (location.hash = ruta),
  /** Abre/cierra el panel lateral derecho ("cola" | "letra" | null) */
  panel: null,
  /** Abre el selector de archivos para importar */
  importar: null,
};
