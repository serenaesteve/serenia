/**
 * Serenia · letra sincronizada
 *
 * Lee la letra de la pista (LRC, VTT o texto plano de la etiqueta ID3)
 * y resalta la línea que suena, centrándola con una transición suave.
 * Se usa en el panel lateral y en la vista "Ahora suena".
 */

import { app } from "../contexto.js";
import { crear, icono } from "./dom.js";
import { PistaSubtitulos } from "../../kroma/subtitulos/subtitulos.js";

export class Letra {
  /** @param {HTMLElement} contenedor */
  constructor(contenedor, { grande = false } = {}) {
    this.contenedor = contenedor;
    this.raiz = crear("div", { clase: `letra${grande ? " letra--grande" : ""}` });
    this.lineas = crear("ol", { clase: "letra-lineas" });
    this.raiz.append(this.lineas);
    contenedor.append(this.raiz);
    this._actual = -2;
    this._alPista = () => this.cargar();
    app.motor.addEventListener("pista", this._alPista);
    this.cargar();
    this._bucle();
  }

  async cargar() {
    const p = app.motor.pista;
    this._actual = -2;
    this.pista = null;
    this.lineas.style.transform = "";
    this.raiz.classList.remove("letra--plana");
    if (!p?.letra) {
      this.lineas.replaceChildren(
        crear("li", { clase: "letra-vacia" }, [icono("letra"), crear("span", { texto: p ? "Esta pista no tiene letra." : "No suena nada." }), crear("small", { texto: "Añade un archivo .lrc o .vtt con el mismo nombre al importar." })]),
      );
      return;
    }
    if (!p.letra.sincronizada) {
      this.raiz.classList.add("letra--plana");
      this.lineas.replaceChildren(...p.letra.texto.split(/\r?\n/).map((l) => crear("li", { texto: l || " " })));
      return;
    }
    try {
      const pista = await new PistaSubtitulos({ texto: p.letra.texto }).cargar();
      if (app.motor.pista !== p) return;
      this.pista = pista;
      this.lineas.replaceChildren(
        ...pista.frases.map((f) =>
          crear("li", {
            texto: f.texto,
            eventos: { click: () => (app.motor.irA(f.inicio), app.motor.reproduciendo || app.motor.reproducir()) },
          }),
        ),
      );
    } catch {
      this.raiz.classList.add("letra--plana");
      this.lineas.replaceChildren(...p.letra.texto.split(/\r?\n/).map((l) => crear("li", { texto: l })));
    }
  }

  _bucle() {
    if (this._destruida) return;
    if (this.pista && this.raiz.isConnected && this.raiz.offsetParent) this._pintar();
    this._frame = requestAnimationFrame(() => this._bucle());
  }

  _pintar() {
    // Adelantamos 0,25 s: la vista "anticipa" la línea como en las apps de karaoke
    const i = this.pista.ultimaIniciadaEn(app.motor.tiempo + 0.25);
    if (i === this._actual) return;
    this._actual = i;
    const items = this.lineas.children;
    for (let n = 0; n < items.length; n++) {
      items[n].classList.toggle("cantada", n < i);
      items[n].classList.toggle("actual", n === i);
    }
    const objetivo = items[Math.max(0, i)];
    if (objetivo) {
      const y = objetivo.offsetTop + objetivo.offsetHeight / 2 - this.raiz.clientHeight * 0.4;
      this.lineas.style.transform = `translateY(${-Math.max(0, y)}px)`;
    }
  }

  destruir() {
    this._destruida = true;
    cancelAnimationFrame(this._frame);
    app.motor.removeEventListener("pista", this._alPista);
    this.raiz.remove();
  }
}
