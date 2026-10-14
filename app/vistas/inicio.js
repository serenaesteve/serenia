/**
 * Serenia · inicio
 */

import { app } from "../contexto.js";
import { biblioteca } from "../datos/biblioteca.js";
import { crear, icono, portada, mosaico, plural, duracionLarga, saludo } from "../ui/dom.js";
import { estante, tarjeta, tarjetaAlbum, tarjetaVideo, tarjetaLista } from "../ui/filas.js";
import { reproducirTodo, reproducirEnContexto } from "../ui/acciones.js";

/** Acceso rápido horizontal (como los de la portada de Spotify). */
function acceso(titulo, imagen, ruta, alReproducir) {
  const a = crear("a", { clase: "acceso", atributos: { href: ruta } }, [
    imagen,
    crear("strong", { texto: titulo }),
    alReproducir ? crear("button", { clase: "acceso-play", icono: "play", titulo: `Reproducir ${titulo}`, eventos: { click: (e) => (e.preventDefault(), alReproducir()) } }) : "",
  ]);
  return a;
}

function bienvenida() {
  return crear("section", { clase: "bienvenida" }, [
    crear("div", { clase: "bienvenida-fondo", atributos: { "aria-hidden": "true" } }, [crear("span"), crear("span"), crear("span")]),
    crear("p", { clase: "antetitulo", texto: "Serenia" }),
    crear("h1", {}, ["Tu música", crear("br"), crear("em", { texto: "y tus vídeos," }), crear("br"), "a tu manera."]),
    crear("p", { clase: "bienvenida-texto", texto: "Importa archivos o carpetas enteras: Kroma lee sus etiquetas y carátulas, prepara letras y subtítulos y lo guarda todo en tu navegador. Nada se sube a ningún servidor." }),
    crear("div", { clase: "bienvenida-acciones" }, [
      crear("button", { clase: "boton boton--principal boton--grande", icono: "subir", eventos: { click: () => app.importar() } }, [" Importar archivos"]),
      crear("button", { clase: "boton boton--grande", icono: "carpeta", eventos: { click: () => app.importar({ carpeta: true }) } }, [" Importar carpeta"]),
      crear("button", { clase: "boton boton--grande", icono: "disco", eventos: { click: () => app.cargarDemo() } }, [" Cargar la biblioteca de demo"]),
    ]),
    crear(
      "ul",
      { clase: "bienvenida-rasgos" },
      [
        ["sonido", "Ecualizador, reverb y normalización de volumen"],
        ["letra", "Letras sincronizadas LRC y subtítulos SRT / VTT"],
        ["efectos", "Efectos de vídeo en tiempo real"],
        ["miniReproductor", "Mini reproductor flotante"],
      ].map(([i, t]) => crear("li", {}, [icono(i), crear("span", { texto: t })])),
    ),
  ]);
}

export async function vistaInicio() {
  if (biblioteca.vacia) return bienvenida();

  const recientes = await biblioteca.recientes(10);
  const albumes = biblioteca.albumes();
  const videos = biblioteca.videos();
  const listas = biblioteca.listasOrdenadas();
  const favoritas = biblioteca.favoritas();
  const top = biblioteca.masEscuchadas(5);

  // Accesos rápidos: favoritos, listas y álbumes recientes
  const accesos = [];
  if (favoritas.length) accesos.push(acceso("Favoritos", crear("div", { clase: "portada portada--icono portada--favoritos" }, [icono("corazon")]), "#/favoritos", () => reproducirTodo(favoritas)));
  for (const l of listas.slice(0, 3)) accesos.push(acceso(l.nombre, mosaico(biblioteca.pistasDeLista(l)), `#/lista/${l.id}`, () => reproducirTodo(biblioteca.pistasDeLista(l))));
  const albumesRecientes = [...new Map(recientes.filter((p) => p.tipo === "audio").map((p) => [biblioteca.albumDe(p)?.id, biblioteca.albumDe(p)])).values()].filter(Boolean);
  for (const a of [...albumesRecientes, ...albumes]) {
    if (accesos.length >= 6) break;
    if (accesos.some((x) => x.getAttribute("href") === `#/album/${a.id}`)) continue;
    accesos.push(acceso(a.titulo, portada(a.conPortada), `#/album/${a.id}`, () => reproducirTodo(a.pistas)));
  }
  if (accesos.length < 6 && videos.length) accesos.push(acceso("Vídeos", portada(videos[0]), "#/videos", () => (reproducirTodo(videos), app.navegar("#/ahora"))));

  // Estadísticas
  const escuchas = [...biblioteca.pistas.values()].reduce((s, p) => s + (p.reproducciones || 0), 0);
  const minutos = [...biblioteca.pistas.values()].reduce((s, p) => s + (p.reproducciones || 0) * (p.duracion || 0), 0) / 60;
  const porArtista = new Map();
  for (const p of biblioteca.pistas.values()) porArtista.set(p.artista, (porArtista.get(p.artista) ?? 0) + (p.reproducciones || 0));
  const artistaTop = [...porArtista].sort((a, b) => b[1] - a[1])[0];

  const color = biblioteca.colorDe(recientes[0] ?? albumes[0]?.conPortada);
  const raiz = crear("div", { clase: "vista-inicio" }, [
    // "Buenas *tardes*": la segunda palabra en cursiva, como el titular de la web
    crear("h1", { clase: "titulo-vista" }, [saludo().split(" ")[0], " ", crear("em", { texto: saludo().split(" ").slice(1).join(" ") })]),
    crear("div", { clase: "accesos" }, accesos),
    estante(
      "Escuchado recientemente",
      recientes.map((p) =>
        tarjeta({
          titulo: p.titulo,
          subtitulo: p.artista,
          imagen: portada(p),
          ruta: p.tipo === "video" ? "#/videos" : `#/album/${biblioteca.albumDe(p)?.id}`,
          alReproducir: () => reproducirEnContexto(p, recientes),
        }),
      ),
    ),
    estante("Tus álbumes", albumes.map(tarjetaAlbum), { ruta: "#/albumes" }),
    estante("Vídeos", videos.map((v) => tarjetaVideo(v, videos)), { ruta: "#/videos", clase: "estante--videos" }),
    listas.length ? estante("Tus listas", listas.map(tarjetaLista), { ruta: "#/listas" }) : "",
    crear("section", { clase: "estadisticas" }, [
      crear("h2", { texto: "Tu actividad" }),
      crear("div", { clase: "estadisticas-rejilla" }, [
        dato(biblioteca.pistas.size, "elementos en tu biblioteca"),
        dato(duracionLarga([...biblioteca.pistas.values()].reduce((s, p) => s + (p.duracion || 0), 0)), "de música y vídeo"),
        dato(escuchas, plural(escuchas, "reproducción", "reproducciones").replace(/^\d+ /, "")),
        dato(`${Math.round(minutos)} min`, "escuchados"),
        artistaTop && artistaTop[1] ? dato(artistaTop[0], "tu artista más escuchado") : "",
        top[0] ? dato(top[0].titulo, `tu canción favorita · ${plural(top[0].reproducciones, "vez", "veces")}`) : "",
      ]),
    ]),
  ]);
  if (color) raiz.style.setProperty("--color-vista", color.principal);
  return raiz;
}

const dato = (valor, texto) => crear("div", { clase: "dato" }, [crear("strong", { texto: String(valor) }), crear("span", { texto })]);
