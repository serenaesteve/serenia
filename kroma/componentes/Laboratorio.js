/**
 * Kroma · Laboratorio de conversión
 *
 * Arrastra un archivo y conviértelo sin subir nada a ningún servidor:
 *   audio      → WAV (16/24/32 bits), remuestreo, mono/estéreo, normalizar, fundidos, invertir, recortar
 *   vídeo      → fotograma PNG/JPEG/WebP, hoja de contactos, pista de audio a WAV
 *   imagen     → PNG/JPEG/WebP con calidad y redimensionado
 *   subtítulos → SRT ↔ VTT con corrección de desfase
 *
 * Uso:  <div data-kroma="laboratorio" data-ejemplos="media/a.mp3, media/b.mp4"></div>
 */

import * as conversor from "../conversion/conversor.js";
import { decodificar, analizarBuffer } from "../procesado/formaOnda.js";
import { parsear, aVtt, aSrt, desplazar } from "../subtitulos/subtitulos.js";
import { ReproductorAudio } from "../reproductores/ReproductorAudio.js";
import { notificar } from "../animacion/notificaciones.js";
import { registro } from "../nucleo/registro.js";
import { normalizarError, ErrorFormato } from "../nucleo/errores.js";
import { tipoDeArchivo, extension, puedeReproducirArchivo } from "../nucleo/tipos.js";
import { crear, icono, formatearTiempo, formatearBytes, descargar, nombreBase } from "../nucleo/utilidades.js";

const ACEPTA = "audio/*,video/*,image/*,.srt,.vtt";

export class Laboratorio {
  /** @param {HTMLElement} contenedor */
  constructor(contenedor) {
    this.contenedor = contenedor;
    this.archivo = null;
    this._urls = [];
    this._construir();
  }

  _construir() {
    this.entrada = crear("input", { atributos: { type: "file", accept: ACEPTA, hidden: "" }, eventos: { change: (e) => e.target.files[0] && this.abrir(e.target.files[0]) } });
    this.zona = crear(
      "label",
      { clase: "kr-soltar", atributos: { tabindex: 0 } },
      [icono("subir"), crear("strong", { texto: "Arrastra aquí un archivo" }), crear("span", { texto: "audio, vídeo, imagen o subtítulos (.srt / .vtt) · o haz clic para elegirlo" }), this.entrada],
    );
    this.zona.addEventListener("keydown", (e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), this.entrada.click()));

    // Arrastrar y soltar
    for (const ev of ["dragenter", "dragover"]) this.zona.addEventListener(ev, (e) => (e.preventDefault(), this.zona.classList.add("kr-encima")));
    for (const ev of ["dragleave", "drop"]) this.zona.addEventListener(ev, () => this.zona.classList.remove("kr-encima"));
    this.zona.addEventListener("drop", (e) => {
      e.preventDefault();
      const archivo = e.dataTransfer.files[0];
      if (archivo) this.abrir(archivo);
    });

    const ejemplos = (this.contenedor.dataset.ejemplos ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    this.ejemplos = crear(
      "div",
      { clase: "kr-ejemplos" },
      ejemplos.length
        ? [crear("span", { texto: "Probar con:" }), ...ejemplos.map((ruta) => crear("button", { clase: "kr-chip-boton", texto: ruta.split("/").pop(), eventos: { click: () => this.abrirRuta(ruta) } }))]
        : [],
    );

    this.info = crear("dl", { clase: "kr-lab-info" });
    this.opciones = crear("div", { clase: "kr-lab-opciones" });
    this.resultados = crear("div", { clase: "kr-lab-resultados" });
    this.raiz = crear("div", { clase: "kr kr-laboratorio" }, [
      this.zona,
      this.ejemplos,
      crear("div", { clase: "kr-lab-cuerpo", atributos: { hidden: "" } }, [crear("section", {}, [crear("h4", { texto: "Archivo" }), this.info]), crear("section", {}, [crear("h4", { texto: "Convertir" }), this.opciones])]),
      this.resultados,
    ]);
    this.cuerpo = this.raiz.querySelector(".kr-lab-cuerpo");
    this.contenedor.append(this.raiz);
  }

