/**
 * ╔═══════════════════════════════════════════════════════════════╗
 * ║  SERENIA · arranque de la aplicación                          ║
 * ╚═══════════════════════════════════════════════════════════════╝
 *
 * Une todas las piezas: base de datos → biblioteca → motor → interfaz.
 * También se encarga del router (#/ruta), los atajos de teclado globales,
 * importar arrastrando archivos, el vídeo flotante y el color dinámico.
 */

import { app } from "./contexto.js";
import { abrir as abrirBD, bd } from "./datos/bd.js";
import { biblioteca } from "./datos/biblioteca.js";
import { importarArchivos, importarDemo } from "./datos/importador.js";
import { Motor } from "./motor/Motor.js";
import { Barra } from "./ui/Barra.js";
import { Panel } from "./ui/Panel.js";
import { abrirPaleta } from "./ui/Paleta.js";
import { alternarMiniReproductor } from "./ui/MiniReproductor.js";
import { crear, icono, mosaico, botonIcono } from "./ui/dom.js";
import { TIPO_ARRASTRE, marcarSonando } from "./ui/filas.js";
import { alternarFavorito, nuevaLista, reproducirTodo } from "./ui/acciones.js";
import { abrirMenu, cerrarMenu } from "./ui/menus.js";
import { vistaInicio } from "./vistas/inicio.js";
import { vistaCanciones, vistaAlbumes, vistaAlbum, vistaArtistas, vistaArtista, vistaVideos, vistaLista, vistaListas, vistaBuscar } from "./vistas/coleccion.js";
import { vistaAhora } from "./vistas/ahora.js";
import { vistaGrabadora, vistaConversor, vistaDiagnostico, vistaAjustes } from "./vistas/herramientas.js";
import { ReproductorVideo } from "../kroma/reproductores/ReproductorVideo.js";
import { Monitor } from "../kroma/componentes/Monitor.js";
import { notificar } from "../kroma/animacion/notificaciones.js";
import { registro } from "../kroma/nucleo/registro.js";
import { normalizarError } from "../kroma/nucleo/errores.js";
import { cambiarIcono, preferencias } from "../kroma/nucleo/utilidades.js";
import { Kroma } from "../kroma/kroma.js";

const $ = (s) => document.querySelector(s);

// ════════════════════════════════════════════════════════════════════
//  Arranque
// ════════════════════════════════════════════════════════════════════

async function arrancar() {
  if (new URLSearchParams(location.search).has("depurar")) Kroma.depuracion = true;

  try {
    await abrirBD();
    await biblioteca.cargar();
  } catch (error) {
    notificar("No se pudo abrir la base de datos del navegador. La biblioteca no se guardará (¿modo privado?).", { tipo: "error", duracion: 0 });
    registro.error("app", "IndexedDB", error);
  }

  // El <video> vive siempre en el mismo reproductor y se mueve por la interfaz
  const video = crear("video", { atributos: { playsinline: "", preload: "metadata" } });
  $("#aparcamiento").append(video);
  app.video = new ReproductorVideo(video, { notificaciones: false });

  app.motor = new Motor({
    video,
    prepararVideo: (pista, url) =>
      app.video.cargar({
        src: url,
        titulo: pista.titulo,
        subtitulos: pista.subtitulos ?? [],
        capitulos: pista.capitulos,
        idiomaPreferido: app.motor.ajustes.idiomaSubtitulos,
      }),
  });
  // En el DOM (ocultos) para que el monitor de eventos también vea los <audio> del motor
  $("#aparcamiento").append(...app.motor.audios);
  app.monitor = crear("div");
  new Monitor(app.monitor);

  app.navegar = (ruta) => (location.hash = ruta);
  app.importar = abrirSelector;
  app.cargarDemo = cargarDemo;
  app.miniReproductor = alternarMiniReproductor;
  app.aplicarColor = aplicarColor;

  new Barra($("#barra"));
  const panel = new Panel($("#panel"));
  app.panel = (tipo) => panel.mostrar(tipo);

  construirLateral();
  construirCabecera();
  conectarEventos();
  prepararImportacion();
  prepararVideoFlotante();
  registrarServiceWorker();

  // Primera visita: cargamos la biblioteca de demostración para que no esté vacía
  if (biblioteca.vacia && !(await bd.leerAjuste("demoCargada", false))) {
    await cargarDemo({ primeraVez: true });
  }
  await app.motor.restaurar();
  aplicarColor();
  await pintarVista();
  document.body.classList.add("lista");
}

