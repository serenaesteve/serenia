/**
 * Serenia · paleta de comandos (Ctrl + K)
 *
 * Un único buscador para todo: canciones, vídeos, álbumes, artistas,
 * listas y acciones ("aleatorio", "temporizador 30", "ir a ajustes"…).
 */

import { app } from "../contexto.js";
import { biblioteca, normalizar } from "../datos/biblioteca.js";
import { crear, icono, portada } from "./dom.js";
import { reproducirEnContexto, reproducirTodo } from "./acciones.js";

function acciones() {
  const m = app.motor;
  return [
    { icono: m.reproduciendo ? "pausa" : "play", texto: m.reproduciendo ? "Pausar" : "Reproducir", atajo: "Espacio", fn: () => m.alternar() },
    { icono: "siguiente", texto: "Siguiente canción", atajo: "Mayús →", fn: () => m.siguiente() },
    { icono: "anterior", texto: "Canción anterior", atajo: "Mayús ←", fn: () => m.anterior() },
    { icono: "aleatorio", texto: m.aleatorio ? "Desactivar aleatorio" : "Activar aleatorio", atajo: "S", fn: () => m.alternarAleatorio() },
    { icono: "repetir", texto: "Cambiar modo de repetición", atajo: "R", fn: () => m.cambiarRepetir() },
    { icono: "expandir", texto: "Abrir «Ahora suena»", fn: () => app.navegar("#/ahora") },
    { icono: "cola", texto: "Ver la cola", atajo: "Q", fn: () => app.panel("cola") },
    { icono: "letra", texto: "Ver la letra", atajo: "L", fn: () => app.panel("letra") },
    { icono: "miniReproductor", texto: "Mini reproductor flotante", fn: () => app.miniReproductor() },
    { icono: "temporizador", texto: "Temporizador: 15 minutos", fn: () => m.programarApagado(15) },
    { icono: "temporizador", texto: "Temporizador: 30 minutos", fn: () => m.programarApagado(30) },
    { icono: "temporizador", texto: "Temporizador: al terminar la canción", fn: () => m.programarApagado("fin") },
    { icono: "subir", texto: "Importar archivos", fn: () => app.importar() },
    { icono: "carpeta", texto: "Importar una carpeta", fn: () => app.importar({ carpeta: true }) },
    { icono: "inicio", texto: "Ir a Inicio", fn: () => app.navegar("#/") },
    { icono: "nota", texto: "Ir a Canciones", fn: () => app.navegar("#/canciones") },
    { icono: "disco", texto: "Ir a Álbumes", fn: () => app.navegar("#/albumes") },
    { icono: "persona", texto: "Ir a Artistas", fn: () => app.navegar("#/artistas") },
    { icono: "video", texto: "Ir a Vídeos", fn: () => app.navegar("#/videos") },
    { icono: "corazon", texto: "Ir a Favoritos", fn: () => app.navegar("#/favoritos") },
    { icono: "micro", texto: "Abrir la grabadora", fn: () => app.navegar("#/grabadora") },
    { icono: "herramientas", texto: "Abrir el conversor", fn: () => app.navegar("#/conversor") },
    { icono: "diagnostico", texto: "Diagnóstico y eventos", fn: () => app.navegar("#/diagnostico") },
    { icono: "ajustes", texto: "Ajustes", fn: () => app.navegar("#/ajustes") },
  ];
}

