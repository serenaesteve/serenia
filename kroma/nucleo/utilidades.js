/**
 * Kroma · utilidades
 * Funciones pequeñas que usan todos los módulos: crear nodos del DOM,
 * formatear tiempos y tamaños, descargar archivos, iconos SVG…
 */

// ── Iconos ───────────────────────────────────────────────────────────
// Trazados SVG de 24×24. Se pintan con currentColor, así heredan el color
// del botón y se pueden tematizar desde CSS.
const TRAZADOS = {
  play: "M8 5.14v13.72a1 1 0 0 0 1.53.85l10.6-6.86a1 1 0 0 0 0-1.7L9.53 4.29A1 1 0 0 0 8 5.14z",
  pausa: "M7 5h3.5v14H7zM13.5 5H17v14h-3.5z",
  atras: "M11 18V6l-8.5 6 8.5 6zm.5-6 8.5 6V6l-8.5 6z",
  adelante: "M4 18l8.5-6L4 6v12zm9-12v12l8.5-6L13 6z",
  anterior: "M6 6h2v12H6zm3.5 6 8.5 6V6z",
  siguiente: "M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z",
  volumen: "M3 9v6h4l5 5V4L7 9H3zm13.5 3A4.5 4.5 0 0 0 14 7.97v8.05A4.5 4.5 0 0 0 16.5 12zM14 3.23v2.06a7 7 0 0 1 0 13.42v2.06a9 9 0 0 0 0-17.54z",
  silencio: "M16.5 12A4.5 4.5 0 0 0 14 7.97v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51A8.8 8.8 0 0 0 21 12a9 9 0 0 0-7-8.77v2.06A7 7 0 0 1 19 12zM4.27 3 3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25A7 7 0 0 1 14 18.7v2.06a9 9 0 0 0 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4 9.91 6.09 12 8.18V4z",
  subtitulos: "M19 4H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2zm-8 7H9.5v-.5h-2v3h2V13H11v1a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1v-4a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v1zm7 0h-1.5v-.5h-2v3h2V13H18v1a1 1 0 0 1-1 1h-3a1 1 0 0 1-1-1v-4a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v1z",
  efectos: "M3 17v2h6v-2H3zM3 5v2h10V5H3zm10 16v-2h8v-2h-8v-2h-2v6h2zM7 9v2H3v2h4v2h2V9H7zm14 4v-2H11v2h10zm-6-4h2V7h4V5h-4V3h-2v6z",
  camara: "M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4zM9 2 7.17 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-3.17L15 2H9zm3 15a5 5 0 1 1 0-10 5 5 0 0 1 0 10z",
  pip: "M19 7h-8v6h8V7zm2-4H3a2 2 0 0 0-2 2v14c0 1.1.9 1.98 2 1.98h18c1.1 0 2-.88 2-1.98V5a2 2 0 0 0-2-2zm0 16.01H3V4.98h18v14.03z",
  completa: "M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z",
  salirCompleta: "M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-11V5h-2v5h5V8h-3z",
  velocidad: "M20.38 8.57l-1.23 1.85a8 8 0 0 1-.22 7.58H5.07A8 8 0 0 1 15.58 6.85l1.85-1.23A10 10 0 0 0 3.35 19a2 2 0 0 0 1.72 1h13.85a2 2 0 0 0 1.74-1 10 10 0 0 0-.27-10.44zm-9.79 6.84a2 2 0 0 0 2.83 0l5.66-8.49-8.49 5.66a2 2 0 0 0 0 2.83z",
  teclado: "M20 5H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2zm-9 3h2v2h-2V8zm0 3h2v2h-2v-2zM8 8h2v2H8V8zm0 3h2v2H8v-2zm-1 2H5v-2h2v2zm0-3H5V8h2v2zm9 7H8v-2h8v2zm0-4h-2v-2h2v2zm0-3h-2V8h2v2zm3 3h-2v-2h2v2zm0-3h-2V8h2v2z",
  aleatorio: "M10.59 9.17 5.41 4 4 5.41l5.17 5.17 1.42-1.41zM14.5 4l2.04 2.04L4 18.59 5.41 20 17.96 7.46 20 9.5V4h-5.5zm.33 9.41-1.41 1.41 3.13 3.13L14.5 20H20v-5.5l-2.04 2.04-3.13-3.13z",
  repetir: "M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z",
  repetirUna: "M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4zm-4-2V9h-1l-2 1v1h1.5v4H13z",
  descargar: "M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z",
  subir: "M9 16h6v-6h4l-7-7-7 7h4zm-4 2h14v2H5z",
  micro: "M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3zm5.3-3c0 3-2.54 5.1-5.3 5.1S6.7 14 6.7 11H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c3.28-.48 6-3.3 6-6.72h-1.7z",
  video: "M17 10.5V7a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-3.5l4 4v-11l-4 4z",
  pantalla: "M20 18a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2H0v2h24v-2h-4zM4 6h16v10H4V6z",
  grabar: "M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16z",
  parar: "M6 6h12v12H6z",
  borrar: "M6 19a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z",
  ecualizador: "M10 20h4V4h-4v16zm-6 0h4v-8H4v8zM16 9v11h4V9h-4z",
  nota: "M12 3v10.55A4 4 0 1 0 14 17V7h4V3h-6z",
  onda: "M3 12h2l2-6 3 12 3-9 2 5 2-2h4",
  cerrar: "M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z",
  exito: "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm-2 15-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z",
  info: "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z",
  aviso: "M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z",
  error: "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z",
  comparar: "M10 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h5v2h2V1h-2v2zm0 15H5l5-6v6zm9-15h-5v2h5v13l-5-6v9h5a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2z",
  reiniciar: "M17.65 6.35A7.96 7.96 0 0 0 12 4a8 8 0 1 0 7.73 10h-2.08A6 6 0 1 1 12 6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z",
  lista: "M3 13h2v-2H3v2zm0 4h2v-2H3v2zm0-8h2V7H3v2zm4 4h14v-2H7v2zm0 4h14v-2H7v2zM7 7v2h14V7H7z",
  archivo: "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zm4 18H6V4h7v5h5v11z",
  inicio: "M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z",
  luna: "M12 3a9 9 0 1 0 9 9c0-.46-.04-.92-.1-1.36a5.39 5.39 0 0 1-4.4 2.26 5.4 5.4 0 0 1-3.14-9.8c-.44-.06-.9-.1-1.36-.1z",
  sol: "M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10zM2 13h2a1 1 0 0 0 0-2H2a1 1 0 0 0 0 2zm18 0h2a1 1 0 0 0 0-2h-2a1 1 0 0 0 0 2zM11 2v2a1 1 0 0 0 2 0V2a1 1 0 0 0-2 0zm0 18v2a1 1 0 0 0 2 0v-2a1 1 0 0 0-2 0zM5.99 4.58a1 1 0 0 0-1.41 1.41l1.06 1.06a1 1 0 0 0 1.41-1.41L5.99 4.58zm12.37 12.37a1 1 0 0 0-1.41 1.41l1.06 1.06a1 1 0 0 0 1.41-1.41l-1.06-1.06zm1.06-10.96a1 1 0 0 0-1.41-1.41l-1.06 1.06a1 1 0 0 0 1.41 1.41l1.06-1.06zM7.05 18.36a1 1 0 0 0-1.41-1.41l-1.06 1.06a1 1 0 0 0 1.41 1.41l1.06-1.06z",
  buscar: "M15.5 14h-.79l-.28-.27A6.47 6.47 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z",
  disco: "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0 14.5a4.5 4.5 0 1 1 0-9 4.5 4.5 0 0 1 0 9zm0-5.5a1 1 0 1 0 0 2 1 1 0 0 0 0-2z",
  persona: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z",
  corazon: "M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z",
  corazonVacio: "M16.5 3c-1.74 0-3.41.81-4.5 2.09C10.91 3.81 9.24 3 7.5 3 4.42 3 2 5.42 2 8.5c0 3.78 3.4 6.86 8.55 11.54L12 21.35l1.45-1.32C18.6 15.36 22 12.28 22 8.5 22 5.42 19.58 3 16.5 3zm-4.4 15.55-.1.1-.1-.1C7.14 14.24 4 11.39 4 8.5 4 6.5 5.5 5 7.5 5c1.54 0 3.04.99 3.57 2.36h1.87C13.46 5.99 14.96 5 16.5 5c2 0 3.5 1.5 3.5 3.5 0 2.89-3.14 5.74-7.9 10.05z",
  mas: "M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z",
  opciones: "M12 8a2 2 0 1 0 0-4 2 2 0 0 0 0 4zm0 2a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm0 6a2 2 0 1 0 0 4 2 2 0 0 0 0-4z",
  cola: "M15 6H3v2h12V6zm0 4H3v2h12v-2zM3 16h8v-2H3v2zM17 6v8.18A3 3 0 0 0 16 14a3 3 0 1 0 3 3V8h3V6h-5z",
  izquierda: "M15.41 7.41 14 6l-6 6 6 6 1.41-1.41L10.83 12z",
  derecha: "M10 6 8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z",
  abajo: "M7.41 8.59 12 13.17l4.59-4.58L18 10l-6 6-6-6z",
  anadirLista: "M14 10H2v2h12v-2zm0-4H2v2h12V6zm4 8v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zM2 16h8v-2H2v2z",
  editar: "M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z",
  temporizador: "M15 1H9v2h6V1zm-4 13h2V8h-2v6zm8.03-6.61 1.42-1.42c-.43-.51-.9-.99-1.41-1.41l-1.42 1.42A8.96 8.96 0 0 0 12 4a9 9 0 1 0 9 9c0-2.12-.74-4.07-1.97-5.61zM12 20a7 7 0 1 1 0-14 7 7 0 0 1 0 14z",
  miniReproductor: "M19 11h-8v6h8v-6zm4 8V4.98C23 3.88 22.1 3 21 3H3c-1.1 0-2 .88-2 1.98V19c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2zm-2 .02H3V4.97h18v14.05z",
  expandir: "M21 11V3h-8l3.29 3.29-10 10L3 13v8h8l-3.29-3.29 10-10z",
  ajustes: "M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.49.49 0 0 0-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.48.48 0 0 0-.48-.41h-3.84a.48.48 0 0 0-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96a.48.48 0 0 0-.59.22L2.74 8.87a.47.47 0 0 0 .12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32a.47.47 0 0 0-.12-.61l-2.01-1.58zM12 15.6a3.6 3.6 0 1 1 0-7.2 3.6 3.6 0 0 1 0 7.2z",
  herramientas: "M22.7 19l-9.1-9.1c.9-2.3.4-5-1.5-6.9-2-2-5-2.4-7.4-1.3L9 6 6 9 1.6 4.7C.4 7.1.9 10.1 2.9 12.1c1.9 1.9 4.6 2.4 6.9 1.5l9.1 9.1c.4.4 1 .4 1.4 0l2.3-2.3c.5-.4.5-1.1.1-1.4z",
  diagnostico: "M19 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2zM9 17H7v-7h2v7zm4 0h-2V7h2v10zm4 0h-2v-4h2v4z",
  carpeta: "M10 4H4a2 2 0 0 0-1.99 2L2 18a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-8l-2-2z",
  arrastrar: "M11 18a2 2 0 1 1-4 0 2 2 0 0 1 4 0zm-2-8a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm0-6a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm6 4a2 2 0 1 0 0-4 2 2 0 0 0 0 4zm0 2a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm0 6a2 2 0 1 0 0 4 2 2 0 0 0 0-4z",
  sonido: "M7 18h2V6H7v12zm4 4h2V2h-2v20zm-8-8h2v-4H3v4zm12 4h2V6h-2v12zm4-8v4h2v-4h-2z",
  letra: "M20 2H4a2 2 0 0 0-2 2v18l4-4h14a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2zM6 9h12v2H6V9zm8 5H6v-2h8v2zm4-6H6V6h12v2z",
  instalar: "M19 9h-4V3H9v6H5l7 7 7-7zm-8 2V5h2v6h1.17L12 13.17 9.83 11H11zm-6 7h14v2H5z",
};

