/**
 * Serenia · barra de reproducción (abajo, siempre visible)
 */

import { app } from "../contexto.js";
import { biblioteca } from "../datos/biblioteca.js";
import { crear, icono, portada, formatearTiempo, enlace, botonIcono } from "./dom.js";
import { alternarFavorito, menuPista, normalizarClave } from "./acciones.js";
import { abrirMenu } from "./menus.js";
import { cambiarIcono, variableCSS } from "../../kroma/nucleo/utilidades.js";
import { BANDAS, PRESETS_EQ } from "../../kroma/procesado/cadenaAudio.js";
import { notificar } from "../../kroma/animacion/notificaciones.js";

export class Barra {
  constructor(contenedor) {
    this.contenedor = contenedor;
    this.motor = app.motor;
    this._construir();
    this._conectar();
    this.pintarPista();
  }

  _construir() {
    // ── Izquierda: lo que suena
    this.elPortada = crear("button", { clase: "barra-portada", titulo: "Abrir «Ahora suena»", eventos: { click: () => app.navegar("#/ahora") } });
    this.elTitulo = crear("a", { clase: "barra-titulo", atributos: { href: "#/ahora" } });
    this.elArtista = crear("div", { clase: "barra-artista" });
    this.bFav = botonIcono("corazonVacio", "Añadir a favoritos", () => this.motor.pista && alternarFavorito(this.motor.pista), "fav");
    const izquierda = crear("div", { clase: "barra-izquierda" }, [this.elPortada, crear("div", { clase: "barra-textos" }, [this.elTitulo, this.elArtista]), this.bFav]);
    izquierda.addEventListener("contextmenu", (e) => {
      if (!this.motor.pista) return;
      e.preventDefault();
      menuPista(e, this.motor.pista);
    });

    // ── Centro: controles y progreso
    this.bAleatorio = botonIcono("aleatorio", "Aleatorio (S)", () => this.motor.alternarAleatorio(), "pequeno");
    this.bAnterior = botonIcono("anterior", "Anterior (Mayús + ←)", () => this.motor.anterior());
    this.bPlay = botonIcono("play", "Reproducir (Espacio)", () => this.motor.alternar(), "boton-play");
    this.bSiguiente = botonIcono("siguiente", "Siguiente (Mayús + →)", () => this.motor.siguiente());
    this.bRepetir = botonIcono("repetir", "Repetir: no (R)", () => this.motor.cambiarRepetir(), "pequeno");

    this.elActual = crear("span", { clase: "barra-tiempo", texto: "0:00" });
    this.elTotal = crear("span", { clase: "barra-tiempo", texto: "0:00" });
    this.lienzo = crear("canvas", { clase: "barra-onda" });
    this.globo = crear("span", { clase: "barra-globo" });
    this.progreso = crear("div", { clase: "barra-progreso", atributos: { role: "slider", "aria-label": "Posición", tabindex: 0 } }, [this.lienzo, this.globo]);

    const centro = crear("div", { clase: "barra-centro" }, [
      crear("div", { clase: "barra-controles" }, [this.bAleatorio, this.bAnterior, this.bPlay, this.bSiguiente, this.bRepetir]),
      crear("div", { clase: "barra-linea" }, [this.elActual, this.progreso, this.elTotal]),
    ]);

    // ── Derecha: herramientas
    this.bLetra = botonIcono("letra", "Letra (L)", () => app.panel("letra"));
    this.bCola = botonIcono("cola", "Cola (Q)", () => app.panel("cola"));
    this.bSonido = botonIcono("sonido", "Sonido: ecualizador y efectos", (e) => this.abrirSonido(e.currentTarget));
    this.bTemporizador = botonIcono("temporizador", "Temporizador de apagado", (e) => this.menuTemporizador(e));
    this.bMini = botonIcono("miniReproductor", "Mini reproductor flotante", () => app.miniReproductor?.());
    this.bVolumen = botonIcono("volumen", "Silenciar (M)", () => this.motor.alternarSilencio());
    this.volumen = crear("input", {
      clase: "barra-volumen",
      atributos: { type: "range", min: 0, max: 1, step: 0.01, "aria-label": "Volumen" },
      eventos: { input: (e) => this.motor.fijarVolumen(Number(e.target.value)) },
    });
    // La rueda del ratón sobre el volumen también lo cambia
    this.volumen.addEventListener("wheel", (e) => (e.preventDefault(), this.motor.fijarVolumen(this.motor.ajustes.volumen - Math.sign(e.deltaY) * 0.05)), { passive: false });
    this.bExpandir = botonIcono("expandir", "Ahora suena", () => (location.hash === "#/ahora" ? history.back() : app.navegar("#/ahora")));

    const derecha = crear("div", { clase: "barra-derecha" }, [
      this.bLetra,
      this.bCola,
      this.bSonido,
      this.bTemporizador,
      this.bMini,
      crear("div", { clase: "barra-volumen-grupo" }, [this.bVolumen, this.volumen]),
      this.bExpandir,
    ]);

    this.raiz = crear("div", { clase: "barra-contenido" }, [izquierda, centro, derecha]);
    this.contenedor.append(this.raiz);
  }

