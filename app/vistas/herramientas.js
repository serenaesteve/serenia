/**
 * Serenia · herramientas, diagnóstico y ajustes
 */

import { app } from "../contexto.js";
import { biblioteca } from "../datos/biblioteca.js";
import { bd } from "../datos/bd.js";
import { analizar } from "../datos/importador.js";
import { crear, icono, plural, duracionLarga } from "../ui/dom.js";
import { confirmar } from "../ui/menus.js";
import { Grabadora } from "../../kroma/captura/Grabadora.js";
import { Laboratorio } from "../../kroma/componentes/Laboratorio.js";
import { Soporte } from "../../kroma/componentes/Soporte.js";
import { notificar } from "../../kroma/animacion/notificaciones.js";
import { registro } from "../../kroma/nucleo/registro.js";
import { extensionDeMime } from "../../kroma/nucleo/tipos.js";
import { formatearBytes, preferencias } from "../../kroma/nucleo/utilidades.js";
import { decodificar } from "../../kroma/procesado/formaOnda.js";

const cabeceraSimple = (titulo, texto, nombreIcono) =>
  crear("header", { clase: "cabecera-simple" }, [crear("span", { clase: "cabecera-simple-icono" }, [icono(nombreIcono)]), crear("div", {}, [crear("h1", { texto: titulo }), crear("p", { texto })])]);

// ── Grabadora ────────────────────────────────────────────────────────

export function vistaGrabadora() {
  const caja = crear("div");
  const grabadora = new Grabadora(caja, {
    acciones: [
      {
        icono: "mas",
        titulo: "Añadir a la biblioteca",
        fn: async (g) => {
          const pista = await analizar({
            blob: g.blob,
            ruta: `${g.nombre}.${extensionDeMime(g.mime)}`,
            extras: { titulo: g.nombre, artista: "Mis grabaciones" },
          });
          pista.album = "Grabaciones";
          pista.duracion ||= g.duracion;
          const { anadidas } = await biblioteca.anadir([pista]);
          notificar(anadidas ? "Grabación añadida a tu biblioteca" : "Ya estaba en la biblioteca", {
            tipo: anadidas ? "exito" : "info",
            accion: anadidas ? { texto: "Ver", fn: () => app.navegar("#/canciones") } : undefined,
          });
        },
      },
    ],
  });
  const raiz = crear("div", { clase: "vista-herramienta" }, [
    cabeceraSimple("Grabadora", "Graba el micrófono, la cámara o la pantalla. Las grabaciones se guardan en tu navegador y puedes añadirlas a la biblioteca con el botón +.", "micro"),
    caja,
  ]);
  raiz._limpiar = () => grabadora.destruir();
  return raiz;
}

// ── Conversor ────────────────────────────────────────────────────────

export function vistaConversor() {
  const caja = crear("div", { datos: { ejemplos: "media/musica/neon.mp3, media/videos/bienvenida.mp4, media/videos/bienvenida.es.srt, media/musica/marea.lrc, media/caratulas/senal.jpg" } });
  new Laboratorio(caja);
  return crear("div", { clase: "vista-herramienta" }, [
    cabeceraSimple("Conversor", "Convierte audio a WAV (con remuestreo, mono/estéreo, normalización…), extrae fotogramas de vídeo, cambia el formato de imágenes y pasa subtítulos de SRT a VTT. Todo dentro del navegador.", "herramientas"),
    caja,
  ]);
}

// ── Diagnóstico ──────────────────────────────────────────────────────

