/**
 * Serenia · ayudantes de interfaz
 */

import { crear, icono, formatearTiempo } from "../../kroma/nucleo/utilidades.js";
import { biblioteca } from "../datos/biblioteca.js";

export { crear, icono, formatearTiempo };

/** Imagen de portada con un degradado generado si no hay carátula. */
export function portada(pista, { clase = "", redonda = false } = {}) {
  const url = biblioteca.urlPortada(pista);
  const caja = crear("div", { clase: `portada ${redonda ? "portada--redonda" : ""} ${clase}`.trim() });
  if (url) {
    caja.append(crear("img", { atributos: { src: url, alt: "", loading: "lazy", decoding: "async" } }));
  } else {
    const texto = `${pista?.album ?? ""}${pista?.titulo ?? ""}`;
    let h = 0;
    for (const c of texto) h = (h * 31 + c.codePointAt(0)) % 360;
    caja.style.background = `linear-gradient(135deg, hsl(${h} 70% 55%), hsl(${(h + 60) % 360} 70% 35%))`;
    caja.append(icono(pista?.tipo === "video" ? "video" : "nota"));
  }
  return caja;
}

/** Mosaico de 4 carátulas para las listas de reproducción. */
export function mosaico(pistas, clase = "") {
  const conPortada = [...new Map(pistas.filter((p) => biblioteca.urlPortada(p)).map((p) => [biblioteca.urlPortada(p), p])).values()];
  if (conPortada.length < 4) return portada(conPortada[0] ?? pistas[0] ?? null, { clase });
  return crear("div", { clase: `portada mosaico ${clase}` }, conPortada.slice(0, 4).map((p) => crear("img", { atributos: { src: biblioteca.urlPortada(p), alt: "" } })));
}

/** "3 canciones", "1 canción" */
export const plural = (n, singular, pluralTexto = `${singular}s`) => `${n} ${n === 1 ? singular : pluralTexto}`;

/** 4380 s → "1 h 13 min" */
export function duracionLarga(segundos) {
  if (segundos < 60) return `${Math.round(segundos)} s`;
  const m = Math.round(segundos / 60);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}

/** Enlace interno que navega con el router por hash. */
export function enlace(texto, ruta, clase = "enlace") {
  return crear("a", { clase, texto, atributos: { href: ruta }, eventos: { click: (e) => e.stopPropagation() } });
}

/** Botón redondo con icono. */
export function botonIcono(nombre, titulo, accion, clase = "") {
  return crear("button", { clase: `boton-icono ${clase}`.trim(), icono: nombre, titulo, eventos: { click: accion } });
}

/** Saludo según la hora del día. */
export function saludo() {
  const h = new Date().getHours();
  return h < 6 ? "Buenas noches" : h < 13 ? "Buenos días" : h < 21 ? "Buenas tardes" : "Buenas noches";
}

/** Estado vacío con icono, texto y acción opcional. */
export function vacio(nombreIcono, titulo, texto, accion) {
  return crear("div", { clase: "vacio" }, [
    crear("div", { clase: "vacio-icono" }, [icono(nombreIcono)]),
    crear("h3", { texto: titulo }),
    crear("p", { texto }),
    accion ? crear("button", { clase: "boton boton--principal", texto: accion.texto, eventos: { click: accion.fn } }) : "",
  ]);
}