/**
 * Devuelve un <svg> con el icono pedido.
 * @param {keyof TRAZADOS} nombre
 */
export function icono(nombre) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.classList.add("kr-icono");
  const trazo = document.createElementNS("http://www.w3.org/2000/svg", "path");
  trazo.setAttribute("d", TRAZADOS[nombre] ?? TRAZADOS.info);
  // "onda" es una línea, no una figura rellena
  if (nombre === "onda") {
    trazo.setAttribute("fill", "none");
    trazo.setAttribute("stroke", "currentColor");
    trazo.setAttribute("stroke-width", "2");
    trazo.setAttribute("stroke-linecap", "round");
    trazo.setAttribute("stroke-linejoin", "round");
  }
  svg.append(trazo);
  return svg;
}

// ── DOM ──────────────────────────────────────────────────────────────

/**
 * Crea un elemento en una sola línea.
 *   crear("button", { clase: "kr-boton", titulo: "Play", icono: "play" })
 *
 * @param {string} etiqueta
 * @param {object} [o]
 * @param {string} [o.clase]      clases separadas por espacios
 * @param {string} [o.texto]      textContent
 * @param {string} [o.titulo]     title + aria-label
 * @param {string} [o.icono]      nombre de icono que se añade dentro
 * @param {object} [o.atributos]  otros atributos
 * @param {object} [o.datos]      atributos data-*
 * @param {object} [o.eventos]    { click: fn, … }
 * @param {Array<Node|string>} [hijos]
 * @returns {HTMLElement}
 */