  /** Descarga un archivo de ejemplo y lo abre como si se hubiera arrastrado. */
  async abrirRuta(ruta) {
    try {
      const respuesta = await fetch(ruta);
      if (!respuesta.ok) throw new ErrorFormato(`No se encontró ${ruta}`, { codigo: "404" });
      const blob = await respuesta.blob();
      await this.abrir(new File([blob], ruta.split("/").pop(), { type: blob.type }));
    } catch (error) {
      this._error(error, "No se pudo abrir el ejemplo");
    }
  }

  /** Analiza el archivo y muestra las opciones de conversión adecuadas. */
  async abrir(archivo) {
    this.archivo = archivo;
    this.tipo = tipoDeArchivo(archivo.name, archivo.type);
    this.buffer = null;
    this.video = null;
    this.cuerpo.hidden = false;
    this.opciones.replaceChildren(crear("p", { clase: "kr-cargando-texto", texto: "Analizando…" }));
    registro.info("laboratorio", `Archivo: ${archivo.name} (${archivo.type || "sin MIME"}, ${formatearBytes(archivo.size)}) → ${this.tipo}`);

    const filas = [
      ["Nombre", archivo.name],
      ["Tipo MIME", archivo.type || "(el navegador no lo reconoce)"],
      ["Categoría", this.tipo],
      ["Tamaño", formatearBytes(archivo.size)],
    ];
    if (this.tipo === "audio" || this.tipo === "video") {
      const soporte = puedeReproducirArchivo(archivo.name);
      filas.push(["¿Reproducible aquí?", soporte === "probably" ? "Sí" : soporte === "maybe" ? "Probablemente" : "Puede que no"]);
    }

    try {
      switch (this.tipo) {
        case "audio":
          filas.push(...(await this._analizarAudio(archivo)));
          this._opcionesAudio();
          break;
        case "video":
          filas.push(...(await this._analizarVideo(archivo)));
          this._opcionesVideo();
          break;
        case "imagen": {
          const bitmap = await createImageBitmap(archivo);
          filas.push(["Dimensiones", `${bitmap.width} × ${bitmap.height} px`]);
          bitmap.close();
          this._opcionesImagen();
          break;
        }
        case "subtitulos": {
          this.frases = parsear(await archivo.text());
          filas.push(["Formato", extension(archivo.name).toUpperCase()], ["Frases", this.frases.length], ["Duración", formatearTiempo(this.frases.at(-1)?.fin ?? 0)]);
          this._opcionesSubtitulos();
          break;
        }
        default:
          throw new ErrorFormato("Kroma no sabe qué hacer con este tipo de archivo.", { codigo: "tipo-desconocido" });
      }
    } catch (error) {
      this.opciones.replaceChildren(crear("p", { clase: "kr-error-texto", texto: normalizarError(error).message }));
      this._error(error, "Análisis fallido");
    }
    this.info.replaceChildren(...filas.flatMap(([k, v]) => [crear("dt", { texto: k }), crear("dd", { texto: String(v) })]));
  }

  async _analizarAudio(archivo) {
    this.buffer = await decodificar(archivo);
    const { picoDb, rmsDb } = analizarBuffer(this.buffer);
    return [
      ["Duración", formatearTiempo(this.buffer.duration)],
      ["Frecuencia", `${this.buffer.sampleRate} Hz (decodificado)`],
      ["Canales", this.buffer.numberOfChannels],
      ["Pico", `${picoDb.toFixed(1)} dBFS`],
      ["RMS", `${rmsDb.toFixed(1)} dBFS`],
    ];
  }

  async _analizarVideo(archivo) {
    const url = this._url(archivo);
    this.video = await conversor.cargarVideo(url);
    return [
      ["Duración", formatearTiempo(this.video.duration)],
      ["Resolución", `${this.video.videoWidth} × ${this.video.videoHeight} px`],
      ["Relación de aspecto", (this.video.videoWidth / this.video.videoHeight).toFixed(2)],
    ];
  }