  _conectar() {
    const m = this.motor;
    m.addEventListener("pista", () => this.pintarPista());
    m.addEventListener("estado", (e) => this.pintarEstado(e.detail));
    m.addEventListener("modo", () => this.pintarModo());
    m.addEventListener("volumen", () => this.pintarVolumen());
    m.addEventListener("apagado", (e) => {
      this.bTemporizador.classList.toggle("activo", !!e.detail.activo);
      if (e.detail.ejecutado) notificar("Temporizador: reproducción detenida. ¡Que descanses!", { tipo: "info" });
    });
    biblioteca.addEventListener("cambio", () => this.pintarFavorito());

    // Arrastrar en la barra de progreso
    let arrastrando = false;
    const fraccion = (e) => {
      const r = this.progreso.getBoundingClientRect();
      return Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    };
    this.progreso.addEventListener("pointerdown", (e) => {
      arrastrando = true;
      this.progreso.setPointerCapture(e.pointerId);
      this._arrastre = fraccion(e);
      this.pintarProgreso();
    });
    this.progreso.addEventListener("pointermove", (e) => {
      const f = fraccion(e);
      this._hover = f;
      this.globo.textContent = formatearTiempo(f * m.duracion);
      this.globo.style.left = `${f * 100}%`;
      this.progreso.classList.add("encima");
      if (arrastrando) this._arrastre = f;
      this.pintarProgreso();
    });
    this.progreso.addEventListener("pointerup", (e) => {
      if (!arrastrando) return;
      arrastrando = false;
      m.irA(fraccion(e) * m.duracion);
      this._arrastre = null;
    });
    this.progreso.addEventListener("pointerleave", () => {
      this._hover = null;
      this.progreso.classList.remove("encima");
      this.pintarProgreso();
    });
    this.progreso.addEventListener("keydown", (e) => {
      if (e.key === "ArrowLeft") m.saltar(-5);
      else if (e.key === "ArrowRight") m.saltar(5);
      else return;
      e.preventDefault();
      e.stopPropagation();
    });

    new ResizeObserver(() => this._redimensionar()).observe(this.progreso);

    // Bucle de pintado a 60 fps mientras suena
    const bucle = () => {
      if (m.reproduciendo || this._arrastre != null) this.pintarProgreso();
      requestAnimationFrame(bucle);
    };
    requestAnimationFrame(bucle);
  }

  // ── Pintar ───────────────────────────────────────────────────────

  pintarPista() {
    const p = this.motor.pista;
    document.body.classList.toggle("sin-pista", !p);
    if (!p) return;
    this.elPortada.replaceChildren(portada(p));
    this.elTitulo.textContent = p.titulo;
    this.elTitulo.title = p.titulo;
    this.elArtista.replaceChildren(enlace(p.artista, `#/artista/${encodeURIComponent(normalizarClave(p.artista))}`));
    this.bLetra.classList.toggle("desactivado", !p.letra);
    this.pintarFavorito();
    this.pintarProgreso();
    // Animación de "cambio de canción"
    this.raiz.classList.remove("cambio");
    void this.raiz.offsetWidth;
    this.raiz.classList.add("cambio");
  }

  pintarFavorito() {
    const p = this.motor.pista;
    const fav = !!p?.favorito;
    cambiarIcono(this.bFav, fav ? "corazon" : "corazonVacio", fav ? "Quitar de favoritos" : "Añadir a favoritos");
    this.bFav.classList.toggle("activo", fav);
  }

  pintarEstado({ reproduciendo, esperando } = {}) {
    const r = reproduciendo ?? this.motor.reproduciendo;
    cambiarIcono(this.bPlay, r ? "pausa" : "play", r ? "Pausar (Espacio)" : "Reproducir (Espacio)");
    document.body.classList.toggle("reproduciendo", r);
    this.bPlay.classList.toggle("esperando", !!esperando);
    if (!r) this.pintarProgreso();
  }

  pintarModo() {
    const m = this.motor;
    this.bAleatorio.classList.toggle("activo", m.aleatorio);
    cambiarIcono(this.bRepetir, m.repetir === "una" ? "repetirUna" : "repetir", `Repetir: ${m.repetir} (R)`);
    this.bRepetir.classList.toggle("activo", m.repetir !== "no");
  }

