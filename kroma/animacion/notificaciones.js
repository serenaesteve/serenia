/**
 * Kroma · notificaciones ("tostadas")
 *
 * Avisos que entran deslizándose, muestran una barra de tiempo restante,
 * se pausan al pasar el ratón y salen con una animación CSS.
 * Las animaciones están en kroma.css (@keyframes kr-tostada-entra / sale).
 */

import { crear, icono } from "../nucleo/utilidades.js";

const ICONOS = { exito: "exito", info: "info", aviso: "aviso", error: "error" };
const MAXIMO_VISIBLES = 4;

let pila = null;

function obtenerPila() {
  if (!pila || !pila.isConnected) {
    pila = crear("div", { clase: "kr-tostadas", atributos: { role: "status", "aria-live": "polite" } });
    document.body.append(pila);
  }
  return pila;
}

/**
 * Muestra una notificación.
 * @param {string} mensaje
 * @param {object} [o]
 * @param {"exito"|"info"|"aviso"|"error"} [o.tipo]
 * @param {string} [o.titulo]
 * @param {number} [o.duracion] milisegundos (0 = no se cierra sola)
 * @param {{texto: string, fn: () => void}} [o.accion] botón opcional (p. ej. "Deshacer")
 * @returns {{ cerrar: () => void, actualizar: (texto: string) => void }}
 */
export function notificar(mensaje, { tipo = "info", titulo, duracion = 4500, accion } = {}) {
  const contenedor = obtenerPila();

  const barra = crear("div", { clase: "kr-tostada-tiempo" });
  const parrafo = crear("p", { texto: mensaje });
  const cerrarBtn = crear("button", { clase: "kr-tostada-cerrar", icono: "cerrar", titulo: "Cerrar" });
  const tostada = crear("div", { clase: `kr-tostada kr-tostada--${tipo}` }, [
    crear("div", { clase: "kr-tostada-icono" }, [icono(ICONOS[tipo] ?? "info")]),
    crear("div", { clase: "kr-tostada-cuerpo" }, [
      titulo ? crear("strong", { texto: titulo }) : "",
      parrafo,
      accion ? crear("button", { clase: "kr-tostada-accion", texto: accion.texto, eventos: { click: () => (accion.fn(), cerrar()) } }) : "",
    ]),
    cerrarBtn,
    barra,
  ]);

  // Si hay demasiadas, la más antigua se va
  while (contenedor.children.length >= MAXIMO_VISIBLES) contenedor.firstElementChild.remove();
  contenedor.append(tostada);

  let cerrada = false;
  const cerrar = () => {
    if (cerrada) return;
    cerrada = true;
    tostada.classList.add("kr-saliendo");
    // Al acabar la animación de salida eliminamos el nodo
    tostada.addEventListener("animationend", () => tostada.remove(), { once: true });
    setTimeout(() => tostada.remove(), 800); // por si prefers-reduced-motion anula la animación
  };
  cerrarBtn.addEventListener("click", cerrar);

  if (duracion > 0) {
    // La barra se anima en CSS; cuando termina, se cierra la tostada.
    // Al pasar el ratón la animación se pausa (animation-play-state) y el cierre también.
    barra.style.animationDuration = `${duracion}ms`;
    barra.addEventListener("animationend", cerrar);
  } else {
    barra.remove();
  }
  return { cerrar, actualizar: (texto) => (parrafo.textContent = texto) };
}
