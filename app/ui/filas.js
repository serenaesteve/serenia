/**
 * Serenia · tablas de canciones y tarjetas
 */

import { app } from "../contexto.js";
import { biblioteca } from "../datos/biblioteca.js";
import { crear, icono, portada, formatearTiempo, enlace, mosaico } from "./dom.js";
import { menuPista, reproducirEnContexto, alternarFavorito, normalizarClave, reproducirTodo } from "./acciones.js";
import { abrirMenu } from "./menus.js";

export const TIPO_ARRASTRE = "application/x-kroma-pistas";

/** Las tres barritas animadas de "está sonando". */
export const barritas = () => crear("span", { clase: "barritas" }, [crear("i"), crear("i"), crear("i")]);

/**
 * Tabla de canciones.
 * @param {object[]} pistas
 * @param {object} [o]
 * @param {boolean} [o.album=true]     mostrar la columna de álbum
 * @param {boolean} [o.numeroPista]    numerar con el nº de pista del álbum
 * @param {object} [o.lista]           si es una lista: permite reordenar arrastrando y quitar
 */
export function tablaPistas(pistas, { album = true, numeroPista = false, lista = null } = {}) {
  const tabla = crear("div", { clase: `tabla${album ? "" : " tabla--sin-album"}`, atributos: { role: "grid" } });
  tabla.append(
    crear("div", { clase: "tabla-cabecera", atributos: { role: "row" } }, [
      crear("span", { texto: "#" }),
      crear("span", { texto: "Título" }),
      album ? crear("span", { texto: "Álbum" }) : "",
      crear("span"),
      crear("span", { clase: "tabla-duracion" }, [icono("temporizador")]),
      crear("span"),
    ]),
  );

  pistas.forEach((p, i) => {
    const fav = crear("button", {
      clase: `boton-icono fav${p.favorito ? " activo" : ""}`,
      icono: p.favorito ? "corazon" : "corazonVacio",
      titulo: p.favorito ? "Quitar de favoritos" : "Añadir a favoritos",
      eventos: { click: (e) => (e.stopPropagation(), alternarFavorito(p)) },
    });
    const fila = crear(
      "div",
      {
        clase: `fila${p.error ? " fila--error" : ""}`,
        atributos: { role: "row", tabindex: 0, draggable: "true" },
        datos: { pistaId: p.id, indice: i },
      },
      [
        crear("span", { clase: "fila-num" }, [
          crear("span", { clase: "fila-n", texto: numeroPista && p.numero ? p.numero : i + 1 }),
          barritas(),
          crear("button", { clase: "fila-play", icono: "play", titulo: `Reproducir ${p.titulo}`, eventos: { click: (e) => (e.stopPropagation(), reproducirEnContexto(p, pistas)) } }),
        ]),
        crear("span", { clase: "fila-titulo" }, [
          portada(p, { clase: "portada--mini" }),
          crear("span", { clase: "fila-textos" }, [
            crear("strong", { texto: p.titulo }),
            crear("span", {}, [p.tipo === "video" ? crear("span", { clase: "chip-mini", texto: "VÍDEO" }) : "", enlace(p.artista, `#/artista/${encodeURIComponent(normalizarClave(p.artista))}`)]),
          ]),
        ]),
        album ? crear("span", { clase: "fila-album" }, [p.tipo === "audio" ? enlace(p.album, `#/album/${biblioteca.albumDe(p)?.id ?? ""}`) : crear("span", { texto: "—" })]) : "",
        fav,
        crear("span", { clase: "fila-duracion", texto: formatearTiempo(p.duracion) }),
        crear("button", { clase: "boton-icono fila-mas", icono: "opciones", titulo: "Más opciones", eventos: { click: (e) => (e.stopPropagation(), menuPista(e, p, { contexto: pistas, lista })) } }),
      ],
    );
    fila.addEventListener("dblclick", () => reproducirEnContexto(p, pistas));
    fila.addEventListener("keydown", (e) => {
      if (e.key === "Enter") reproducirEnContexto(p, pistas);
      else if (e.key === "ArrowDown") fila.nextElementSibling?.focus();
      else if (e.key === "ArrowUp") fila.previousElementSibling?.classList.contains("fila") && fila.previousElementSibling.focus();
      else return;
      e.preventDefault();
    });
    fila.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      menuPista(e, p, { contexto: pistas, lista });
    });
    fila.addEventListener("dragstart", (e) => {
      e.dataTransfer.setData(TIPO_ARRASTRE, JSON.stringify([p.id]));
      e.dataTransfer.setData("text/plain", `${p.artista} — ${p.titulo}`);
      e.dataTransfer.effectAllowed = "copyMove";
      fila.classList.add("arrastrando");
    });
    fila.addEventListener("dragend", () => fila.classList.remove("arrastrando"));
    tabla.append(fila);
  });

  if (lista) permitirReordenar(tabla, lista);
  marcarSonando(tabla);
  return tabla;
}