  pintarVolumen() {
    const { volumen, silencio } = this.motor.ajustes;
    const v = silencio ? 0 : volumen;
    this.volumen.value = v;
    this.volumen.style.setProperty("--valor", v);
    cambiarIcono(this.bVolumen, v === 0 ? "silencio" : "volumen", v === 0 ? "Activar sonido (M)" : "Silenciar (M)");
  }

  _redimensionar() {
    const dpr = devicePixelRatio || 1;
    const { width, height } = this.lienzo.getBoundingClientRect();
    this.lienzo.width = Math.round(width * dpr);
    this.lienzo.height = Math.round(height * dpr);
    this.pintarProgreso();
  }

  /** Forma de onda de la canción en miniatura; la parte escuchada, con el color de la carátula. */
  pintarProgreso() {
    const m = this.motor;
    const d = m.duracion;
    const t = this._arrastre != null ? this._arrastre * d : m.tiempo;
    const f = d ? t / d : 0;
    const texto = formatearTiempo(t);
    if (this.elActual.textContent !== texto) this.elActual.textContent = texto;
    this.elTotal.textContent = formatearTiempo(d);
    this.progreso.setAttribute("aria-valuenow", Math.round(t));
    this.progreso.setAttribute("aria-valuetext", texto);

    const ctx = this.lienzo.getContext("2d");
    const w = this.lienzo.width;
    const h = this.lienzo.height;
    if (!w) return;
    ctx.clearRect(0, 0, w, h);
    const acento = variableCSS(document.body, "--acento", "#ff5e7e");
    const apagado = variableCSS(document.body, "--onda-apagada", "rgba(127,127,127,.3)");
    const encima = variableCSS(document.body, "--texto-suave", "rgba(127,127,127,.6)");
    const picos = m.pista?.picos;
    if (picos) {
      const [izq, der = izq] = picos;
      const n = Math.floor(w / (4 * (devicePixelRatio || 1)));
      const ancho = w / n;
      for (let i = 0; i < n; i++) {
        const j = Math.floor((i / n) * izq.length);
        const v = (izq[j] + der[j]) / 510;
        const alto = Math.max(2, v * h * 0.95);
        const x = i * ancho;
        ctx.fillStyle = x / w < f ? acento : this._hover != null && x / w < this._hover ? encima : apagado;
        ctx.fillRect(x, (h - alto) / 2, Math.max(1, ancho * 0.62), alto);
      }
    } else {
      const y = h / 2 - 2;
      ctx.fillStyle = apagado;
      ctx.fillRect(0, y, w, 4);
      ctx.fillStyle = acento;
      ctx.fillRect(0, y, w * f, 4);
    }
  }

  // ── Sonido ───────────────────────────────────────────────────────