const CRITERIOS = [
  ["a", "Entornos de desarrollo multimedia", "Detección de codecs y APIs del navegador (abajo) y comparativa con Android, JavaFX, Python y FFmpeg en el README.", "kroma/componentes/Soporte.js"],
  ["b", "Captura, procesamiento y almacenamiento", "Grabadora (getUserMedia, getDisplayMedia, MediaRecorder), lectura de etiquetas ID3/Vorbis/MP4 byte a byte y biblioteca persistente en IndexedDB.", "app/datos/etiquetas.js · app/datos/bd.js"],
  ["c", "Conversión entre formatos", "Exportación a WAV (con ecualizador), remuestreo, fotograma → PNG/JPEG/WebP, imagen ⇄ imagen, SRT ⇄ VTT y LRC.", "kroma/conversion/conversor.js"],
  ["d", "Procesado multimedia", "Ecualizador, reverb por convolución, limitador, normalización por sonoridad, fundido cruzado, forma de onda y 13 filtros de vídeo por píxel.", "app/motor/Motor.js · kroma/procesado/"],
  ["e", "Eventos, tipos de media y excepciones", "Eventos propios del motor, monitor de eventos (abajo), canPlayType, MediaRecorder.isTypeSupported y jerarquía de errores traducidos.", "kroma/nucleo/errores.js"],
  ["f", "Animaciones", "Visualizadores con requestAnimationFrame, carátula 3D, letras karaoke, fondos animados, transiciones entre vistas y notificaciones.", "kroma/animacion/ · app/app.css"],
  ["g", "Reproducción", "Motor con cola, aleatorio, repetir, fundido, sesión recordada, mini reproductor (Document PiP), Media Session y reproductor de vídeo completo.", "app/motor/Motor.js"],
  ["h", "Depuración y documentación", "Modo depuración, registro con historial, pruebas de errores (abajo), JSDoc y README con la memoria y las incidencias resueltas.", "kroma/nucleo/registro.js · README.md"],
];

export function vistaDiagnostico(monitor) {
  const zona = crear("div", { clase: "zona-pruebas" });
  const pruebas = {
    "Archivo inexistente (404)": () => probarAudio("media/no-existe.mp3"),
    "Archivo dañado": () => probarAudio("media/pruebas/roto.mp3"),
    "Decodificar algo que no es audio": async () => {
      try {
        await decodificar(`media/pruebas/roto.mp3?${Date.now()}`);
      } catch (error) {
        registro.error("prueba", `${error.name} [${error.codigo}]: ${error.message}`);
        notificar(`${error.name} · código «${error.codigo}»\n${error.message}`, { tipo: "error", titulo: "Excepción capturada" });
      }
    },
    "Permiso de micrófono": async () => {
      try {
        const s = await navigator.mediaDevices.getUserMedia({ audio: true });
        s.getTracks().forEach((t) => t.stop());
        notificar("Permiso concedido: el micrófono funciona.", { tipo: "exito" });
      } catch (error) {
        const { normalizarError } = await import("../../kroma/nucleo/errores.js");
        notificar(normalizarError(error).message, { tipo: "error", titulo: error.name });
      }
    },
  };
  function probarAudio(src) {
    const audio = crear("audio", { atributos: { src } });
    audio.addEventListener("error", () => {
      const codigos = { 1: "ABORTED", 2: "NETWORK", 3: "DECODE", 4: "SRC_NOT_SUPPORTED" };
      notificar(`MediaError ${audio.error.code} (${codigos[audio.error.code]}): ${audio.error.message || "sin detalle"}`, { tipo: "error", titulo: `Error al cargar ${src.split("/").pop()}` });
    });
    zona.replaceChildren(audio);
  }

  const soporte = crear("div");
  new Soporte(soporte);

  const depurar = crear("input", { atributos: { type: "checkbox", ...(registro.activo ? { checked: "" } : {}) }, eventos: { change: (e) => (window.Kroma ? (window.Kroma.depuracion = e.target.checked) : (registro.activo = e.target.checked)) } });

  return crear("div", { clase: "vista-herramienta vista-diagnostico" }, [
    cabeceraSimple("Diagnóstico", "Lo que hay por debajo: eventos en directo, pruebas de errores, soporte del navegador y dónde se cumple cada criterio del RA3.", "diagnostico"),
    crear("section", { clase: "bloque" }, [
      crear("div", { clase: "bloque-cabecera" }, [crear("h2", { texto: "Monitor de eventos" }), crear("label", { clase: "interruptor interruptor--linea" }, [depurar, crear("span", { texto: "Registro detallado en la consola (F12)" })])]),
      monitor,
    ]),
    crear("section", { clase: "bloque" }, [
      crear("h2", { texto: "Provoca un error" }),
      crear("p", { clase: "texto-suave", texto: "Cada botón provoca un fallo real. La app lo captura, lo traduce y sigue funcionando; míralo también en el monitor." }),
      crear("div", { clase: "fila-botones" }, Object.entries(pruebas).map(([t, fn]) => crear("button", { clase: "boton", texto: t, eventos: { click: fn } }))),
      zona,
    ]),
    crear("section", { clase: "bloque" }, [crear("h2", { texto: "Tu navegador" }), soporte]),
    crear("section", { clase: "bloque" }, [
      crear("h2", { texto: "Criterios de evaluación del RA3" }),
      crear(
        "div",
        { clase: "criterios" },
        CRITERIOS.map(([l, t, d, f]) => crear("article", {}, [crear("b", { texto: l }), crear("h3", { texto: t }), crear("p", { texto: d }), crear("code", { texto: f })])),
      ),
    ]),
  ]);
}

