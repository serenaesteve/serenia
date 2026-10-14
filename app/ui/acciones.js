/**
 * Serenia · acciones sobre pistas
 *
 * Todo lo que se puede hacer con una canción o un vídeo desde cualquier
 * vista: menú contextual, añadir a listas, información, edición, exportar…
 */

import { app } from "../contexto.js";
import { biblioteca } from "../datos/biblioteca.js";
import { extraerColores } from "../datos/colores.js";
import { abrirMenu, dialogo, pedirTexto, confirmar } from "./menus.js";
import { crear, portada, formatearTiempo } from "./dom.js";
import { notificar } from "../../kroma/animacion/notificaciones.js";
import { decodificar } from "../../kroma/procesado/formaOnda.js";
import { audioBufferAWav, renderizarConEcualizador } from "../../kroma/conversion/conversor.js";
import { formatearBytes, descargar } from "../../kroma/nucleo/utilidades.js";
import { normalizarError } from "../../kroma/nucleo/errores.js";

/** Reproduce `pista` dentro de su contexto (álbum, lista…) para que siga con las demás. */
export function reproducirEnContexto(pista, contexto) {
  const ids = (contexto?.length ? contexto : [pista]).map((p) => p.id);
  app.motor.reproducirLista(ids, Math.max(0, ids.indexOf(pista.id)), { aleatorio: false });
}

export function reproducirTodo(pistas, { aleatorio = false } = {}) {
  if (!pistas.length) return;
  app.motor.reproducirLista(
    pistas.map((p) => p.id),
    aleatorio ? Math.floor(Math.random() * pistas.length) : 0,
    { aleatorio },
  );
}

/** Submenú "Añadir a lista" con todas las listas + "Nueva lista…". */
export function submenuListas(ids) {
  return [
    { icono: "mas", texto: "Nueva lista…", accion: () => nuevaLista(ids) },
    ...(biblioteca.listas.size ? ["-"] : []),
    ...biblioteca.listasOrdenadas().map((l) => ({
      icono: "lista",
      texto: l.nombre,
      accion: async () => {
        const n = await biblioteca.anadirALista(l.id, ids);
        notificar(n ? `Añadido a «${l.nombre}»` : `Ya estaba en «${l.nombre}»`, { tipo: n ? "exito" : "info", duracion: 2200 });
      },
    })),
  ];
}

export async function nuevaLista(ids = []) {
  const nombre = await pedirTexto("Nueva lista de reproducción", "", "Mi lista");
  if (!nombre) return null;
  const lista = await biblioteca.crearLista(nombre, ids);
  notificar(ids.length ? `«${nombre}» creada con ${ids.length} elemento(s)` : `«${nombre}» creada`, {
    tipo: "exito",
    duracion: 2500,
    accion: { texto: "Abrir", fn: () => app.navegar(`#/lista/${lista.id}`) },
  });
  return lista;
}

/**
 * Menú contextual de una pista.
 * @param {MouseEvent|HTMLElement} origen
 * @param {object} pista
 * @param {object} [o]
 * @param {object[]} [o.contexto]   pistas que rodean a esta (para "Reproducir")
 * @param {object} [o.lista]        lista desde la que se abre (permite "Quitar de la lista")
 * @param {number} [o.posicionCola] si viene de la cola
 */
