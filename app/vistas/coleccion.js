/**
 * Serenia · vistas de la biblioteca
 *   canciones · favoritos · álbumes · álbum · artistas · artista · vídeos · lista · buscar
 */

import { app } from "../contexto.js";
import { biblioteca, normalizar } from "../datos/biblioteca.js";
import { crear, icono, portada, mosaico, plural, duracionLarga, enlace, botonIcono, vacio } from "../ui/dom.js";
import { tablaPistas, tarjetaAlbum, tarjetaArtista, tarjetaVideo, tarjetaLista, estante } from "../ui/filas.js";
import { reproducirTodo, submenuListas, eliminar, nuevaLista } from "../ui/acciones.js";
import { abrirMenu, pedirTexto, confirmar } from "../ui/menus.js";
import { notificar } from "../../kroma/animacion/notificaciones.js";

const total = (pistas) => pistas.reduce((s, p) => s + (p.duracion || 0), 0);

/**
 * Cabecera grande con carátula y degradado del color dominante.
 */
export function cabecera({ tipo, titulo, imagen, color, lineas = [], acciones = [] }) {
  const h = crear("header", { clase: "cabecera-vista" }, [
    crear("div", { clase: "cabecera-imagen" }, [imagen]),
    crear("div", { clase: "cabecera-textos" }, [
      crear("span", { clase: "cabecera-tipo", texto: tipo }),
      crear("h1", { texto: titulo, clase: titulo.length > 22 ? "largo" : "" }),
      crear("p", { clase: "cabecera-lineas" }, lineas.flatMap((l, i) => (i ? [crear("span", { clase: "punto", texto: "•" }), l] : [l]))),
    ]),
  ]);
  const vista = crear("div", { clase: "vista-coleccion" }, [h, crear("div", { clase: "acciones-vista" }, acciones)]);
  if (color) vista.style.setProperty("--color-vista", color.principal);
  return vista;
}

/** Botones grandes "Reproducir" y "Aleatorio". */
function botonesReproducir(pistas, extra = []) {
  return [
    crear("button", { clase: "boton-play-grande", icono: "play", titulo: "Reproducir", atributos: pistas.length ? {} : { disabled: "" }, eventos: { click: () => reproducirTodo(pistas) } }),
    botonIcono("aleatorio", "Reproducir en aleatorio", () => reproducirTodo(pistas, { aleatorio: true }), "boton-icono--grande"),
    ...extra,
  ];
}

// ── Canciones ────────────────────────────────────────────────────────

const ORDENES = {
  album: ["Álbum", null],
  titulo: ["Título", (a, b) => normalizar(a.titulo).localeCompare(normalizar(b.titulo))],
  artista: ["Artista", (a, b) => normalizar(a.artista).localeCompare(normalizar(b.artista))],
  recientes: ["Añadidas recientemente", (a, b) => b.fechaAlta - a.fechaAlta],
  escuchadas: ["Más escuchadas", (a, b) => b.reproducciones - a.reproducciones],
  duracion: ["Duración", (a, b) => a.duracion - b.duracion],
};

export function vistaCanciones({ favoritos = false } = {}) {
  const todas = favoritos ? biblioteca.favoritas() : biblioteca.canciones();
  const raiz = cabecera({
    tipo: favoritos ? "Lista" : "Biblioteca",
    titulo: favoritos ? "Favoritos" : "Canciones",
    imagen: crear("div", { clase: `portada portada--icono ${favoritos ? "portada--favoritos" : "portada--canciones"}` }, [icono(favoritos ? "corazon" : "nota")]),
    lineas: [plural(todas.length, "canción", "canciones"), duracionLarga(total(todas))],
    acciones: botonesReproducir(todas),
  });
  raiz.style.setProperty("--color-vista", favoritos ? "#7b5cff" : "#2de1c2");

  if (!todas.length) {
    raiz.append(
      favoritos
        ? vacio("corazonVacio", "Aún no tienes favoritos", "Pulsa el corazón de cualquier canción para guardarla aquí.")
        : vacio("nota", "Tu biblioteca está vacía", "Importa canciones o una carpeta entera para empezar.", { texto: "Importar música", fn: () => app.importar() }),
    );
    return raiz;
  }

  const filtro = crear("input", { clase: "campo campo--filtro", atributos: { type: "search", placeholder: "Filtrar…", "aria-label": "Filtrar canciones" } });
  const orden = crear("select", { clase: "campo campo--compacto", atributos: { "aria-label": "Ordenar" } }, Object.entries(ORDENES).map(([k, [n]]) => crear("option", { texto: n, atributos: { value: k } })));
  const contenedor = crear("div");
  const pintar = () => {
    const q = normalizar(filtro.value);
    let pistas = todas.filter((p) => !q || normalizar(`${p.titulo} ${p.artista} ${p.album}`).includes(q));
    const fn = ORDENES[orden.value][1];
    if (fn) pistas = [...pistas].sort(fn);
    contenedor.replaceChildren(pistas.length ? tablaPistas(pistas) : crear("p", { clase: "nada", texto: "Nada coincide con el filtro." }));
  };
  filtro.addEventListener("input", pintar);
  orden.addEventListener("change", pintar);
  raiz.querySelector(".acciones-vista").append(crear("div", { clase: "acciones-derecha" }, [filtro, orden]));
  raiz.append(contenedor);
  pintar();
  return raiz;
}

