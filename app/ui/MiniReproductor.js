/**
 * Serenia · mini reproductor flotante
 *
 * Usa la API Document Picture-in-Picture: una ventanita que queda siempre
 * encima del resto de aplicaciones, con carátula, controles y un visualizador.
 * Si el navegador no la soporta y suena un vídeo, usa el PiP clásico del <video>.
 */

import { app } from "../contexto.js";
import { biblioteca } from "../datos/biblioteca.js";
import { crear, portada, formatearTiempo, botonIcono } from "./dom.js";
import { cambiarIcono } from "../../kroma/nucleo/utilidades.js";
import { notificar } from "../../kroma/animacion/notificaciones.js";
import { normalizarError } from "../../kroma/nucleo/errores.js";

let ventana = null;

export async function alternarMiniReproductor() {
  if (ventana) return ventana.close();
  const m = app.motor;

  if (!("documentPictureInPicture" in window)) {
    if (m.pista?.tipo === "video" && document.pictureInPictureEnabled) {
      try {
        await m.video.requestPictureInPicture();
      } catch (error) {
        notificar(normalizarError(error).message, { tipo: "aviso", titulo: "Picture-in-Picture" });
      }
    } else {
      notificar("Tu navegador no soporta ventanas flotantes (Document Picture-in-Picture). Prueba con Chrome o Edge.", { tipo: "aviso", titulo: "Mini reproductor" });
    }
    return;
  }

  try {
    ventana = await documentPictureInPicture.requestWindow({ width: 320, height: 400 });
  } catch (error) {
    notificar(normalizarError(error).message, { tipo: "aviso", titulo: "Mini reproductor" });
    return;
  }

  // Copiamos los estilos de la app a la ventanita
  for (const hoja of document.querySelectorAll('link[rel="stylesheet"], style')) ventana.document.head.append(hoja.cloneNode(true));
  ventana.document.body.className = "mini-cuerpo";
  ventana.document.documentElement.dataset.tema = document.documentElement.dataset.tema;
  ventana.document.title = "Serenia · mini";

  const fondo = crear("div", { clase: "mini-fondo" });
  const caja = crear("div", { clase: "mini-portada" });
  const titulo = crear("strong", { clase: "mini-titulo" });
  const artista = crear("span", { clase: "mini-artista" });
  const relleno = crear("div", { clase: "mini-relleno" });
  const barra = crear("div", { clase: "mini-barra" }, [relleno]);
  const tiempos = crear("div", { clase: "mini-tiempos" }, [crear("span"), crear("span")]);
  const bPlay = botonIcono("play", "Reproducir", () => m.alternar(), "boton-play");
  const lienzo = crear("canvas", { clase: "mini-visualizador", atributos: { width: 560, height: 80 } });

  barra.addEventListener("click", (e) => {
    const r = barra.getBoundingClientRect();
    m.irA(((e.clientX - r.left) / r.width) * m.duracion);
  });

  ventana.document.body.append(
    fondo,
    crear("div", { clase: "mini" }, [
      caja,
      lienzo,
      crear("div", { clase: "mini-textos" }, [titulo, artista]),
      barra,
      tiempos,
      crear("div", { clase: "mini-controles" }, [
        botonIcono("anterior", "Anterior", () => m.anterior()),
        bPlay,
        botonIcono("siguiente", "Siguiente", () => m.siguiente()),
      ]),
    ]),
  );

  const pintarPista = () => {
    const p = m.pista;
    caja.replaceChildren(p ? portada(p) : "");
    titulo.textContent = p?.titulo ?? "Nada sonando";
    artista.textContent = p?.artista ?? "";
    const color = biblioteca.colorDe(p);
    fondo.style.background = color ? `radial-gradient(circle at 30% 20%, ${color.principal}, ${color.oscuro} 70%)` : "";
    ventana.document.body.style.setProperty("--acento", color?.principal ?? "#ff5e7e");
  };
  const pintarEstado = () => cambiarIcono(bPlay, m.reproduciendo ? "pausa" : "play", m.reproduciendo ? "Pausar" : "Reproducir");

  // Bucle con el requestAnimationFrame DE LA VENTANITA: el de la pestaña se congela si está en segundo plano
  const ctx = lienzo.getContext("2d");
  const bucle = () => {
    if (!ventana) return;
    const d = m.duracion;
    relleno.style.width = `${d ? (m.tiempo / d) * 100 : 0}%`;
    tiempos.firstChild.textContent = formatearTiempo(m.tiempo);
    tiempos.lastChild.textContent = formatearTiempo(d);
    const datos = m.analisis?.frecuencias();
    ctx.clearRect(0, 0, lienzo.width, lienzo.height);
    if (datos) {
      const n = 48;
      const ancho = lienzo.width / n;
      ctx.fillStyle = getComputedStyle(ventana.document.body).getPropertyValue("--acento") || "#ff5e7e";
      for (let i = 0; i < n; i++) {
        const v = datos[Math.floor((i / n) ** 1.6 * datos.length * 0.7)] / 255;
        const h = Math.max(3, v * lienzo.height);
        ctx.globalAlpha = 0.55 + v * 0.45;
        ctx.fillRect(i * ancho + 2, lienzo.height - h, ancho - 4, h);
      }
      ctx.globalAlpha = 1;
    }
    ventana.requestAnimationFrame(bucle);
  };

  m.addEventListener("pista", pintarPista);
  m.addEventListener("estado", pintarEstado);
  biblioteca.addEventListener("cambio", pintarPista);
  pintarPista();
  pintarEstado();
  ventana.requestAnimationFrame(bucle);
  document.body.classList.add("con-mini");

  ventana.addEventListener("pagehide", () => {
    m.removeEventListener("pista", pintarPista);
    m.removeEventListener("estado", pintarEstado);
    biblioteca.removeEventListener("cambio", pintarPista);
    document.body.classList.remove("con-mini");
    ventana = null;
  });
}
