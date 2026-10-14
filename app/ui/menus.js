/**
 * Serenia · menús contextuales y diálogos
 */

import { crear, icono } from "./dom.js";

let menuAbierto = null;

/**
 * Abre un menú en la posición del ratón (o debajo de un elemento).
 * @param {MouseEvent|HTMLElement} origen
 * @param {Array<{icono?: string, texto: string, accion?: Function, submenu?: Array, peligro?: boolean} | "-">} opciones
 */
export function abrirMenu(origen, opciones) {
  cerrarMenu();
  const menu = crear("div", { clase: "menu", atributos: { role: "menu", tabindex: -1 } });
  const items = [];
  for (const o of opciones) {
    if (o === "-") {
      menu.append(crear("hr"));
      continue;
    }
    const boton = crear(
      "button",
      { clase: `menu-item${o.peligro ? " menu-item--peligro" : ""}`, atributos: { role: "menuitem" } },
      [o.icono ? icono(o.icono) : crear("span", { clase: "menu-hueco" }), crear("span", { texto: o.texto }), o.submenu ? icono("derecha") : ""],
    );
    boton.addEventListener("click", (e) => {
      e.stopPropagation();
      if (o.submenu) return abrirSubmenu(boton, o.submenu);
      cerrarMenu();
      o.accion?.();
    });
    if (o.submenu) boton.addEventListener("mouseenter", () => abrirSubmenu(boton, o.submenu));
    menu.append(boton);
    items.push(boton);
  }
  document.body.append(menu);
  posicionar(menu, origen);
  menuAbierto = menu;

  // Teclado: flechas para moverse, Escape para cerrar
  menu.addEventListener("keydown", (e) => {
    const i = items.indexOf(document.activeElement);
    if (e.key === "ArrowDown") items[(i + 1) % items.length]?.focus();
    else if (e.key === "ArrowUp") items[(i - 1 + items.length) % items.length]?.focus();
    else if (e.key === "Escape") cerrarMenu();
    else return;
    e.preventDefault();
  });
  requestAnimationFrame(() => items[0]?.focus({ preventScroll: true }));
  return menu;
}

function abrirSubmenu(boton, opciones) {
  menuAbierto?.querySelector(".submenu")?.remove();
  const sub = crear("div", { clase: "menu submenu", atributos: { role: "menu" } });
  for (const o of opciones) {
    if (o === "-") {
      sub.append(crear("hr"));
      continue;
    }
    sub.append(
      crear("button", { clase: "menu-item", eventos: { click: (e) => (e.stopPropagation(), cerrarMenu(), o.accion?.()) } }, [
        o.icono ? icono(o.icono) : crear("span", { clase: "menu-hueco" }),
        crear("span", { texto: o.texto }),
      ]),
    );
  }
  menuAbierto.append(sub);
  const r = boton.getBoundingClientRect();
  const rm = menuAbierto.getBoundingClientRect();
  sub.style.top = `${r.top - rm.top - 6}px`;
  // Hacia la derecha si cabe; si no, a la izquierda
  sub.style.left = rm.right + 200 < innerWidth ? `${rm.width - 4}px` : `${-sub.offsetWidth + 4}px`;
}

function posicionar(menu, origen) {
  let x;
  let y;
  if (origen instanceof Event && "clientX" in origen && origen.clientX) {
    x = origen.clientX;
    y = origen.clientY;
  } else {
    const el = origen instanceof Event ? origen.currentTarget : origen;
    const r = el.getBoundingClientRect();
    x = r.right - 4;
    y = r.bottom + 4;
  }
  const { width, height } = menu.getBoundingClientRect();
  menu.style.left = `${Math.max(8, Math.min(x, innerWidth - width - 8))}px`;
  menu.style.top = `${Math.max(8, y + height > innerHeight - 8 ? y - height : y)}px`;
}

export function cerrarMenu() {
  menuAbierto?.remove();
  menuAbierto = null;
}

document.addEventListener("pointerdown", (e) => {
  if (menuAbierto && !menuAbierto.contains(e.target)) cerrarMenu();
});
window.addEventListener("blur", cerrarMenu);
window.addEventListener("resize", cerrarMenu);
document.addEventListener("scroll", cerrarMenu, true);

// ── Diálogos ───────────────────────────────────────────────────────

/**
 * Diálogo modal con <dialog> (accesible: atrapa el foco y se cierra con Escape).
 * @returns {Promise<string|null>} el valor de la acción pulsada
 */
export function dialogo({ titulo, contenido, acciones = [{ texto: "Cerrar", valor: null }], clase = "" }) {
  return new Promise((resolver) => {
    const d = crear("dialog", { clase: `dialogo ${clase}`.trim() }, [
      crear("header", {}, [crear("h2", { texto: titulo }), crear("button", { clase: "boton-icono", icono: "cerrar", titulo: "Cerrar", eventos: { click: () => d.close() } })]),
      crear("div", { clase: "dialogo-cuerpo" }, [contenido]),
      crear(
        "footer",
        {},
        acciones.map((a) =>
          crear("button", {
            clase: `boton ${a.principal ? "boton--principal" : ""} ${a.peligro ? "boton--peligro" : ""}`,
            texto: a.texto,
            eventos: { click: () => ((d.returnValue = a.valor ?? ""), d.close()) },
          }),
        ),
      ),
    ]);
    d.addEventListener("close", () => {
      resolver(d.returnValue || null);
      d.remove();
    });
    // Clic fuera del cuadro = cerrar
    d.addEventListener("click", (e) => e.target === d && d.close());
    document.body.append(d);
    d.showModal();
  });
}

/** Pide un texto (nombre de lista…). Devuelve null si se cancela. */
export async function pedirTexto(titulo, valor = "", placeholder = "") {
  const input = crear("input", { clase: "campo", atributos: { type: "text", value: valor, placeholder, autofocus: "" } });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      input.closest("dialog").returnValue = "ok";
      input.closest("dialog").close();
    }
  });
  queueMicrotask(() => input.select());
  const r = await dialogo({ titulo, contenido: input, acciones: [{ texto: "Cancelar" }, { texto: "Aceptar", valor: "ok", principal: true }] });
  return r === "ok" && input.value.trim() ? input.value.trim() : null;
}

export async function confirmar(titulo, texto, textoBoton = "Eliminar") {
  const r = await dialogo({
    titulo,
    contenido: crear("p", { texto }),
    acciones: [{ texto: "Cancelar" }, { texto: textoBoton, valor: "si", peligro: true }],
  });
  return r === "si";
}