export function menuPista(origen, pista, { contexto, lista, posicionCola } = {}) {
  const album = biblioteca.albumDe(pista);
  const opciones = [
    { icono: "play", texto: "Reproducir", accion: () => reproducirEnContexto(pista, contexto) },
    { icono: "cola", texto: "Reproducir a continuación", accion: () => (app.motor.anadirSiguiente([pista.id]), notificar("Se reproducirá a continuación", { duracion: 1800 })) },
    { icono: "lista", texto: "Añadir a la cola", accion: () => (app.motor.anadirAlFinal([pista.id]), notificar("Añadido a la cola", { duracion: 1800 })) },
    { icono: "anadirLista", texto: "Añadir a una lista", submenu: submenuListas([pista.id]) },
    "-",
    { icono: pista.favorito ? "corazon" : "corazonVacio", texto: pista.favorito ? "Quitar de favoritos" : "Añadir a favoritos", accion: () => alternarFavorito(pista) },
    pista.tipo === "audio" && album ? { icono: "disco", texto: "Ir al álbum", accion: () => app.navegar(`#/album/${album.id}`) } : null,
    { icono: "persona", texto: "Ir al artista", accion: () => app.navegar(`#/artista/${encodeURIComponent(normalizarClave(pista.artista))}`) },
    "-",
    { icono: "info", texto: "Información y edición", accion: () => informacion(pista) },
    pista.tipo === "audio" ? { icono: "descargar", texto: "Exportar a WAV", accion: () => exportarWav(pista) } : null,
    lista ? { icono: "cerrar", texto: "Quitar de esta lista", accion: () => quitarDeLista(lista, pista) } : null,
    posicionCola !== undefined ? { icono: "cerrar", texto: "Quitar de la cola", accion: () => app.motor.quitarDeCola(posicionCola) } : null,
    { icono: "borrar", texto: "Eliminar de la biblioteca", peligro: true, accion: () => eliminar([pista]) },
  ].filter(Boolean);
  // Quitamos separadores duplicados que pueden quedar al filtrar
  abrirMenu(origen, opciones.filter((o, i, a) => !(o === "-" && (a[i - 1] === "-" || i === a.length - 1))));
}