  // ── Formularios de opciones ─────────────────────────────────────

  _opcionesAudio() {
    const b = this.buffer;
    const f = formulario([
      selector("bits", "Formato", [["16", "WAV PCM 16 bits"], ["24", "WAV PCM 24 bits"], ["32", "WAV 32 bits float"]]),
      selector("frecuencia", "Frecuencia", [["", `Original (${b.sampleRate} Hz)`], ["48000", "48 000 Hz"], ["44100", "44 100 Hz"], ["22050", "22 050 Hz"], ["16000", "16 000 Hz (voz)"], ["8000", "8 000 Hz (teléfono)"]]),
      selector("canales", "Canales", [["", `Original (${b.numberOfChannels})`], ["1", "Mono"], ["2", "Estéreo"]]),
      numero("inicio", "Recortar desde (s)", 0, 0, b.duration),
      numero("fin", "hasta (s)", Number(b.duration.toFixed(2)), 0, b.duration),
      casilla("normalizar", "Normalizar a −1 dBFS"),
      casilla("fundidos", "Fundido de entrada y salida (1 s)"),
      casilla("invertir", "Invertir (al revés)"),
    ]);
    const boton = crear("button", { clase: "kr-boton-principal", texto: "Convertir a WAV", eventos: { click: () => this._convertirAudio(f) } });
    this.opciones.replaceChildren(f, boton);
  }

  async _convertirAudio(f) {
    await this._tarea("Convirtiendo audio…", async () => {
      const v = valores(f);
      let buffer = this.buffer;
      if (v.inicio > 0 || v.fin < buffer.duration) buffer = conversor.recortar(buffer, v.inicio, v.fin);
      if (v.frecuencia || v.canales) buffer = await conversor.remuestrear(buffer, { frecuencia: Number(v.frecuencia) || buffer.sampleRate, canales: Number(v.canales) || buffer.numberOfChannels });
      if (v.normalizar) buffer = conversor.normalizar(buffer);
      if (v.fundidos) buffer = conversor.fundidos(buffer, 1);
      if (v.invertir) buffer = conversor.invertir(buffer);
      const wav = conversor.audioBufferAWav(buffer, { bits: Number(v.bits) });
      const detalle = `${buffer.sampleRate} Hz · ${buffer.numberOfChannels === 1 ? "mono" : "estéreo"} · ${v.bits} bits · ${formatearTiempo(buffer.duration)}`;
      this._resultado(wav, `${nombreBase(this.archivo.name)}.wav`, detalle);
    });
  }

  _opcionesVideo() {
    const d = this.video.duration;
    const fotograma = formulario([
      numero("t", "Instante (s)", Number((d / 2).toFixed(2)), 0, d, 0.1),
      selector("tipo", "Formato", [["image/png", "PNG (sin pérdida)"], ["image/jpeg", "JPEG"], ["image/webp", "WebP"]]),
      numero("calidad", "Calidad (JPEG/WebP)", 0.85, 0.1, 1, 0.05),
    ]);
    this.opciones.replaceChildren(
      fotograma,
      crear("div", { clase: "kr-fila-botones" }, [
        crear("button", { clase: "kr-boton-principal", texto: "Extraer fotograma", eventos: { click: () => this._fotograma(fotograma) } }),
        crear("button", { clase: "kr-boton-secundario", texto: "Hoja de contactos 4×3", eventos: { click: () => this._hojaContactos() } }),
        crear("button", { clase: "kr-boton-secundario", texto: "Extraer audio a WAV", eventos: { click: () => this._audioDeVideo() } }),
      ]),
    );
  }

