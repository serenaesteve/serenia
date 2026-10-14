/**
 * Serenia · "Ahora suena"
 *
 * Música: carátula gigante, fondo teñido con su color, letra karaoke o
 * visualizador a pantalla completa.
 * Vídeo: el reproductor de vídeo de Kroma (efectos, subtítulos, capítulos…)
 * con la información y lo que viene después.
 */

import { app } from "../contexto.js";
import { biblioteca } from "../datos/biblioteca.js";
import { crear, icono, portada, formatearTiempo, enlace, botonIcono, vacio } from "../ui/dom.js";
import { alternarFavorito, menuPista, normalizarClave, informacion, submenuListas } from "../ui/acciones.js";
import { abrirMenu } from "../ui/menus.js";
import { Letra } from "../ui/Letra.js";
import { Visualizador, MODOS_VISUALIZADOR } from "../../kroma/animacion/visualizador.js";
import { PistaSubtitulos } from "../../kroma/subtitulos/subtitulos.js";
import { preferencias } from "../../kroma/nucleo/utilidades.js";

export function vistaAhora() {
  const m = app.motor;
  const p = m.pista;
  if (!p) return vacio("nota", "No suena nada", "Elige una canción o un vídeo de tu biblioteca.", { texto: "Ir a la biblioteca", fn: () => app.navegar("#/canciones") });
  return p.tipo === "video" ? ahoraVideo(p) : ahoraAudio(p);
}

/** Fondo con la carátula desenfocada y manchas de color que se mueven. */
function fondo(p) {
  const url = biblioteca.urlPortada(p);
  return crear("div", { clase: "ahora-fondo", atributos: { "aria-hidden": "true" } }, [
    url ? crear("img", { atributos: { src: url, alt: "" } }) : "",
    crear("span"),
    crear("span"),
  ]);
}

function ahoraAudio(p) {
  const m = app.motor;
  const color = biblioteca.colorDe(p);
  const album = biblioteca.albumDe(p);
  const siguiente = biblioteca.obtener(m.siguienteId);
  const limpiezas = [];

  const fav = botonIcono(p.favorito ? "corazon" : "corazonVacio", p.favorito ? "Quitar de favoritos" : "Añadir a favoritos", () => alternarFavorito(p), `fav${p.favorito ? " activo" : ""}`);

  // Pestañas de la derecha: letra / visualizador
  const zona = crear("div", { clase: "ahora-zona" });
  let modo = preferencias.leer("ahora-modo", p.letra ? "letra" : "visualizador");
  if (modo === "letra" && !p.letra) modo = "visualizador";
  const pestanas = crear("div", { clase: "pestanas" });
  let limpiarZona = null;

  const mostrar = (nuevo) => {
    modo = nuevo;
    preferencias.guardar("ahora-modo", nuevo);
    limpiarZona?.();
    zona.replaceChildren();
    pestanas.querySelectorAll("button").forEach((b) => b.classList.toggle("activo", b.dataset.modo === nuevo));
    if (nuevo === "letra") {
      const letra = new Letra(zona, { grande: true });
      limpiarZona = () => letra.destruir();
    } else {
      const lienzo = crear("canvas", { clase: "ahora-visualizador" });
      const tipos = crear(
        "div",
        { clase: "chips chips--flotantes" },
        Object.entries(MODOS_VISUALIZADOR).map(([k, nombre]) =>
          crear("button", {
            clase: `chip${preferencias.leer("visualizador", "circular") === k ? " activo" : ""}`,
            texto: nombre,
            eventos: {
              click: (e) => {
                vis.modo = k;
                preferencias.guardar("visualizador", k);
                tipos.querySelectorAll(".chip").forEach((c) => c.classList.toggle("activo", c === e.currentTarget));
              },
            },
          }),
        ),
      );
      zona.append(lienzo, tipos);
      const vis = new Visualizador(lienzo, () => m.analisis, { modo: preferencias.leer("visualizador", "circular"), barras: 72 });
      vis.iniciar();
      limpiarZona = () => vis.destruir();
    }
  };
  pestanas.append(
    crear("button", { clase: "pestana", texto: "Letra", datos: { modo: "letra" }, atributos: p.letra ? {} : { disabled: "", title: "Esta canción no tiene letra" }, eventos: { click: () => mostrar("letra") } }),
    crear("button", { clase: "pestana", texto: "Visualizador", datos: { modo: "visualizador" }, eventos: { click: () => mostrar("visualizador") } }),
  );

  const raiz = crear("div", { clase: "vista-ahora" }, [
    fondo(p),
    crear("div", { clase: "ahora-izquierda" }, [
      crear("div", { clase: "ahora-portada" }, [portada(p)]),
      crear("div", { clase: "ahora-info" }, [
        crear("div", {}, [
          crear("h1", { texto: p.titulo }),
          crear("p", {}, [
            enlace(p.artista, `#/artista/${encodeURIComponent(normalizarClave(p.artista))}`, "enlace enlace--fuerte"),
            album ? crear("span", { texto: " · " }) : "",
            album ? enlace(p.album, `#/album/${album.id}`) : "",
          ]),
        ]),
        crear("div", { clase: "ahora-botones" }, [
          fav,
          botonIcono("anadirLista", "Añadir a una lista", (e) => abrirMenu(e, submenuListas([p.id]))),
          botonIcono("opciones", "Más opciones", (e) => menuPista(e, p)),
        ]),
      ]),
      crear("p", { clase: "ahora-tecnico" }, [
        `${p.formato}${p.frecuencia ? ` · ${(p.frecuencia / 1000).toFixed(1)} kHz` : ""}${p.canales === 2 ? " · estéreo" : p.canales === 1 ? " · mono" : ""}`,
        m.ajustes.normalizar && p.ganancia ? crear("span", { clase: "chip-mini", texto: `NORMALIZADA ${p.ganancia > 0 ? "+" : ""}${p.ganancia} dB` }) : "",
      ]),
      siguiente
        ? crear("button", { clase: "ahora-siguiente", eventos: { click: () => m.siguiente() } }, [
            crear("small", { texto: "A continuación" }),
            portada(siguiente, { clase: "portada--mini" }),
            crear("span", {}, [crear("strong", { texto: siguiente.titulo }), crear("span", { texto: siguiente.artista })]),
            icono("siguiente"),
          ])
        : "",
    ]),
    crear("div", { clase: "ahora-derecha" }, [pestanas, zona]),
  ]);
  if (color) {
    raiz.style.setProperty("--color-vista", color.principal);
    raiz.style.setProperty("--color-oscuro", color.oscuro);
    // El visualizador toma sus colores de estas variables: así va a juego con la carátula
    raiz.style.setProperty("--kr-acento-1", color.principal);
  }
  // Inclinación 3D de la carátula siguiendo al ratón
  const caja = raiz.querySelector(".ahora-portada");
  caja.addEventListener("pointermove", (e) => {
    const r = caja.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width - 0.5;
    const y = (e.clientY - r.top) / r.height - 0.5;
    caja.style.setProperty("--rx", `${-y * 10}deg`);
    caja.style.setProperty("--ry", `${x * 12}deg`);
  });
  caja.addEventListener("pointerleave", () => (caja.style.removeProperty("--rx"), caja.style.removeProperty("--ry")));

  mostrar(modo);
  limpiezas.push(() => limpiarZona?.());
  raiz._limpiar = () => limpiezas.forEach((f) => f());
  return raiz;
}