// ── Álbumes ──────────────────────────────────────────────────────────

export function vistaAlbumes() {
  const albumes = biblioteca.albumes();
  return crear("div", { clase: "vista-rejilla" }, [
    crear("h1", { clase: "titulo-vista", texto: "Álbumes" }),
    albumes.length ? crear("div", { clase: "rejilla" }, albumes.map(tarjetaAlbum)) : vacio("disco", "No hay álbumes", "Los álbumes salen de las etiquetas de tus canciones."),
  ]);
}

export function vistaAlbum(id) {
  const a = biblioteca.album(id);
  if (!a) return vacio("disco", "Álbum no encontrado", "Puede que lo hayas eliminado.");
  const artista = biblioteca.artistas().find((x) => normalizar(x.nombre) === normalizar(a.artista));
  const raiz = cabecera({
    tipo: "Álbum",
    titulo: a.titulo,
    imagen: portada(a.conPortada),
    color: biblioteca.colorDe(a.conPortada),
    lineas: [artista ? enlace(a.artista, `#/artista/${artista.id}`, "enlace enlace--fuerte") : a.artista, a.anio, plural(a.pistas.length, "canción", "canciones"), duracionLarga(a.duracion)].filter(Boolean),
    acciones: botonesReproducir(a.pistas, [
      botonIcono("opciones", "Más opciones", (e) =>
        abrirMenu(e, [
          { icono: "cola", texto: "Añadir a la cola", accion: () => app.motor.anadirAlFinal(a.pistas.map((p) => p.id)) },
          { icono: "anadirLista", texto: "Añadir a una lista", submenu: submenuListas(a.pistas.map((p) => p.id)) },
          "-",
          { icono: "borrar", texto: "Eliminar el álbum", peligro: true, accion: () => eliminar(a.pistas) },
        ]),
      ),
    ]),
  });
  raiz.append(tablaPistas(a.pistas, { album: false, numeroPista: true }));
  const otros = artista?.albumes.filter((x) => x.id !== a.id) ?? [];
  if (otros.length) raiz.append(estante(`Más de ${a.artista}`, otros.map(tarjetaAlbum)));
  return raiz;
}

// ── Artistas ─────────────────────────────────────────────────────────

export function vistaArtistas() {
  const artistas = biblioteca.artistas();
  return crear("div", { clase: "vista-rejilla" }, [
    crear("h1", { clase: "titulo-vista", texto: "Artistas" }),
    artistas.length ? crear("div", { clase: "rejilla" }, artistas.map(tarjetaArtista)) : vacio("persona", "No hay artistas", "Importa música para verlos aquí."),
  ]);
}

export function vistaArtista(id) {
  const a = biblioteca.artista(id);
  if (!a) return vacio("persona", "Artista no encontrado", "");
  const canciones = a.pistas.filter((p) => p.tipo === "audio");
  const videos = a.pistas.filter((p) => p.tipo === "video");
  const escuchas = a.pistas.reduce((s, p) => s + (p.reproducciones || 0), 0);
  const raiz = cabecera({
    tipo: "Artista",
    titulo: a.nombre,
    imagen: portada(a.conPortada, { redonda: true }),
    color: biblioteca.colorDe(a.conPortada),
    lineas: [plural(canciones.length, "canción", "canciones"), videos.length ? plural(videos.length, "vídeo") : "", plural(escuchas, "reproducción", "reproducciones")].filter(Boolean),
    acciones: botonesReproducir(a.pistas),
  });
  raiz.classList.add("vista-artista");
  if (canciones.length) raiz.append(crear("h2", { clase: "subtitulo-vista", texto: "Populares" }), tablaPistas(canciones.slice(0, 5)));
  if (a.albumes.length) raiz.append(estante("Discografía", a.albumes.map(tarjetaAlbum)));
  if (videos.length) raiz.append(estante("Vídeos", videos.map((v) => tarjetaVideo(v, videos)), { clase: "estante--videos" }));
  return raiz;
}

// ── Vídeos ───────────────────────────────────────────────────────────

export function vistaVideos() {
  const videos = biblioteca.videos();
  const empezados = videos.filter((v) => v.posicion > 5);
  return crear("div", { clase: "vista-rejilla" }, [
    crear("h1", { clase: "titulo-vista", texto: "Vídeos" }),
    empezados.length ? estante("Continuar viendo", empezados.map((v) => tarjetaVideo(v, videos)), { clase: "estante--videos" }) : "",
    videos.length
      ? crear("div", { clase: "rejilla rejilla--videos" }, videos.map((v) => tarjetaVideo(v, videos)))
      : vacio("video", "No hay vídeos", "Importa archivos MP4 o WebM. Si tienen subtítulos con el mismo nombre (.srt / .vtt) se añaden solos.", { texto: "Importar vídeos", fn: () => app.importar() }),
  ]);
}