  async _fotograma(f) {
    await this._tarea("Extrayendo fotograma…", async () => {
      const v = valores(f);
      await new Promise((resolver) => {
        this.video.addEventListener("seeked", resolver, { once: true });
        this.video.currentTime = Math.min(v.t, this.video.duration - 0.05);
      });
      const blob = await conversor.capturarFotograma(this.video, { tipo: v.tipo, calidad: v.calidad });
      const ext = v.tipo.split("/")[1].replace("jpeg", "jpg");
      this._resultado(blob, `${nombreBase(this.archivo.name)}_${formatearTiempo(v.t).replace(":", "-")}.${ext}`, `${this.video.videoWidth}×${this.video.videoHeight} · ${v.tipo}`);
    });
  }

  async _hojaContactos() {
    const aviso = notificar("Generando hoja de contactos… 0 %", { duracion: 0 });
    await this._tarea(null, async () => {
      const blob = await conversor.hojaDeContactos(this.video, {
        alProgresar: (p) => aviso.actualizar(`Generando hoja de contactos… ${Math.round(p * 100)} %`),
      });
      this._resultado(blob, `${nombreBase(this.archivo.name)}_contactos.png`, "12 fotogramas · PNG");
    });
    aviso.cerrar();
  }

  async _audioDeVideo() {
    await this._tarea("Extrayendo audio…", async () => {
      const buffer = await decodificar(this.archivo);
      const wav = conversor.audioBufferAWav(buffer);
      this._resultado(wav, `${nombreBase(this.archivo.name)}_audio.wav`, `${buffer.sampleRate} Hz · ${buffer.numberOfChannels} canal(es) · ${formatearTiempo(buffer.duration)}`);
    });
  }

  _opcionesImagen() {
    const f = formulario([
      selector("tipo", "Formato", [["image/webp", "WebP"], ["image/jpeg", "JPEG"], ["image/png", "PNG"], ["image/avif", "AVIF (si el navegador puede)"]]),
      numero("calidad", "Calidad", 0.8, 0.1, 1, 0.05),
      numero("ancho", "Ancho máximo (px, 0 = original)", 0, 0, 8000, 1),
    ]);
    this.opciones.replaceChildren(f, crear("button", { clase: "kr-boton-principal", texto: "Convertir imagen", eventos: { click: () => this._convertirImagen(f) } }));
  }

  async _convertirImagen(f) {
    await this._tarea("Convirtiendo imagen…", async () => {
      const v = valores(f);
      const blob = await conversor.convertirImagen(this.archivo, { tipo: v.tipo, calidad: v.calidad, ancho: v.ancho || undefined });
      const ext = v.tipo.split("/")[1].replace("jpeg", "jpg");
      this._resultado(blob, `${nombreBase(this.archivo.name)}.${ext}`, `${v.tipo} · calidad ${v.calidad}`);
    });
  }

  _opcionesSubtitulos() {
    const actual = extension(this.archivo.name);
    const f = formulario([
      selector("formato", "Convertir a", actual === "srt" ? [["vtt", "WebVTT (.vtt)"], ["srt", "SubRip (.srt)"]] : [["srt", "SubRip (.srt)"], ["vtt", "WebVTT (.vtt)"]]),
      numero("desfase", "Desfase (s, + retrasa / − adelanta)", 0, -600, 600, 0.1),
    ]);
    this.opciones.replaceChildren(f, crear("button", { clase: "kr-boton-principal", texto: "Convertir subtítulos", eventos: { click: () => this._convertirSubtitulos(f) } }));
  }

  async _convertirSubtitulos(f) {
    await this._tarea(null, async () => {
      const v = valores(f);
      const frases = v.desfase ? desplazar(this.frases, v.desfase) : this.frases;
      const texto = v.formato === "vtt" ? aVtt(frases) : aSrt(frases);
      const blob = new Blob([texto], { type: v.formato === "vtt" ? "text/vtt" : "application/x-subrip" });
      this._resultado(blob, `${nombreBase(this.archivo.name)}.${v.formato}`, `${frases.length} frases${v.desfase ? ` · desfase ${v.desfase} s` : ""}`, texto);
    });
  }

  // ── Resultados ──────────────────────────────────────────────────