export const normalizarClave = (s) =>
  String(s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

export async function alternarFavorito(pista) {
  const ahora = await biblioteca.alternarFavorito(pista.id);
  notificar(ahora ? `«${pista.titulo}» en favoritos` : `«${pista.titulo}» quitado de favoritos`, { tipo: ahora ? "exito" : "info", duracion: 1800 });
}

async function quitarDeLista(lista, pista) {
  const pos = lista.pistas.indexOf(pista.id);
  if (pos < 0) return;
  lista.pistas.splice(pos, 1);
  await biblioteca.guardarLista(lista);
  notificar(`Quitado de «${lista.nombre}»`, {
    duracion: 4000,
    accion: { texto: "Deshacer", fn: async () => (lista.pistas.splice(pos, 0, pista.id), await biblioteca.guardarLista(lista)) },
  });
}

export async function eliminar(pistas) {
  const texto = pistas.length === 1 ? `«${pistas[0].titulo}» se borrará de la biblioteca y de todas las listas.` : `Se borrarán ${pistas.length} elementos de la biblioteca.`;
  if (!(await confirmar("Eliminar de la biblioteca", texto))) return;
  if (pistas.some((p) => p.id === app.motor.pista?.id)) app.motor.pausar();
  await biblioteca.eliminar(pistas.map((p) => p.id));
  notificar(pistas.length === 1 ? "Eliminado" : `${pistas.length} elementos eliminados`, { duracion: 2000 });
}

/** Decodifica la pista y la guarda como WAV, con el ecualizador actual si no es plano. */
export async function exportarWav(pista) {
  const aviso = notificar(`Convirtiendo «${pista.titulo}» a WAV…`, { duracion: 0 });
  try {
    let buffer = await decodificar(pista.archivo ?? pista.url);
    const { ganancias, balance } = app.motor.ajustes;
    const conEq = ganancias.some((g) => g !== 0) || balance !== 0;
    if (conEq) buffer = await renderizarConEcualizador(buffer, ganancias, balance);
    const wav = audioBufferAWav(buffer);
    descargar(wav, `${pista.artista} - ${pista.titulo}.wav`);
    notificar(`${formatearBytes(wav.size)} · ${buffer.sampleRate} Hz · 16 bits${conEq ? " · con tu ecualizador" : ""}`, { tipo: "exito", titulo: "WAV exportado" });
  } catch (error) {
    notificar(normalizarError(error).message, { tipo: "error", titulo: "No se pudo exportar" });
  } finally {
    aviso.cerrar();
  }
}

/** Ficha de la pista: datos técnicos + edición de etiquetas y carátula. */
export async function informacion(pista) {
  const campos = [
    ["titulo", "Título"],
    ["artista", "Artista"],
    ["album", "Álbum"],
    ["anio", "Año"],
    ["genero", "Género"],
    ["numero", "Nº de pista"],
  ];
  const inputs = Object.fromEntries(campos.map(([clave]) => [clave, crear("input", { clase: "campo", atributos: { value: pista[clave] ?? "", name: clave } })]));
  let nuevaPortada = null;
  const vistaPortada = crear("div", { clase: "info-portada" }, [portada(pista)]);
  const elegirPortada = crear("input", {
    atributos: { type: "file", accept: "image/*", hidden: "" },
    eventos: {
      change: (e) => {
        nuevaPortada = e.target.files[0];
        if (!nuevaPortada) return;
        vistaPortada.replaceChildren(crear("div", { clase: "portada" }, [crear("img", { atributos: { src: URL.createObjectURL(nuevaPortada), alt: "" } })]));
      },
    },
  });

  const tecnicos = [
    ["Tipo", pista.tipo === "video" ? `Vídeo ${pista.ancho ?? "?"}×${pista.alto ?? "?"}` : "Audio"],
    ["Archivo", pista.nombreArchivo],
    ["Formato", `${pista.formato}${pista.mime ? ` · ${pista.mime}` : ""}`],
    ["Etiquetas", pista.etiqueta ?? "—"],
    ["Duración", formatearTiempo(pista.duracion)],
    ["Tamaño", formatearBytes(pista.tamano)],
    pista.frecuencia ? ["Audio", `${pista.frecuencia} Hz · ${pista.canales === 1 ? "mono" : pista.canales === 2 ? "estéreo" : `${pista.canales} canales`}`] : null,
    pista.tipo === "audio" ? ["Normalización", `${pista.ganancia > 0 ? "+" : ""}${pista.ganancia ?? 0} dB`] : null,
    pista.letra ? ["Letra", pista.letra.sincronizada ? "Sincronizada" : "Sin sincronizar (ID3)"] : null,
    pista.subtitulos?.length ? ["Subtítulos", pista.subtitulos.map((s) => s.etiqueta).join(", ")] : null,
    pista.capitulos ? ["Capítulos", "Sí"] : null,
    ["Reproducciones", pista.reproducciones ?? 0],
    ["Añadido", new Date(pista.fechaAlta).toLocaleString()],
    ["Origen", pista.origen === "url" ? `Demo (${pista.url})` : "Importado en el navegador (IndexedDB)"],
  ].filter(Boolean);

  const contenido = crear("div", { clase: "info" }, [
    crear("div", { clase: "info-lado" }, [
      vistaPortada,
      crear("button", { clase: "boton", texto: "Cambiar carátula", eventos: { click: () => elegirPortada.click() } }),
      elegirPortada,
    ]),
    crear("div", { clase: "info-datos" }, [
      crear("div", { clase: "info-campos" }, campos.map(([clave, etiqueta]) => crear("label", {}, [crear("span", { texto: etiqueta }), inputs[clave]]))),
      crear("dl", { clase: "info-tecnica" }, tecnicos.flatMap(([k, v]) => [crear("dt", { texto: k }), crear("dd", { texto: String(v) })])),
    ]),
  ]);

  const r = await dialogo({
    titulo: pista.tipo === "video" ? "Información del vídeo" : "Información de la canción",
    contenido,
    clase: "dialogo--ancho",
    acciones: [{ texto: "Cancelar" }, { texto: "Guardar cambios", valor: "guardar", principal: true }],
  });
  if (r !== "guardar") return;
  const cambios = {};
  for (const [clave] of campos) {
    const v = clave === "numero" ? Number(inputs[clave].value) || 0 : inputs[clave].value.trim();
    if (v !== (pista[clave] ?? "")) cambios[clave] = v;
  }
  if (nuevaPortada) {
    cambios.portada = nuevaPortada;
    cambios.color = await extraerColores(nuevaPortada);
  }
  if (Object.keys(cambios).length) {
    await biblioteca.actualizar(pista.id, cambios);
    notificar("Cambios guardados", { tipo: "exito", duracion: 1800 });
  }
}