function ahoraVideo(p) {
  const m = app.motor;
  const color = biblioteca.colorDe(p);
  const siguientes = m.ids.slice(m.indice + 1, m.indice + 8).map((id) => biblioteca.obtener(id)).filter(Boolean);
  const hueco = crear("div", { clase: "hueco-video", datos: { huecoVideo: "" } });

  const capitulos = crear("ol", { clase: "capitulos" });
  if (p.capitulos) {
    new PistaSubtitulos({ texto: p.capitulos }).cargar().then((pista) => {
      capitulos.replaceChildren(
        ...pista.frases.map((c, i) =>
          crear("li", { eventos: { click: () => (m.irA(c.inicio), m.reproducir()) } }, [crear("span", { clase: "capitulo-n", texto: i + 1 }), crear("strong", { texto: c.texto }), crear("span", { texto: formatearTiempo(c.inicio) })]),
        ),
      );
    });
  }

  const raiz = crear("div", { clase: "vista-ahora-video" }, [
    crear("div", { clase: "video-principal" }, [
      hueco,
      crear("div", { clase: "video-info" }, [
        crear("div", {}, [
          crear("h1", { texto: p.titulo }),
          crear("p", { clase: "texto-suave" }, [
            enlace(p.artista, `#/artista/${encodeURIComponent(normalizarClave(p.artista))}`, "enlace enlace--fuerte"),
            ` · ${p.ancho}×${p.alto} · ${formatearTiempo(p.duracion)}${p.subtitulos?.length ? ` · subtítulos: ${p.subtitulos.map((s) => s.etiqueta).join(", ")}` : ""}`,
          ]),
        ]),
        crear("div", { clase: "ahora-botones" }, [
          botonIcono(p.favorito ? "corazon" : "corazonVacio", "Favorito", () => alternarFavorito(p), `fav${p.favorito ? " activo" : ""}`),
          botonIcono("efectos", "Efectos de vídeo (E)", () => app.video.alternarPanel()),
          botonIcono("info", "Información", () => informacion(p)),
          botonIcono("opciones", "Más opciones", (e) => menuPista(e, p)),
        ]),
      ]),
      crear("p", { clase: "nota-atajos" }, ["Atajos: ", crear("kbd", { texto: "E" }), " efectos · ", crear("kbd", { texto: "C" }), " subtítulos · ", crear("kbd", { texto: "S" }), " captura · ", crear("kbd", { texto: "F" }), " pantalla completa · ", crear("kbd", { texto: "?" }), " todos"]),
    ]),
    crear("aside", { clase: "video-lateral" }, [
      p.capitulos ? crear("section", {}, [crear("h2", { texto: "Capítulos" }), capitulos]) : "",
      crear("section", {}, [
        crear("h2", { texto: "A continuación" }),
        siguientes.length
          ? crear(
              "ol",
              { clase: "video-siguientes" },
              siguientes.map((s, i) =>
                crear("li", { eventos: { click: () => m.cargar(m.indice + 1 + i) } }, [
                  portada(s, { clase: s.tipo === "video" ? "portada--video" : "portada--mini" }),
                  crear("span", {}, [crear("strong", { texto: s.titulo }), crear("small", { texto: `${s.artista} · ${formatearTiempo(s.duracion)}` })]),
                ]),
              ),
            )
          : crear("p", { clase: "texto-suave", texto: "Nada más en la cola." }),
      ]),
    ]),
  ]);
  if (color) raiz.style.setProperty("--color-vista", color.principal);
  return raiz;
}