  async _tarea(mensaje, fn) {
    const aviso = mensaje ? notificar(mensaje, { duracion: 0 }) : null;
    this.raiz.classList.add("kr-ocupado");
    try {
      await registro.medir("laboratorio", mensaje ?? "tarea", fn);
    } catch (error) {
      this._error(error, "La conversión ha fallado");
    } finally {
      aviso?.cerrar();
      this.raiz.classList.remove("kr-ocupado");
    }
  }

  /** Añade una tarjeta con la vista previa del resultado y el botón de descarga. */
  _resultado(blob, nombre, detalle, texto) {
    const url = this._url(blob);
    const proporcion = this.archivo.size ? Math.round((blob.size / this.archivo.size) * 100) : 0;
    let previa;
    if (blob.type.startsWith("image/")) previa = crear("img", { atributos: { src: url, alt: nombre } });
    else if (blob.type.startsWith("audio/")) {
      const audio = crear("audio", { atributos: { src: url, "data-titulo": nombre } });
      previa = crear("div", {}, [audio]);
      queueMicrotask(() => new ReproductorAudio(audio, { compacto: true }));
    } else previa = crear("pre", { texto: (texto ?? "").slice(0, 1200) + ((texto?.length ?? 0) > 1200 ? "\n…" : "") });

    const tarjeta = crear("article", { clase: "kr-resultado" }, [
      crear("div", { clase: "kr-resultado-previa" }, [previa]),
      crear("div", { clase: "kr-resultado-datos" }, [
        crear("strong", { texto: nombre }),
        crear("small", { texto: detalle }),
        crear("p", { clase: "kr-comparacion" }, [
          crear("span", { texto: formatearBytes(this.archivo.size) }),
          " → ",
          crear("span", { texto: formatearBytes(blob.size) }),
          crear("em", { clase: proporcion > 100 ? "kr-mas" : "kr-menos", texto: ` ${proporcion} %` }),
        ]),
        crear("button", { clase: "kr-boton-principal", icono: "descargar", eventos: { click: () => descargar(blob, nombre) } }, [" Descargar"]),
      ]),
    ]);
    this.resultados.prepend(tarjeta);
    notificar(`${nombre} · ${formatearBytes(blob.size)}`, { tipo: "exito", titulo: "Conversión lista", duracion: 3000 });
  }

  _url(blob) {
    const url = URL.createObjectURL(blob);
    this._urls.push(url);
    return url;
  }

  _error(error, titulo) {
    const e = normalizarError(error);
    registro.error("laboratorio", titulo, e.message, error);
    notificar(e.message, { tipo: "error", titulo });
  }
}

// ── Pequeños ayudantes para formularios ───────────────────────────────

function formulario(campos) {
  return crear("div", { clase: "kr-formulario" }, campos);
}

function selector(nombre, etiqueta, opciones) {
  return crear("label", { clase: "kr-campo" }, [
    crear("span", { texto: etiqueta }),
    crear("select", { atributos: { name: nombre } }, opciones.map(([valor, texto]) => crear("option", { texto, atributos: { value: valor } }))),
  ]);
}

function numero(nombre, etiqueta, valor, min, max, paso = 0.01) {
  return crear("label", { clase: "kr-campo" }, [
    crear("span", { texto: etiqueta }),
    crear("input", { atributos: { type: "number", name: nombre, value: valor, min, max: Number(max.toFixed?.(2) ?? max), step: paso } }),
  ]);
}

function casilla(nombre, etiqueta) {
  return crear("label", { clase: "kr-interruptor" }, [crear("input", { atributos: { type: "checkbox", name: nombre } }), crear("span", { texto: etiqueta })]);
}

/** Lee todos los campos de un formulario como objeto { nombre: valor }. */
function valores(raiz) {
  const resultado = {};
  for (const el of raiz.querySelectorAll("[name]")) {
    if (el.type === "checkbox") resultado[el.name] = el.checked;
    else if (el.type === "number") resultado[el.name] = Number(el.value);
    else resultado[el.name] = el.value;
  }
  return resultado;
}