/** En una lista: arrastrar filas para cambiar el orden. */
function permitirReordenar(tabla, lista) {
  let destino = null;
  tabla.addEventListener("dragover", (e) => {
    const fila = e.target.closest(".fila");
    if (!fila || !e.dataTransfer.types.includes(TIPO_ARRASTRE)) return;
    e.preventDefault();
    tabla.querySelector(".soltar-encima")?.classList.remove("soltar-encima");
    fila.classList.add("soltar-encima");
    destino = Number(fila.dataset.indice);
  });
  tabla.addEventListener("dragleave", (e) => !tabla.contains(e.relatedTarget) && tabla.querySelector(".soltar-encima")?.classList.remove("soltar-encima"));
  tabla.addEventListener("drop", async (e) => {
    e.preventDefault();
    tabla.querySelector(".soltar-encima")?.classList.remove("soltar-encima");
    const [id] = JSON.parse(e.dataTransfer.getData(TIPO_ARRASTRE) || "[]");
    if (!id || destino === null) return;
    const de = lista.pistas.indexOf(id);
    if (de === -1) {
      lista.pistas.splice(destino, 0, id);
    } else {
      lista.pistas.splice(de, 1);
      lista.pistas.splice(destino, 0, id);
    }
    await biblioteca.guardarLista(lista);
  });
}

/** Marca la fila que está sonando (y la vuelve a marcar cuando cambia la pista). */
export function marcarSonando(raiz = document) {
  const id = app.motor?.pista?.id;
  for (const fila of raiz.querySelectorAll("[data-pista-id]")) fila.classList.toggle("sonando", fila.dataset.pistaId === id);
}

// ── Tarjetas ─────────────────────────────────────────────────────────

/** Tarjeta cuadrada (álbum, artista, lista) con botón de play al pasar el ratón. */
export function tarjeta({ titulo, subtitulo, imagen, ruta, alReproducir, redonda = false, menu }) {
  const t = crear("article", { clase: `tarjeta${redonda ? " tarjeta--redonda" : ""}`, atributos: { tabindex: 0 } }, [
    crear("div", { clase: "tarjeta-imagen" }, [
      imagen,
      alReproducir
        ? crear("button", { clase: "tarjeta-play", icono: "play", titulo: `Reproducir ${titulo}`, eventos: { click: (e) => (e.stopPropagation(), alReproducir()) } })
        : "",
    ]),
    crear("strong", { texto: titulo }),
    subtitulo ? crear("span", { texto: subtitulo }) : "",
  ]);
  t.addEventListener("click", () => app.navegar(ruta));
  t.addEventListener("keydown", (e) => e.key === "Enter" && app.navegar(ruta));
  if (menu) {
    t.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      abrirMenu(e, menu());
    });
  }
  return t;
}

export function tarjetaAlbum(a) {
  return tarjeta({
    titulo: a.titulo,
    subtitulo: `${a.anio ? `${a.anio} · ` : ""}${a.artista}`,
    imagen: portada(a.conPortada),
    ruta: `#/album/${a.id}`,
    alReproducir: () => reproducirTodo(a.pistas),
  });
}

export function tarjetaArtista(a) {
  return tarjeta({
    titulo: a.nombre,
    subtitulo: "Artista",
    imagen: portada(a.conPortada, { redonda: true }),
    ruta: `#/artista/${a.id}`,
    alReproducir: () => reproducirTodo(a.pistas),
    redonda: true,
  });
}

export function tarjetaLista(l) {
  const pistas = biblioteca.pistasDeLista(l);
  return tarjeta({
    titulo: l.nombre,
    subtitulo: `Lista · ${pistas.length} elemento${pistas.length === 1 ? "" : "s"}`,
    imagen: mosaico(pistas),
    ruta: `#/lista/${l.id}`,
    alReproducir: pistas.length ? () => reproducirTodo(pistas) : null,
  });
}

/** Tarjeta de vídeo: miniatura 16:9, duración y barra de "por dónde ibas". */
export function tarjetaVideo(v, contexto) {
  const progreso = v.posicion && v.duracion ? v.posicion / v.duracion : 0;
  const t = crear("article", { clase: "tarjeta-video", atributos: { tabindex: 0 }, datos: { pistaId: v.id } }, [
    crear("div", { clase: "tarjeta-video-imagen" }, [
      portada(v),
      crear("span", { clase: "tarjeta-video-duracion", texto: formatearTiempo(v.duracion) }),
      progreso > 0.02 ? crear("span", { clase: "tarjeta-video-progreso", atributos: { style: `--p:${progreso}` } }) : "",
      crear("span", { clase: "tarjeta-video-play" }, [icono("play")]),
    ]),
    crear("strong", { texto: v.titulo }),
    crear("span", { texto: `${v.artista}${v.ancho ? ` · ${v.alto}p` : ""}${v.subtitulos?.length ? " · CC" : ""}` }),
  ]);
  const reproducir = () => {
    reproducirEnContexto(v, contexto);
    app.navegar("#/ahora");
  };
  t.addEventListener("click", reproducir);
  t.addEventListener("keydown", (e) => e.key === "Enter" && reproducir());
  t.addEventListener("contextmenu", (e) => (e.preventDefault(), menuPista(e, v, { contexto })));
  return t;
}

/** Fila horizontal desplazable con título (para la portada). */
export function estante(titulo, elementos, { ruta, clase = "" } = {}) {
  if (!elementos.length) return "";
  return crear("section", { clase: `estante ${clase}`.trim() }, [
    crear("header", {}, [crear("h2", { texto: titulo }), ruta ? enlace("Ver todo", ruta, "enlace enlace--suave") : ""]),
    crear("div", { clase: "estante-fila" }, elementos),
  ]);
}