export function crear(etiqueta, o = {}, hijos = []) {
  const el = document.createElement(etiqueta);
  if (o.clase) el.className = o.clase;
  if (o.texto !== undefined) el.textContent = o.texto;
  if (o.titulo) {
    el.title = o.titulo;
    el.setAttribute("aria-label", o.titulo);
  }
  if (o.icono) el.append(icono(o.icono));
  for (const [clave, valor] of Object.entries(o.atributos ?? {})) {
    if (valor !== undefined && valor !== null && valor !== false) el.setAttribute(clave, valor);
  }
  for (const [clave, valor] of Object.entries(o.datos ?? {})) el.dataset[clave] = valor;
  for (const [evento, fn] of Object.entries(o.eventos ?? {})) el.addEventListener(evento, fn);
  if (etiqueta === "button" && !o.atributos?.type) el.type = "button";
  el.append(...hijos);
  return el;
}

/** Cambia el icono de un botón creado con crear(). */
export function cambiarIcono(boton, nombre, titulo) {
  boton.querySelector(".kr-icono")?.replaceWith(icono(nombre));
  if (titulo) {
    boton.title = titulo;
    boton.setAttribute("aria-label", titulo);
  }
}

/**
 * Slider con etiqueta y valor visible.
 * Devuelve { raiz, input, salida, fijar } — fijar(v) cambia el valor sin disparar alCambiar.
 */