  abrirSonido(boton) {
    if (this.popover) return this.cerrarSonido();
    const m = this.motor;
    const a = m.ajustes;

    const bandas = BANDAS.map(({ frecuencia, nombre }, i) => {
      const valor = crear("output", { texto: formatoDb(a.ganancias[i]) });
      const input = crear("input", {
        atributos: { type: "range", min: -12, max: 12, step: 0.5, value: a.ganancias[i], orient: "vertical", "aria-label": `${nombre} ${frecuencia} Hz` },
        eventos: {
          input: (e) => {
            const ganancias = [...m.ajustes.ganancias];
            ganancias[i] = Number(e.target.value);
            valor.textContent = formatoDb(ganancias[i]);
            selector.value = "personalizado";
            m.configurar({ ganancias, preset: undefined });
            m.ajustes.preset = "personalizado";
          },
        },
      });
      return { input, valor, raiz: crear("label", { clase: "banda" }, [valor, input, crear("span", { texto: frecuencia >= 1000 ? `${frecuencia / 1000}k` : frecuencia }), crear("small", { texto: nombre })]) };
    });

    const selector = crear(
      "select",
      {
        clase: "campo campo--compacto",
        atributos: { "aria-label": "Preajuste del ecualizador" },
        eventos: {
          change: (e) => {
            m.configurar({ preset: e.target.value });
            bandas.forEach((b, i) => {
              b.input.value = m.ajustes.ganancias[i];
              b.valor.textContent = formatoDb(m.ajustes.ganancias[i]);
            });
          },
        },
      },
      [...Object.entries(PRESETS_EQ).map(([k, { nombre }]) => crear("option", { texto: nombre, atributos: { value: k } })), crear("option", { texto: "Personalizado", atributos: { value: "personalizado", hidden: "" } })],
    );
    selector.value = a.preset ?? "plano";

    const deslizador = (etiqueta, min, max, paso, valor, formato, alCambiar) => {
      const salida = crear("output", { texto: formato(valor) });
      const input = crear("input", {
        atributos: { type: "range", min, max, step: paso, value: valor },
        eventos: { input: (e) => ((salida.textContent = formato(Number(e.target.value))), e.target.style.setProperty("--valor", (e.target.value - min) / (max - min)), alCambiar(Number(e.target.value))) },
      });
      input.style.setProperty("--valor", (valor - min) / (max - min));
      return crear("label", { clase: "control" }, [crear("span", { texto: etiqueta }), salida, input]);
    };

    const velocidades = [0.5, 0.75, 1, 1.25, 1.5, 2];
    const chipsVelocidad = crear(
      "div",
      { clase: "chips" },
      velocidades.map((v) =>
        crear("button", {
          clase: `chip${a.velocidad === v ? " activo" : ""}`,
          texto: `${v}×`,
          eventos: {
            click: (e) => {
              m.fijarVelocidad(v);
              chipsVelocidad.querySelectorAll(".chip").forEach((c) => c.classList.toggle("activo", c === e.currentTarget));
            },
          },
        }),
      ),
    );

    const interruptor = (texto, activo, alCambiar, ayuda) =>
      crear("label", { clase: "interruptor" }, [
        crear("input", { atributos: { type: "checkbox", ...(activo ? { checked: "" } : {}) }, eventos: { change: (e) => alCambiar(e.target.checked) } }),
        crear("span", {}, [crear("strong", { texto }), crear("small", { texto: ayuda })]),
      ]);

    this.popover = crear("div", { clase: "popover sonido", atributos: { role: "dialog", "aria-label": "Sonido" } }, [
      crear("header", {}, [crear("h3", { texto: "Sonido" }), selector]),
      crear("div", { clase: "bandas" }, bandas.map((b) => b.raiz)),
      deslizador("Balance", -1, 1, 0.05, a.balance, (v) => (Math.abs(v) < 0.03 ? "Centro" : v < 0 ? `I ${Math.round(-v * 100)}` : `D ${Math.round(v * 100)}`), (v) => m.configurar({ balance: v })),
      deslizador("Sala (reverb)", 0, 1, 0.01, a.reverb, (v) => `${Math.round(v * 100)} %`, (v) => m.configurar({ reverb: v })),
      deslizador("Fundido entre canciones", 0, 12, 1, a.fundido, (v) => (v ? `${v} s` : "No"), (v) => m.configurar({ fundido: v })),
      crear("div", { clase: "control" }, [crear("span", { texto: "Velocidad" }), chipsVelocidad]),
      interruptor("Normalizar volumen", a.normalizar, (v) => m.configurar({ normalizar: v }), "Iguala el volumen de todas las canciones"),
    ]);
    document.body.append(this.popover);
    const r = boton.getBoundingClientRect();
    this.popover.style.right = `${Math.max(12, innerWidth - r.right - 60)}px`;
    this.bSonido.classList.add("activo");
    this._cerrarFuera = (e) => !this.popover?.contains(e.target) && !this.bSonido.contains(e.target) && this.cerrarSonido();
    setTimeout(() => document.addEventListener("pointerdown", this._cerrarFuera));
  }

  cerrarSonido() {
    this.popover?.remove();
    this.popover = null;
    this.bSonido.classList.remove("activo");
    document.removeEventListener("pointerdown", this._cerrarFuera);
  }

  // ── Temporizador ─────────────────────────────────────────────────

  menuTemporizador(e) {
    const m = this.motor;
    const ap = m.apagado;
    const restante = ap?.hora ? ` (quedan ${Math.ceil((ap.hora - Date.now()) / 60000)} min)` : ap?.fin ? " (al acabar la canción)" : "";
    const programar = (min, texto) => () => {
      m.programarApagado(min);
      notificar(`La música se detendrá ${texto}`, { tipo: "info", titulo: "Temporizador", duracion: 2500 });
    };
    abrirMenu(e, [
      { icono: "temporizador", texto: "En 15 minutos", accion: programar(15, "en 15 minutos") },
      { icono: "temporizador", texto: "En 30 minutos", accion: programar(30, "en 30 minutos") },
      { icono: "temporizador", texto: "En 45 minutos", accion: programar(45, "en 45 minutos") },
      { icono: "temporizador", texto: "En 1 hora", accion: programar(60, "en 1 hora") },
      { icono: "nota", texto: "Al terminar esta canción", accion: programar("fin", "al terminar esta canción") },
      ...(ap ? ["-", { icono: "cerrar", texto: `Cancelar${restante}`, accion: () => m.programarApagado(null) }] : []),
    ]);
  }
}

const formatoDb = (v) => `${v > 0 ? "+" : ""}${v} dB`;
