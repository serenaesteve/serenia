/**
 * Serenia · panel lateral derecho (cola y letra)
 */

import { app } from "../contexto.js";
import { biblioteca } from "../datos/biblioteca.js";
import { crear, icono, portada, formatearTiempo, botonIcono, duracionLarga } from "./dom.js";
import { menuPista } from "./acciones.js";
import { barritas, TIPO_ARRASTRE } from "./filas.js";
import { Letra } from "./Letra.js";

export class Panel {
  constructor(contenedor) {
    this.contenedor = contenedor;
    this.tipo = null;
    this.titulo = crear("h2");
    this.cuerpo = crear("div", { clase: "panel-cuerpo" });
    contenedor.append(
      crear("header", { clase: "panel-cabecera" }, [this.titulo, botonIcono("cerrar", "Cerrar panel", () => this.mostrar(null))]),
      this.cuerpo,
    );
    app.motor.addEventListener("cola", () => this.tipo === "cola" && this.pintarCola());
    app.motor.addEventListener("estado", () => this.tipo === "cola" && this.pintarCola());
    biblioteca.addEventListener("cambio", () => this.tipo === "cola" && this.pintarCola());
  }

  /** Muestra "cola", "letra" o cierra (null). Pulsar dos veces el mismo botón lo cierra. */
  mostrar(tipo) {
    if (tipo === this.tipo) tipo = null;
    this.letra?.destruir();
    this.letra = null;
    this.tipo = tipo;
    document.body.classList.toggle("con-panel", !!tipo);
    document.querySelectorAll("[data-panel]").forEach((b) => b.classList.toggle("activo", b.dataset.panel === tipo));
    if (!tipo) return;
    if (tipo === "cola") {
      this.titulo.textContent = "Cola de reproducción";
      this.pintarCola();
    } else {
      this.titulo.textContent = "Letra";
      this.cuerpo.replaceChildren();
      this.letra = new Letra(this.cuerpo);
    }
  }

  pintarCola() {
    const m = app.motor;
    const actual = m.pista;
    if (!actual) {
      this.cuerpo.replaceChildren(crear("p", { clase: "panel-vacio", texto: "La cola está vacía. Reproduce algo y aparecerá aquí." }));
      return;
    }
    const siguientes = m.ids.slice(m.indice + 1).map((id, n) => ({ pista: biblioteca.obtener(id), posicion: m.indice + 1 + n })).filter((x) => x.pista);
    const restante = siguientes.reduce((s, x) => s + (x.pista.duracion || 0), 0);

    const fila = (pista, posicion, sonando = false) => {
      const el = crear(
        "li",
        { clase: `cola-item${sonando ? " sonando" : ""}`, atributos: { draggable: sonando ? "false" : "true", tabindex: 0 }, datos: { posicion } },
        [
          sonando ? crear("span", { clase: "cola-arrastre" }, [barritas()]) : crear("span", { clase: "cola-arrastre", titulo: "Arrastra para reordenar" }, [icono("arrastrar")]),
          portada(pista, { clase: "portada--mini" }),
          crear("span", { clase: "cola-textos" }, [crear("strong", { texto: pista.titulo }), crear("small", { texto: pista.artista })]),
          crear("span", { clase: "cola-duracion", texto: formatearTiempo(pista.duracion) }),
          sonando ? "" : botonIcono("cerrar", "Quitar de la cola", (e) => (e.stopPropagation(), m.quitarDeCola(posicion)), "cola-quitar"),
        ],
      );
      el.addEventListener("dblclick", () => m.cargar(posicion));
      el.addEventListener("keydown", (e) => e.key === "Enter" && m.cargar(posicion));
      el.addEventListener("contextmenu", (e) => (e.preventDefault(), menuPista(e, pista, { posicionCola: sonando ? undefined : posicion })));
      el.addEventListener("dragstart", (e) => {
        e.dataTransfer.setData("application/x-kroma-cola", String(posicion));
        e.dataTransfer.setData(TIPO_ARRASTRE, JSON.stringify([pista.id]));
        el.classList.add("arrastrando");
      });
      el.addEventListener("dragend", () => el.classList.remove("arrastrando"));
      return el;
    };

    const lista = crear("ol", { clase: "cola-lista" }, siguientes.map(({ pista, posicion }) => fila(pista, posicion)));
    // Soltar dentro de la cola: reordenar (o añadir si viene de una tabla)
    lista.addEventListener("dragover", (e) => {
      const item = e.target.closest(".cola-item");
      if (!item) return;
      e.preventDefault();
      lista.querySelector(".soltar-encima")?.classList.remove("soltar-encima");
      item.classList.add("soltar-encima");
    });
    lista.addEventListener("drop", (e) => {
      e.preventDefault();
      const item = e.target.closest(".cola-item");
      if (!item) return;
      const a = Number(item.dataset.posicion);
      const de = e.dataTransfer.getData("application/x-kroma-cola");
      if (de !== "") m.moverEnCola(Number(de), a);
      else {
        const ids = JSON.parse(e.dataTransfer.getData(TIPO_ARRASTRE) || "[]");
        if (ids.length) m.insertarEnCola(a, ids);
      }
    });

    this.cuerpo.replaceChildren(
      crear("h3", { clase: "panel-seccion", texto: "Sonando ahora" }),
      crear("ol", { clase: "cola-lista" }, [fila(actual, m.indice, true)]),
      crear("div", { clase: "panel-seccion-fila" }, [
        crear("h3", { clase: "panel-seccion", texto: siguientes.length ? `A continuación · ${duracionLarga(restante)}` : "A continuación" }),
        siguientes.length ? crear("button", { clase: "boton boton--mini", texto: "Vaciar", eventos: { click: () => m.vaciarSiguientes() } }) : "",
      ]),
      siguientes.length ? lista : crear("p", { clase: "panel-vacio", texto: m.repetir === "todas" ? "Al acabar volverá a empezar la cola." : "No hay nada más en la cola." }),
      crear("p", { clase: "panel-ayuda", texto: "Arrastra canciones desde cualquier lista para añadirlas. Clic derecho para más opciones." }),
    );
  }
}