// ── Ajustes ──────────────────────────────────────────────────────────

export async function vistaAjustes() {
  const m = app.motor;
  const a = m.ajustes;
  const pistas = [...biblioteca.pistas.values()];
  const importado = pistas.filter((p) => p.archivo).reduce((s, p) => s + p.tamano, 0);
  const espacio = await navigator.storage?.estimate?.().catch(() => null);
  const colorDinamico = await bd.leerAjuste("colorDinamico", false);
  const tema = crear(
    "select",
    { clase: "campo campo--compacto", atributos: { "aria-label": "Tema" }, eventos: { change: (e) => app.fijarTema(e.target.value) } },
    [["auto", "Como el sistema"], ["claro", "Claro"], ["oscuro", "Oscuro"]].map(([v, t]) => crear("option", { texto: t, atributos: { value: v } })),
  );
  tema.value = preferencias.leer("tema", null) ?? "auto";

  const fila = (titulo, texto, control) => crear("div", { clase: "ajuste" }, [crear("div", {}, [crear("strong", { texto: titulo }), crear("p", { texto })]), control]);
  const interruptor = (activo, fn) => crear("label", { clase: "interruptor" }, [crear("input", { atributos: { type: "checkbox", ...(activo ? { checked: "" } : {}) }, eventos: { change: (e) => fn(e.target.checked) } }), crear("span")]);
  const deslizador = (min, max, valor, formato, fn) => {
    const salida = crear("output", { texto: formato(valor) });
    const input = crear("input", { atributos: { type: "range", min, max, step: 1, value: valor }, eventos: { input: (e) => ((salida.textContent = formato(Number(e.target.value))), e.target.style.setProperty("--valor", (e.target.value - min) / (max - min)), fn(Number(e.target.value))) } });
    input.style.setProperty("--valor", (valor - min) / (max - min));
    return crear("div", { clase: "ajuste-deslizador" }, [input, salida]);
  };
  const idioma = crear(
    "select",
    { clase: "campo campo--compacto", eventos: { change: (e) => m.configurar({ idiomaSubtitulos: e.target.value }) } },
    [["es", "Español"], ["en", "English"], ["", "Desactivados"]].map(([v, t]) => crear("option", { texto: t, atributos: { value: v } })),
  );
  idioma.value = a.idiomaSubtitulos ?? "es";

  const atajos = [
    ["Espacio", "Reproducir / pausar"],
    ["← / →", "Retroceder / avanzar 5 s"],
    ["Mayús + ← / →", "Anterior / siguiente"],
    ["↑ / ↓", "Volumen"],
    ["M", "Silencio"],
    ["S", "Aleatorio"],
    ["R", "Repetir"],
    ["L", "Letra"],
    ["Q", "Cola"],
    ["F", "Favorito"],
    ["Ctrl + K  o  /", "Buscar y comandos"],
    ["Alt + ← / →", "Atrás / adelante"],
  ];

  return crear("div", { clase: "vista-herramienta vista-ajustes" }, [
    cabeceraSimple("Ajustes", "Personaliza cómo suena y cómo se ve Serenia.", "ajustes"),
    crear("section", { clase: "bloque" }, [
      crear("h2", { texto: "Reproducción" }),
      fila("Fundido entre canciones", "Mientras una canción termina, la siguiente empieza poco a poco.", deslizador(0, 12, a.fundido, (v) => (v ? `${v} s` : "No"), (v) => m.configurar({ fundido: v }))),
      fila("Normalizar el volumen", "Analiza cada canción al importarla y ajusta su ganancia para que todas suenen igual de fuerte.", interruptor(a.normalizar, (v) => m.configurar({ normalizar: v }))),
      fila("Subtítulos por defecto", "Idioma que se activa solo al abrir un vídeo (si existe).", idioma),
    ]),
    crear("section", { clase: "bloque" }, [
      crear("h2", { texto: "Apariencia" }),
      fila("Tema", "Claro (aurora pastel) u oscuro (ciruela). El botón de la cabecera también lo cambia.", tema),
      fila("Color dinámico", "En lugar del rosa, el acento toma el color de la carátula que suena.", interruptor(colorDinamico, async (v) => (await bd.guardarAjuste("colorDinamico", v), app.aplicarColor()))),
    ]),
    crear("section", { clase: "bloque" }, [
      crear("h2", { texto: "Biblioteca" }),
      crear("p", { clase: "texto-suave", texto: `${plural(pistas.filter((p) => p.tipo === "audio").length, "canción", "canciones")} · ${plural(pistas.filter((p) => p.tipo === "video").length, "vídeo")} · ${duracionLarga(pistas.reduce((s, p) => s + (p.duracion || 0), 0))} · ${formatearBytes(importado)} importados${espacio?.quota ? ` · espacio disponible: ${formatearBytes(espacio.quota - espacio.usage)}` : ""}` }),
      crear("div", { clase: "fila-botones" }, [
        crear("button", { clase: "boton", icono: "subir", eventos: { click: () => app.importar() } }, [" Importar archivos"]),
        crear("button", { clase: "boton", icono: "carpeta", eventos: { click: () => app.importar({ carpeta: true }) } }, [" Importar carpeta"]),
        crear("button", { clase: "boton", icono: "disco", eventos: { click: () => app.cargarDemo() } }, [" Cargar la demo"]),
        crear(
          "button",
          {
            clase: "boton boton--peligro",
            icono: "borrar",
            eventos: {
              click: async () => {
                if (!(await confirmar("Borrar la biblioteca", "Se eliminarán todas las canciones, vídeos, listas y estadísticas guardadas en este navegador. No se puede deshacer."))) return;
                m.pausar();
                await bd.borrarTodo();
                location.hash = "#/";
                location.reload();
              },
            },
          },
          [" Borrar todo"],
        ),
      ]),
    ]),
    app.instalar
      ? crear("section", { clase: "bloque" }, [
          crear("h2", { texto: "Aplicación" }),
          fila("Instalar Serenia", "Úsalo como una aplicación más de tu ordenador o móvil, también sin conexión.", crear("button", { clase: "boton boton--principal", icono: "instalar", eventos: { click: () => app.instalar() } }, [" Instalar"])),
        ])
      : "",
    crear("section", { clase: "bloque" }, [
      crear("h2", { texto: "Atajos de teclado" }),
      crear("dl", { clase: "atajos" }, atajos.flatMap(([k, t]) => [crear("dt", {}, [crear("kbd", { texto: k })]), crear("dd", { texto: t })])),
    ]),
    crear("section", { clase: "bloque acerca" }, [
      crear("h2", { texto: "Acerca de" }),
      crear("p", {}, [crear("strong", { texto: "Serenia 2.0" }), " · reproductor multimedia hecho con HTML, CSS y JavaScript sin dependencias, sobre la librería multimedia Kroma (también propia)."]),
      crear("p", { clase: "texto-suave", texto: "Proyecto del RA3 · 0489 Programación multimedia y dispositivos móviles · DAM · Hecho por Serena Sania Esteve · 2026" }),
    ]),
  ]);
}