export function abrirPaleta() {
  if (document.querySelector(".paleta")) return;
  const entrada = crear("input", { clase: "paleta-entrada", atributos: { type: "search", placeholder: "Busca canciones, álbumes, artistas o acciones…", "aria-label": "Buscar", autocomplete: "off" } });
  const lista = crear("ul", { clase: "paleta-lista", atributos: { role: "listbox" } });
  const d = crear("dialog", { clase: "paleta" }, [
    crear("div", { clase: "paleta-caja" }, [icono("buscar"), entrada, crear("kbd", { texto: "Esc" })]),
    lista,
    crear("footer", {}, [crear("span", {}, [crear("kbd", { texto: "↑" }), crear("kbd", { texto: "↓" }), " moverse"]), crear("span", {}, [crear("kbd", { texto: "↵" }), " elegir"])]),
  ]);
  let resultados = [];
  let seleccion = 0;

  const elegir = (r) => {
    d.close();
    r?.fn();
  };

  const pintar = () => {
    const q = normalizar(entrada.value).trim();
    const coincide = (t) => q.split(/\s+/).every((w) => normalizar(t).includes(w));
    resultados = [];
    if (q) {
      const b = biblioteca.buscar(q);
      resultados.push(
        ...b.canciones.slice(0, 6).map((p) => ({ grupo: "Canciones", pista: p, texto: p.titulo, sub: `${p.artista} · ${p.album}`, fn: () => reproducirEnContexto(p, [p]) })),
        ...b.videos.slice(0, 4).map((p) => ({ grupo: "Vídeos", pista: p, texto: p.titulo, sub: p.artista, fn: () => (reproducirEnContexto(p, [p]), app.navegar("#/ahora")) })),
        ...b.albumes.slice(0, 4).map((a) => ({ grupo: "Álbumes", pista: a.conPortada, texto: a.titulo, sub: `Álbum · ${a.artista}`, fn: () => app.navegar(`#/album/${a.id}`) })),
        ...b.artistas.slice(0, 4).map((a) => ({ grupo: "Artistas", pista: a.conPortada, redonda: true, texto: a.nombre, sub: "Artista", fn: () => app.navegar(`#/artista/${a.id}`) })),
        ...biblioteca
          .listasOrdenadas()
          .filter((l) => coincide(l.nombre))
          .map((l) => ({ grupo: "Listas", icono: "lista", texto: l.nombre, sub: "Lista", fn: () => app.navegar(`#/lista/${l.id}`), alt: () => reproducirTodo(biblioteca.pistasDeLista(l)) })),
      );
    }
    resultados.push(...acciones().filter((a) => !q || coincide(a.texto)).map((a) => ({ ...a, grupo: "Acciones" })));
    seleccion = Math.min(seleccion, Math.max(0, resultados.length - 1));

    let grupo = null;
    const items = [];
    resultados.forEach((r, i) => {
      if (r.grupo !== grupo) {
        grupo = r.grupo;
        items.push(crear("li", { clase: "paleta-grupo", texto: grupo, atributos: { role: "presentation" } }));
      }
      const li = crear(
        "li",
        { clase: `paleta-item${i === seleccion ? " activo" : ""}`, atributos: { role: "option", "aria-selected": i === seleccion }, datos: { i } },
        [
          r.pista ? portada(r.pista, { clase: "portada--mini", redonda: r.redonda }) : crear("span", { clase: "paleta-icono" }, [icono(r.icono)]),
          crear("span", { clase: "paleta-textos" }, [crear("strong", { texto: r.texto }), r.sub ? crear("small", { texto: r.sub }) : ""]),
          r.atajo ? crear("kbd", { texto: r.atajo }) : "",
        ],
      );
      li.addEventListener("click", () => elegir(r));
      li.addEventListener("pointermove", () => {
        if (seleccion === i) return;
        seleccion = i;
        lista.querySelectorAll(".paleta-item").forEach((x) => x.classList.toggle("activo", Number(x.dataset.i) === i));
      });
      items.push(li);
    });
    if (!resultados.length) items.push(crear("li", { clase: "paleta-nada", texto: `Nada coincide con «${entrada.value}»` }));
    lista.replaceChildren(...items);
    lista.querySelector(".activo")?.scrollIntoView({ block: "nearest" });
  };

  entrada.addEventListener("input", () => ((seleccion = 0), pintar()));
  entrada.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") seleccion = (seleccion + 1) % Math.max(1, resultados.length);
    else if (e.key === "ArrowUp") seleccion = (seleccion - 1 + resultados.length) % Math.max(1, resultados.length);
    else if (e.key === "Enter") return elegir(resultados[seleccion]);
    // En un <input type="search"> el primer Escape solo borra el texto: cerramos directamente
    else if (e.key === "Escape") return (e.preventDefault(), d.close());
    else return;
    e.preventDefault();
    pintar();
  });
  d.addEventListener("close", () => d.remove());
  d.addEventListener("click", (e) => e.target === d && d.close());
  document.body.append(d);
  d.showModal();
  pintar();
  entrada.focus();
}