// ── Listas ───────────────────────────────────────────────────────────

export function vistaLista(id) {
  const lista = biblioteca.listas.get(id);
  if (!lista) return vacio("lista", "Lista no encontrada", "Puede que la hayas borrado.");
  const pistas = biblioteca.pistasDeLista(lista);
  const renombrar = async () => {
    const nombre = await pedirTexto("Renombrar lista", lista.nombre);
    if (nombre) await biblioteca.guardarLista({ ...lista, nombre });
  };
  const raiz = cabecera({
    tipo: "Lista de reproducción",
    titulo: lista.nombre,
    imagen: mosaico(pistas),
    color: biblioteca.colorDe(pistas.find((p) => p.color)),
    lineas: [plural(pistas.length, "elemento"), duracionLarga(total(pistas))],
    acciones: botonesReproducir(pistas, [
      botonIcono("opciones", "Más opciones", (e) =>
        abrirMenu(e, [
          { icono: "editar", texto: "Renombrar", accion: renombrar },
          { icono: "cola", texto: "Añadir a la cola", accion: () => app.motor.anadirAlFinal(lista.pistas) },
          "-",
          {
            icono: "borrar",
            texto: "Eliminar lista",
            peligro: true,
            accion: async () => {
              if (!(await confirmar("Eliminar lista", `¿Eliminar «${lista.nombre}»? Las canciones seguirán en tu biblioteca.`))) return;
              await biblioteca.eliminarLista(lista.id);
              app.navegar("#/");
              notificar("Lista eliminada", { duracion: 1800 });
            },
          },
        ]),
      ),
    ]),
  });
  raiz.querySelector("h1").addEventListener("dblclick", renombrar);
  raiz.querySelector("h1").title = "Doble clic para renombrar";
  raiz.append(
    pistas.length
      ? tablaPistas(pistas, { lista })
      : vacio("anadirLista", "Esta lista está vacía", "Arrastra canciones a la lista desde el menú lateral, o usa clic derecho › «Añadir a una lista»."),
  );
  return raiz;
}

export function vistaListas() {
  const listas = biblioteca.listasOrdenadas();
  return crear("div", { clase: "vista-rejilla" }, [
    crear("div", { clase: "titulo-con-accion" }, [crear("h1", { clase: "titulo-vista", texto: "Listas" }), crear("button", { clase: "boton", icono: "mas", eventos: { click: () => nuevaLista() } }, [" Nueva lista"])]),
    listas.length ? crear("div", { clase: "rejilla" }, listas.map(tarjetaLista)) : vacio("lista", "Sin listas todavía", "Crea una lista y arrastra canciones a ella.", { texto: "Crear lista", fn: () => nuevaLista() }),
  ]);
}

// ── Buscar ───────────────────────────────────────────────────────────

export function vistaBuscar(consulta) {
  const raiz = crear("div", { clase: "vista-rejilla vista-buscar" });
  if (!consulta) {
    // Sin búsqueda: explorar por géneros (tarjetas con color)
    const generos = new Map();
    for (const p of biblioteca.pistas.values()) if (p.genero) generos.set(p.genero, [...(generos.get(p.genero) ?? []), p]);
    raiz.append(
      crear("h1", { clase: "titulo-vista", texto: "Explorar" }),
      crear("p", { clase: "texto-suave", texto: "Escribe arriba o pulsa Ctrl + K para buscar en toda tu biblioteca." }),
      crear(
        "div",
        { clase: "generos" },
        [...generos].map(([g, pistas]) => {
          const color = biblioteca.colorDe(pistas.find((p) => p.color));
          return crear(
            "button",
            {
              clase: "genero",
              atributos: { style: `--g:${color?.principal ?? "#7b5cff"}` },
              eventos: { click: () => reproducirTodo(pistas, { aleatorio: true }) },
            },
            [crear("strong", { texto: g }), crear("span", { texto: plural(pistas.length, "canción", "canciones") }), portada(pistas[0])],
          );
        }),
      ),
    );
    return raiz;
  }
  const r = biblioteca.buscar(consulta);
  const hay = r.canciones.length + r.videos.length + r.albumes.length + r.artistas.length;
  raiz.append(crear("h1", { clase: "titulo-vista", texto: `Resultados para «${consulta}»` }));
  if (!hay) {
    raiz.append(vacio("buscar", "Sin resultados", "Prueba con otras palabras. La búsqueda no distingue tildes ni mayúsculas."));
    return raiz;
  }
  if (r.canciones.length) raiz.append(crear("h2", { clase: "subtitulo-vista", texto: "Canciones" }), tablaPistas(r.canciones.slice(0, 20)));
  if (r.artistas.length) raiz.append(estante("Artistas", r.artistas.map(tarjetaArtista)));
  if (r.albumes.length) raiz.append(estante("Álbumes", r.albumes.map(tarjetaAlbum)));
  if (r.videos.length) raiz.append(estante("Vídeos", r.videos.map((v) => tarjetaVideo(v, r.videos)), { clase: "estante--videos" }));
  return raiz;
}