export function crearDeslizador({ etiqueta, min, max, paso = 1, valor, formato = (v) => v, alCambiar }) {
  const input = crear("input", { atributos: { type: "range", min, max, step: paso, value: valor } });
  const salida = crear("output", { texto: formato(valor) });
  const raiz = crear("label", { clase: "kr-deslizador" }, [
    crear("span", { clase: "kr-deslizador-etiqueta", texto: etiqueta }),
    input,
    salida,
  ]);
  // --valor (0…1) lo usa el CSS para pintar la parte "llena" del carril
  const pintar = (v) => input.style.setProperty("--valor", (v - min) / (max - min));
  pintar(valor);
  input.addEventListener("input", () => {
    const v = Number(input.value);
    salida.textContent = formato(v);
    pintar(v);
    alCambiar?.(v);
  });
  const fijar = (v) => {
    input.value = v;
    salida.textContent = formato(v);
    pintar(v);
  };
  return { raiz, input, salida, fijar };
}

// ── Formatos ─────────────────────────────────────────────────────────

/** 75.4 → "1:15"   ·   3725 → "1:02:05" */
export function formatearTiempo(segundos) {
  if (!Number.isFinite(segundos) || segundos < 0) return "0:00";
  const s = Math.floor(segundos % 60);
  const m = Math.floor((segundos / 60) % 60);
  const h = Math.floor(segundos / 3600);
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

/** 1536 → "1.5 KB" */
export function formatearBytes(bytes) {
  if (!Number.isFinite(bytes)) return "—";
  const unidades = ["B", "KB", "MB", "GB"];
  let i = 0;
  while (bytes >= 1024 && i < unidades.length - 1) {
    bytes /= 1024;
    i++;
  }
  return `${bytes.toFixed(i === 0 ? 0 : 1)} ${unidades[i]}`;
}

export const limitar = (v, min, max) => Math.min(max, Math.max(min, v));

/** "media/cancion.mp3?x=1" → "cancion" */
export function nombreBase(ruta) {
  const limpio = decodeURIComponent(String(ruta).split(/[?#]/)[0]);
  const archivo = limpio.substring(limpio.lastIndexOf("/") + 1);
  const punto = archivo.lastIndexOf(".");
  return punto > 0 ? archivo.substring(0, punto) : archivo;
}

/** "media/cancion.mp3" → "media/cancion" (ruta sin extensión) */
export function sinExtension(ruta) {
  const limpio = String(ruta).split(/[?#]/)[0];
  const punto = limpio.lastIndexOf(".");
  return punto > limpio.lastIndexOf("/") ? limpio.substring(0, punto) : limpio;
}

// ── Archivos ─────────────────────────────────────────────────────────

/** Fuerza la descarga de un Blob con el nombre indicado. */
export function descargar(blob, nombre) {
  const url = URL.createObjectURL(blob);
  const enlace = crear("a", { atributos: { href: url, download: nombre } });
  document.body.append(enlace);
  enlace.click();
  enlace.remove();
  // Damos tiempo al navegador a empezar la descarga antes de liberar la URL
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/** Color estable a partir de un texto (para portadas generadas). */
export function tonoDesdeTexto(texto) {
  let h = 0;
  for (const c of String(texto)) h = (h * 31 + c.codePointAt(0)) % 360;
  return h;
}

/** Lee una variable CSS de un elemento (para que los canvas usen el tema). */
export function variableCSS(elemento, nombre, porDefecto) {
  const valor = getComputedStyle(elemento).getPropertyValue(nombre).trim();
  return valor || porDefecto;
}

/** Ejecuta fn como mucho una vez cada `ms` milisegundos. */
export function limitarFrecuencia(fn, ms) {
  let ultimo = 0;
  let pendiente = null;
  return (...args) => {
    const ahora = performance.now();
    clearTimeout(pendiente);
    if (ahora - ultimo >= ms) {
      ultimo = ahora;
      fn(...args);
    } else {
      pendiente = setTimeout(() => {
        ultimo = performance.now();
        fn(...args);
      }, ms - (ahora - ultimo));
    }
  };
}

/** Guarda/lee preferencias sin romper si el almacenamiento está bloqueado. */
export const preferencias = {
  leer(clave, porDefecto) {
    try {
      const v = localStorage.getItem(`kroma:${clave}`);
      return v === null ? porDefecto : JSON.parse(v);
    } catch {
      return porDefecto;
    }
  },
  guardar(clave, valor) {
    try {
      localStorage.setItem(`kroma:${clave}`, JSON.stringify(valor));
    } catch {
      /* modo privado o almacenamiento lleno: no es grave */
    }
  },
};