// ════════════════════════════════════════════════════════════════════
//  Router
// ════════════════════════════════════════════════════════════════════

const RUTAS = [
  [/^#?\/?$/, () => vistaInicio(), "inicio"],
  [/^#\/canciones$/, () => vistaCanciones(), "canciones"],
  [/^#\/favoritos$/, () => vistaCanciones({ favoritos: true }), "favoritos"],
  [/^#\/albumes$/, () => vistaAlbumes(), "albumes"],
  [/^#\/album\/(.+)$/, (id) => vistaAlbum(id), "albumes"],
  [/^#\/artistas$/, () => vistaArtistas(), "artistas"],
  [/^#\/artista\/(.+)$/, (id) => vistaArtista(id), "artistas"],
  [/^#\/videos$/, () => vistaVideos(), "videos"],
  [/^#\/listas$/, () => vistaListas(), "listas"],
  [/^#\/lista\/(.+)$/, (id) => vistaLista(id), "lista"],
  [/^#\/buscar(?:\?q=(.*))?$/, (q) => vistaBuscar(decodeURIComponent(q ?? "")), "buscar"],
  [/^#\/ahora$/, () => vistaAhora(), "ahora"],
  [/^#\/grabadora$/, () => vistaGrabadora(), "grabadora"],
  [/^#\/conversor$/, () => vistaConversor(), "conversor"],
  [/^#\/diagnostico$/, () => vistaDiagnostico(app.monitor), "diagnostico"],
  [/^#\/ajustes$/, () => vistaAjustes(), "ajustes"],
];

let vistaActual = null;
let rutaActual = null;

async function pintarVista({ mantenerScroll = false } = {}) {
  const hash = location.hash || "#/";
  let encontrada = RUTAS.find(([re]) => re.test(hash));
  if (!encontrada) encontrada = RUTAS[0];
  const [re, fn, seccion] = encontrada;
  const params = hash.match(re).slice(1);

  const contenedor = $("#vista");
  const scroll = mantenerScroll ? $("#principal").scrollTop : 0;
  vistaActual?._limpiar?.();
  cerrarMenu();

  let nueva;
  try {
    nueva = await fn(...params);
  } catch (error) {
    registro.error("router", hash, error);
    nueva = crear("div", { clase: "vacio" }, [crear("h3", { texto: "Algo ha fallado al abrir esta sección" }), crear("p", { texto: normalizarError(error).message })]);
  }
  // Si mientras se preparaba la vista el usuario ya navegó a otra, la descartamos
  if ((location.hash || "#/") !== hash) return nueva?._limpiar?.();

  vistaActual = nueva;
  const cambioDeRuta = rutaActual !== hash;
  rutaActual = hash;
  contenedor.replaceChildren(nueva);
  contenedor.dataset.seccion = seccion;
  document.body.dataset.seccion = seccion;
  if (cambioDeRuta) {
    contenedor.classList.remove("entrando");
    void contenedor.offsetWidth;
    contenedor.classList.add("entrando");
  }
  $("#principal").scrollTop = scroll;
  $("#principal").style.setProperty("--color-vista", nueva.style?.getPropertyValue("--color-vista") || "");

  // Menú lateral: marcamos la sección activa
  document.querySelectorAll(".lateral a[href]").forEach((a) => a.classList.toggle("activo", a.getAttribute("href") === hash || (a.dataset.seccion === seccion && seccion !== "lista")));
  colocarVideo();
  marcarSonando();
}

// ════════════════════════════════════════════════════════════════════
//  Menú lateral y cabecera
// ════════════════════════════════════════════════════════════════════

function construirLateral() {
  const enlace = (ruta, nombreIcono, texto, seccion) => crear("a", { atributos: { href: ruta }, datos: { seccion } }, [icono(nombreIcono), crear("span", { texto })]);
  const listas = crear("div", { clase: "lateral-listas" });

  const pintarListas = () => {
    listas.replaceChildren(
      ...biblioteca.listasOrdenadas().map((l) => {
        const a = crear("a", { clase: "lateral-lista", atributos: { href: `#/lista/${l.id}` } }, [mosaico(biblioteca.pistasDeLista(l), "portada--mini"), crear("span", {}, [crear("strong", { texto: l.nombre }), crear("small", { texto: `Lista · ${l.pistas.length}` })])]);
        // Soltar canciones encima de una lista = añadirlas
        a.addEventListener("dragover", (e) => {
          if (!e.dataTransfer.types.includes(TIPO_ARRASTRE)) return;
          e.preventDefault();
          a.classList.add("soltar-encima");
        });
        a.addEventListener("dragleave", () => a.classList.remove("soltar-encima"));
        a.addEventListener("drop", async (e) => {
          e.preventDefault();
          a.classList.remove("soltar-encima");
          const ids = JSON.parse(e.dataTransfer.getData(TIPO_ARRASTRE) || "[]");
          const n = await biblioteca.anadirALista(l.id, ids);
          notificar(n ? `Añadido a «${l.nombre}»` : `Ya estaba en «${l.nombre}»`, { tipo: n ? "exito" : "info", duracion: 1800 });
        });
        a.addEventListener("contextmenu", (e) => {
          e.preventDefault();
          abrirMenu(e, [
            { icono: "play", texto: "Reproducir", accion: () => reproducirTodo(biblioteca.pistasDeLista(l)) },
            { icono: "aleatorio", texto: "Aleatorio", accion: () => reproducirTodo(biblioteca.pistasDeLista(l), { aleatorio: true }) },
          ]);
        });
        return a;
      }),
    );
    document.querySelectorAll(".lateral a[href]").forEach((a) => a.classList.toggle("activo", a.getAttribute("href") === (location.hash || "#/")));
  };
  biblioteca.addEventListener("cambio", (e) => e.detail.tipo !== "historial" && pintarListas());

  $("#lateral").append(
    crear("a", { clase: "logo", atributos: { href: "#/", "aria-label": "Serenia, inicio" } }, [crear("span", { clase: "logo-marca" }, [icono("play")]), crear("span", { clase: "logo-texto" }, ["Serenia", crear("small", { texto: "música · vídeo" })])]),
    crear("nav", { clase: "lateral-nav", atributos: { "aria-label": "Principal" } }, [
      enlace("#/", "inicio", "Inicio", "inicio"),
      enlace("#/buscar", "buscar", "Buscar", "buscar"),
      enlace("#/ahora", "expandir", "Ahora suena", "ahora"),
    ]),
    crear("nav", { clase: "lateral-nav lateral-biblioteca", atributos: { "aria-label": "Biblioteca" } }, [
      crear("h2", { texto: "Biblioteca" }),
      enlace("#/canciones", "nota", "Canciones", "canciones"),
      enlace("#/albumes", "disco", "Álbumes", "albumes"),
      enlace("#/artistas", "persona", "Artistas", "artistas"),
      enlace("#/videos", "video", "Vídeos", "videos"),
      enlace("#/favoritos", "corazon", "Favoritos", "favoritos"),
    ]),
    crear("div", { clase: "lateral-listas-cabecera" }, [crear("a", { atributos: { href: "#/listas" }, datos: { seccion: "listas" } }, [crear("h2", { texto: "Tus listas" })]), botonIcono("mas", "Nueva lista", () => nuevaLista())]),
    listas,
    crear("nav", { clase: "lateral-nav lateral-herramientas", atributos: { "aria-label": "Herramientas" } }, [
      enlace("#/grabadora", "micro", "Grabadora", "grabadora"),
      enlace("#/conversor", "herramientas", "Conversor", "conversor"),
      enlace("#/diagnostico", "diagnostico", "Diagnóstico", "diagnostico"),
      enlace("#/ajustes", "ajustes", "Ajustes", "ajustes"),
    ]),
  );
  pintarListas();
}

function construirCabecera() {
  const buscador = crear("input", {
    clase: "buscador-entrada",
    atributos: { type: "search", placeholder: "¿Qué quieres escuchar?", "aria-label": "Buscar en la biblioteca" },
  });
  let espera;
  buscador.addEventListener("input", () => {
    clearTimeout(espera);
    espera = setTimeout(() => location.replace(`#/buscar?q=${encodeURIComponent(buscador.value)}`), 180);
  });
  buscador.addEventListener("focus", () => !location.hash.startsWith("#/buscar") && (location.hash = "#/buscar"));
  window.addEventListener("hashchange", () => {
    if (!location.hash.startsWith("#/buscar")) buscador.value = "";
  });

  $("#cabecera").append(
    crear("div", { clase: "cabecera-nav" }, [botonIcono("izquierda", "Atrás (Alt + ←)", () => history.back()), botonIcono("derecha", "Adelante (Alt + →)", () => history.forward())]),
    crear("label", { clase: "buscador" }, [icono("buscar"), buscador, crear("kbd", { texto: "Ctrl K", titulo: "Abrir la paleta de comandos", eventos: { click: (e) => (e.preventDefault(), abrirPaleta()) } })]),
    crear("div", { clase: "cabecera-acciones" }, [
      crear("button", { clase: "boton boton--suave", icono: "subir", titulo: "Importar archivos o carpetas", eventos: { click: (e) => abrirMenu(e.currentTarget, [{ icono: "subir", texto: "Importar archivos…", accion: () => abrirSelector() }, { icono: "carpeta", texto: "Importar una carpeta…", accion: () => abrirSelector({ carpeta: true }) }, "-", { icono: "disco", texto: "Cargar la biblioteca de demo", accion: () => cargarDemo() }]) } }, [crear("span", { texto: "Importar" })]),
      crear("button", { clase: "boton-icono boton-instalar", icono: "instalar", titulo: "Instalar como aplicación", atributos: { hidden: "" }, eventos: { click: () => app.instalar?.() } }),
      crear("button", { clase: "boton-icono boton-tema", icono: temaActual() === "oscuro" ? "sol" : "luna", titulo: "Cambiar entre tema claro y oscuro", eventos: { click: () => fijarTema(temaActual() === "oscuro" ? "claro" : "oscuro") } }),
    ]),
  );
}

// ════════════════════════════════════════════════════════════════════
//  Eventos globales
// ════════════════════════════════════════════════════════════════════

function conectarEventos() {
  const m = app.motor;
  window.addEventListener("hashchange", () => pintarVista());

  // Repintar cuando cambia la biblioteca (sin perder el scroll)
  let pendiente;
  biblioteca.addEventListener("cambio", (e) => {
    const seccion = document.body.dataset.seccion;
    if (e.detail.tipo === "historial" && seccion !== "inicio") return;
    // Las herramientas no se repintan: se perdería lo que el usuario está haciendo
    if (["grabadora", "conversor", "diagnostico", "ajustes"].includes(seccion)) return;
    clearTimeout(pendiente);
    pendiente = setTimeout(() => pintarVista({ mantenerScroll: true }), 120);
  });

  m.addEventListener("pista", () => {
    marcarSonando();
    aplicarColor();
    actualizarTitulo();
    if (document.body.dataset.seccion === "ahora") pintarVista();
    else colocarVideo();
  });
  m.addEventListener("estado", () => {
    actualizarTitulo();
    colocarVideo(); // si se da al play a un vídeo desde otra vista, aparece flotante
  });
  m.addEventListener("error", (e) => {
    const { error, pista } = e.detail;
    notificar(error.message, {
      tipo: "error",
      titulo: pista ? `No se puede reproducir «${pista.titulo}»` : "Error de reproducción",
      accion: m.siguienteId ? { texto: "Saltar a la siguiente", fn: () => m.siguiente() } : undefined,
    });
  });

  // ── Atajos de teclado
  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      return abrirPaleta();
    }
    const enCampo = e.target.closest?.("input, textarea, select, [contenteditable], dialog");
    // El reproductor de vídeo tiene sus propios atajos cuando tiene el foco
    if (enCampo || e.defaultPrevented || e.target.closest?.(".kr-video") || e.ctrlKey || e.metaKey) return;
    const tecla = e.key.toLowerCase();
    const acciones = {
      " ": () => m.alternar(),
      k: () => m.alternar(),
      "/": () => abrirPaleta(),
      arrowleft: () => (e.shiftKey ? m.anterior() : e.altKey ? null : m.saltar(-5)),
      arrowright: () => (e.shiftKey ? m.siguiente() : e.altKey ? null : m.saltar(5)),
      arrowup: () => m.fijarVolumen(m.ajustes.volumen + 0.05),
      arrowdown: () => m.fijarVolumen(m.ajustes.volumen - 0.05),
      m: () => m.alternarSilencio(),
      s: () => m.alternarAleatorio(),
      r: () => m.cambiarRepetir(),
      l: () => app.panel("letra"),
      q: () => app.panel("cola"),
      f: () => m.pista && alternarFavorito(m.pista),
    };
    const accion = acciones[tecla];
    if (!accion || (tecla === " " && e.target.closest("button, a"))) return;
    if (e.altKey && (tecla === "arrowleft" || tecla === "arrowright")) return; // atrás/adelante del navegador
    e.preventDefault();
    accion();
  });
}

function actualizarTitulo() {
  const p = app.motor.pista;
  document.title = p ? `${app.motor.reproduciendo ? "▶ " : ""}${p.titulo} · ${p.artista} — Serenia` : "Serenia";
}

// ── Tema claro / oscuro ──────────────────────────────────────────────

const temaActual = () => document.documentElement.dataset.tema;

/** "claro", "oscuro" o "auto" (el del sistema). index.html lo aplica antes de pintar. */
function fijarTema(tema) {
  preferencias.guardar("tema", tema === "auto" ? null : tema);
  const efectivo = tema === "auto" ? (matchMedia("(prefers-color-scheme: dark)").matches ? "oscuro" : "claro") : tema;
  document.documentElement.dataset.tema = efectivo;
  const boton = document.querySelector(".boton-tema");
  if (boton) cambiarIcono(boton, efectivo === "oscuro" ? "sol" : "luna");
  aplicarColor();
  // Los canvas (visualizador, ondas) leen los colores al pintar: repintamos la vista
  pintarVista({ mantenerScroll: true });
}
app.fijarTema = fijarTema;

// ── Color dinámico ───────────────────────────────────────────────────

let colorDinamico = false;
async function aplicarColor() {
  // Por defecto manda el rosa de la marca; el color de la carátula es opcional (Ajustes)
  colorDinamico = await bd.leerAjuste("colorDinamico", false);
  const color = colorDinamico ? biblioteca.colorDe(app.motor.pista) : null;
  const s = document.body.style;
  if (color) {
    s.setProperty("--acento", color.principal);
    s.setProperty("--acento-oscuro", color.oscuro);
    s.setProperty("--acento-texto", color.claro ? "#14101a" : "#ffffff");
  } else {
    s.removeProperty("--acento");
    s.removeProperty("--acento-oscuro");
    s.removeProperty("--acento-texto");
  }
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", temaActual() === "oscuro" ? "#0b1020" : "#f4f6fc");
  document.getElementById("favicon")?.setAttribute("href", `iconos/logo-${temaActual()}.svg`);
}

// ════════════════════════════════════════════════════════════════════
//  Vídeo: en «Ahora suena» va grande; en el resto de vistas, flotante
// ════════════════════════════════════════════════════════════════════

function prepararVideoFlotante() {
  const dock = $("#video-flotante");
  dock.append(
    crear("div", { clase: "flotante-barra" }, [
      crear("span", { clase: "flotante-titulo" }),
      botonIcono("expandir", "Abrir en grande", () => app.navegar("#/ahora")),
      botonIcono("cerrar", "Cerrar (pausa el vídeo)", () => {
        app.motor.pausar();
        dock.hidden = true;
        dock.dataset.cerrado = "si";
      }),
    ]),
  );
  // Arrastrar la ventanita por la pantalla
  let origen = null;
  dock.querySelector(".flotante-barra").addEventListener("pointerdown", (e) => {
    if (e.target.closest("button")) return;
    const r = dock.getBoundingClientRect();
    origen = { x: e.clientX - r.left, y: e.clientY - r.top };
    dock.setPointerCapture(e.pointerId);
  });
  dock.addEventListener("pointermove", (e) => {
    if (!origen) return;
    dock.style.left = `${Math.max(8, Math.min(innerWidth - dock.offsetWidth - 8, e.clientX - origen.x))}px`;
    dock.style.top = `${Math.max(8, Math.min(innerHeight - dock.offsetHeight - 8, e.clientY - origen.y))}px`;
    dock.style.right = dock.style.bottom = "auto";
  });
  dock.addEventListener("pointerup", () => (origen = null));
  app.motor.addEventListener("pista", () => delete dock.dataset.cerrado);
}

function colocarVideo() {
  const raizVideo = app.video.raiz;
  const esVideo = app.motor.pista?.tipo === "video";
  const hueco = document.querySelector("[data-hueco-video]");
  const dock = $("#video-flotante");
  if (esVideo && hueco) {
    if (raizVideo.parentElement !== hueco) hueco.append(raizVideo);
    dock.hidden = true;
  } else if (esVideo && dock.dataset.cerrado !== "si" && (app.motor.reproduciendo || !dock.hidden)) {
    if (raizVideo.parentElement !== dock) dock.append(raizVideo);
    dock.querySelector(".flotante-titulo").textContent = app.motor.pista.titulo;
    dock.hidden = false;
  } else {
    if (raizVideo.parentElement !== $("#aparcamiento")) $("#aparcamiento").append(raizVideo);
    dock.hidden = true;
  }
}

// ════════════════════════════════════════════════════════════════════
//  Importar
// ════════════════════════════════════════════════════════════════════

function abrirSelector({ carpeta = false } = {}) {
  const input = crear("input", {
    atributos: { type: "file", multiple: "", accept: carpeta ? null : "audio/*,video/*,image/*,.lrc,.srt,.vtt,.mp3,.m4a,.flac,.ogg,.opus,.wav,.mkv", ...(carpeta ? { webkitdirectory: "" } : {}) },
  });
  input.addEventListener("change", () => importarConProgreso([...input.files]));
  input.click();
}

async function importarConProgreso(archivos) {
  if (!archivos.length) return;
  const aviso = notificar("Preparando…", { titulo: "Importando", duracion: 0 });
  try {
    const pistas = await importarArchivos(archivos, (hechos, total, nombre) => aviso.actualizar(total ? `${hechos + 1 > total ? total : hechos + 1} de ${total}${nombre ? ` · ${nombre}` : ""}` : "Nada que importar"));
    if (!pistas.length) {
      notificar("No se encontraron archivos de audio o vídeo compatibles.", { tipo: "aviso" });
      return;
    }
    const { anadidas, duplicadas } = await biblioteca.anadir(pistas);
    const ids = pistas.map((p) => p.id).filter((id) => biblioteca.obtener(id));
    notificar(`${anadidas} añadido(s)${duplicadas ? ` · ${duplicadas} ya estaban` : ""}`, {
      tipo: "exito",
      titulo: "Importación terminada",
      accion: ids.length ? { texto: "Reproducir", fn: () => app.motor.reproducirLista(ids) } : undefined,
    });
  } catch (error) {
    notificar(normalizarError(error).message, { tipo: "error", titulo: "Error al importar" });
  } finally {
    aviso.cerrar();
  }
}

async function cargarDemo({ primeraVez = false } = {}) {
  const capa = primeraVez ? crear("div", { clase: "cargando-demo" }, [crear("div", { clase: "logo-marca logo-marca--grande" }, [icono("play")]), crear("p", { texto: "Preparando tu biblioteca…" }), crear("small")]) : null;
  if (capa) document.body.append(capa);
  const aviso = primeraVez ? null : notificar("Descargando…", { titulo: "Biblioteca de demostración", duracion: 0 });
  try {
    const pistas = await importarDemo((hechos, total, nombre) => {
      const texto = `${Math.min(hechos + 1, total)} de ${total} · ${nombre}`;
      aviso?.actualizar(texto);
      if (capa) capa.querySelector("small").textContent = texto;
    });
    const { anadidas } = await biblioteca.anadir(pistas);
    await bd.guardarAjuste("demoCargada", true);
    if (!primeraVez) notificar(anadidas ? `${anadidas} elementos de demostración añadidos` : "La demo ya estaba en tu biblioteca", { tipo: anadidas ? "exito" : "info" });
  } catch (error) {
    notificar(normalizarError(error).message, { tipo: "error", titulo: "No se pudo cargar la demo" });
  } finally {
    aviso?.cerrar();
    capa?.classList.add("saliendo");
    setTimeout(() => capa?.remove(), 500);
  }
}

/** Arrastrar archivos o carpetas sobre la ventana. */
function prepararImportacion() {
  const capa = $("#soltar");
  let contador = 0;
  // En el conversor los archivos se sueltan en su propia zona, no se importan
  const tieneArchivos = (e) => e.dataTransfer?.types.includes("Files") && document.body.dataset.seccion !== "conversor";
  window.addEventListener("dragenter", (e) => {
    if (!tieneArchivos(e)) return;
    contador++;
    capa.hidden = false;
  });
  window.addEventListener("dragleave", (e) => {
    if (!tieneArchivos(e)) return;
    if (--contador <= 0) (capa.hidden = true), (contador = 0);
  });
  window.addEventListener("dragover", (e) => tieneArchivos(e) && e.preventDefault());
  window.addEventListener("drop", async (e) => {
    if (!tieneArchivos(e)) return;
    e.preventDefault();
    contador = 0;
    capa.hidden = true;
    // Si hay carpetas, las recorremos con la API de entradas del sistema de archivos
    const entradas = [...e.dataTransfer.items].map((i) => i.webkitGetAsEntry?.()).filter(Boolean);
    const archivos = entradas.length ? (await Promise.all(entradas.map(leerEntrada))).flat() : [...e.dataTransfer.files];
    importarConProgreso(archivos);
  });
}

async function leerEntrada(entrada, ruta = "") {
  if (entrada.isFile) {
    const archivo = await new Promise((ok, mal) => entrada.file(ok, mal));
    // Guardamos la ruta relativa para emparejar carátulas de carpeta
    Object.defineProperty(archivo, "webkitRelativePath", { value: `${ruta}${archivo.name}` });
    return [archivo];
  }
  const lector = entrada.createReader();
  const hijos = [];
  // readEntries devuelve los elementos por tandas: hay que llamar hasta que venga vacío
  for (;;) {
    const tanda = await new Promise((ok, mal) => lector.readEntries(ok, mal));
    if (!tanda.length) break;
    hijos.push(...tanda);
  }
  return (await Promise.all(hijos.map((h) => leerEntrada(h, `${ruta}${entrada.name}/`)))).flat();
}

// ════════════════════════════════════════════════════════════════════
//  PWA: instalable y con funcionamiento sin conexión
// ════════════════════════════════════════════════════════════════════

function registrarServiceWorker() {
  if ("serviceWorker" in navigator && location.protocol !== "file:") {
    navigator.serviceWorker.register("sw.js").catch((e) => registro.aviso("app", "Service worker no registrado", e));
  }
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    const boton = document.querySelector(".boton-instalar");
    boton.hidden = false;
    app.instalar = async () => {
      e.prompt();
      const { outcome } = await e.userChoice;
      if (outcome === "accepted") boton.hidden = true;
      app.instalar = null;
    };
  });
}

arrancar().catch((error) => {
  registro.error("app", "Fallo al arrancar", error);
  // Lo dejamos anotado para el recuadro de diagnóstico de index.html
  window.__erroresArranque?.push(`${error.name}: ${error.message}\n${(error.stack ?? "").split("\n").slice(0, 4).join("\n")}`);
  notificar(`${error.name}: ${error.message}`, { tipo: "error", titulo: "Serenia no pudo arrancar", duracion: 0 });
});

// Para depurar desde la consola: app.motor, app.video…
window.Serenia = { app, biblioteca, bd };
