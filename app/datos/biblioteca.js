/**
 * Serenia · biblioteca
 *
 * Copia en memoria de la base de datos con consultas rápidas (álbumes, artistas,
 * búsqueda…) y operaciones que guardan los cambios. Emite "cambio" cada vez
 * que algo se modifica para que las vistas se repinten.
 */

import { bd, nuevoId } from "./bd.js";

/** Quita tildes y pasa a minúsculas para comparar ("Neón" == "neon"). */
export const normalizar = (s) =>
  String(s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

const claveAlbum = (p) => `${normalizar(p.album)}␟${normalizar(p.artistaAlbum || p.artista)}`;

class Biblioteca extends EventTarget {
  constructor() {
    super();
    /** @type {Map<string, object>} */
    this.pistas = new Map();
    /** @type {Map<string, object>} */
    this.listas = new Map();
    this._urlsPortada = new Map();
    this._urlsMedia = new Map();
    this._cacheAlbumes = null;
  }

  async cargar() {
    const [pistas, listas] = await Promise.all([bd.todas("pistas"), bd.todas("listas")]);
    this.pistas = new Map(pistas.map((p) => [p.id, p]));
    this.listas = new Map(listas.map((l) => [l.id, l]));
    this._invalidar();
  }

  _invalidar(tipo = "pistas") {
    this._cacheAlbumes = null;
    this.dispatchEvent(new CustomEvent("cambio", { detail: { tipo } }));
  }

  get vacia() {
    return this.pistas.size === 0;
  }

  obtener(id) {
    return this.pistas.get(id) ?? null;
  }

  // ── Consultas ──────────────────────────────────────────────────────

  canciones() {
    return [...this.pistas.values()].filter((p) => p.tipo === "audio").sort(ordenAlbum);
  }

  videos() {
    return [...this.pistas.values()].filter((p) => p.tipo === "video").sort((a, b) => b.fechaAlta - a.fechaAlta);
  }

  favoritas() {
    return [...this.pistas.values()].filter((p) => p.favorito).sort(ordenAlbum);
  }

  /** Álbumes agrupados por título + artista del álbum. */
  albumes() {
    if (this._cacheAlbumes) return this._cacheAlbumes;
    const mapa = new Map();
    for (const p of this.pistas.values()) {
      if (p.tipo !== "audio") continue;
      const clave = claveAlbum(p);
      if (!mapa.has(clave)) {
        mapa.set(clave, { id: encodeURIComponent(clave), titulo: p.album, artista: p.artistaAlbum || p.artista, anio: p.anio, pistas: [] });
      }
      const a = mapa.get(clave);
      a.pistas.push(p);
      if (!a.anio && p.anio) a.anio = p.anio;
    }
    const albumes = [...mapa.values()];
    for (const a of albumes) {
      a.pistas.sort(ordenAlbum);
      a.duracion = a.pistas.reduce((s, p) => s + (p.duracion || 0), 0);
      a.conPortada = a.pistas.find((p) => p.portada) ?? a.pistas[0];
    }
    albumes.sort((a, b) => normalizar(a.titulo).localeCompare(normalizar(b.titulo)));
    this._cacheAlbumes = albumes;
    return albumes;
  }

  album(id) {
    return this.albumes().find((a) => a.id === id) ?? null;
  }

  albumDe(pista) {
    return this.album(encodeURIComponent(claveAlbum(pista)));
  }

  artistas() {
    const mapa = new Map();
    for (const p of this.pistas.values()) {
      const clave = normalizar(p.artista);
      if (!mapa.has(clave)) mapa.set(clave, { id: encodeURIComponent(clave), nombre: p.artista, pistas: [] });
      mapa.get(clave).pistas.push(p);
    }
    const artistas = [...mapa.values()];
    for (const a of artistas) {
      a.pistas.sort((x, y) => y.reproducciones - x.reproducciones || ordenAlbum(x, y));
      a.albumes = this.albumes().filter((al) => normalizar(al.artista) === normalizar(a.nombre));
      a.conPortada = a.pistas.find((p) => p.portada) ?? a.pistas[0];
    }
    return artistas.sort((a, b) => normalizar(a.nombre).localeCompare(normalizar(b.nombre)));
  }

  artista(id) {
    return this.artistas().find((a) => a.id === id) ?? null;
  }

  /** Búsqueda sin tildes en título, artista, álbum y género. */
  buscar(consulta) {
    const q = normalizar(consulta).trim();
    if (!q) return { canciones: [], videos: [], albumes: [], artistas: [] };
    const palabras = q.split(/\s+/);
    const coincide = (texto) => palabras.every((w) => normalizar(texto).includes(w));
    const todas = [...this.pistas.values()];
    return {
      canciones: todas.filter((p) => p.tipo === "audio" && coincide(`${p.titulo} ${p.artista} ${p.album} ${p.genero}`)),
      videos: todas.filter((p) => p.tipo === "video" && coincide(`${p.titulo} ${p.artista}`)),
      albumes: this.albumes().filter((a) => coincide(`${a.titulo} ${a.artista}`)),
      artistas: this.artistas().filter((a) => coincide(a.nombre)),
    };
  }

  /** Últimas pistas escuchadas (sin repetir). */
  async recientes(limite = 12) {
    const historial = await bd.historialReciente(150);
    const vistas = new Set();
    const resultado = [];
    for (const h of historial) {
      if (vistas.has(h.pistaId) || !this.pistas.has(h.pistaId)) continue;
      vistas.add(h.pistaId);
      resultado.push(this.pistas.get(h.pistaId));
      if (resultado.length >= limite) break;
    }
    return resultado;
  }

  anadidasRecientemente(limite = 12) {
    return [...this.pistas.values()].sort((a, b) => b.fechaAlta - a.fechaAlta).slice(0, limite);
  }

  masEscuchadas(limite = 10) {
    return [...this.pistas.values()].filter((p) => p.reproducciones > 0).sort((a, b) => b.reproducciones - a.reproducciones).slice(0, limite);
  }

  // ── URLs para <img>, <audio> y <video> ─────────────────────────────

  /** URL de la carátula (si la pista no tiene, la de otra canción del mismo álbum). */
  urlPortada(pista) {
    if (!pista) return null;
    let origen = pista.portada ? pista : null;
    if (!origen && pista.tipo === "audio") origen = this.albumDe(pista)?.pistas.find((p) => p.portada) ?? null;
    if (!origen) return null;
    if (!this._urlsPortada.has(origen.id)) this._urlsPortada.set(origen.id, URL.createObjectURL(origen.portada));
    return this._urlsPortada.get(origen.id);
  }

  /** Color dominante (el de la pista o el del álbum). */
  colorDe(pista) {
    if (!pista) return null;
    return pista.color ?? this.albumDe(pista)?.pistas.find((p) => p.color)?.color ?? null;
  }

  urlMedia(pista) {
    if (pista.url) return pista.url;
    if (!this._urlsMedia.has(pista.id)) this._urlsMedia.set(pista.id, URL.createObjectURL(pista.archivo));
    return this._urlsMedia.get(pista.id);
  }

  // ── Modificaciones ─────────────────────────────────────────────────

  /** Añade pistas nuevas, ignorando duplicados (mismo nombre de archivo y tamaño). */
  async anadir(nuevas) {
    const existentes = new Set([...this.pistas.values()].map((p) => `${p.nombreArchivo}|${p.tamano}`));
    const aceptadas = nuevas.filter((p) => !existentes.has(`${p.nombreArchivo}|${p.tamano}`));
    if (aceptadas.length) {
      await bd.guardarVarias("pistas", aceptadas);
      for (const p of aceptadas) this.pistas.set(p.id, p);
      this._invalidar();
    }
    return { anadidas: aceptadas.length, duplicadas: nuevas.length - aceptadas.length };
  }

  async actualizar(id, cambios, { silencioso = false } = {}) {
    const p = this.pistas.get(id);
    if (!p) return;
    Object.assign(p, cambios);
    if ("portada" in cambios) {
      URL.revokeObjectURL(this._urlsPortada.get(id));
      this._urlsPortada.delete(id);
    }
    await bd.guardar("pistas", p);
    if (!silencioso) this._invalidar();
  }

  async alternarFavorito(id) {
    const p = this.pistas.get(id);
    if (p) await this.actualizar(id, { favorito: !p.favorito });
    return p?.favorito;
  }

  async eliminar(ids) {
    for (const id of ids) {
      await bd.borrar("pistas", id);
      this.pistas.delete(id);
      URL.revokeObjectURL(this._urlsMedia.get(id));
      this._urlsMedia.delete(id);
    }
    for (const lista of this.listas.values()) {
      const antes = lista.pistas.length;
      lista.pistas = lista.pistas.filter((id) => this.pistas.has(id));
      if (lista.pistas.length !== antes) await bd.guardar("listas", lista);
    }
    this._invalidar();
  }

  /** Cuenta una reproducción (se llama al pasar del 50 % o de 30 s). */
  async registrarReproduccion(id) {
    const p = this.pistas.get(id);
    if (!p) return;
    p.reproducciones = (p.reproducciones || 0) + 1;
    p.ultimaVez = Date.now();
    await bd.guardar("pistas", p);
    await bd.guardar("historial", { pistaId: id, fecha: Date.now(), duracion: p.duracion });
    this._invalidar("historial");
  }

  // ── Listas de reproducción ─────────────────────────────────────────

  listasOrdenadas() {
    return [...this.listas.values()].sort((a, b) => a.fecha - b.fecha);
  }

  pistasDeLista(lista) {
    return lista.pistas.map((id) => this.pistas.get(id)).filter(Boolean);
  }

  async crearLista(nombre, ids = []) {
    const lista = { id: nuevoId(), nombre, pistas: [...ids], fecha: Date.now() };
    await bd.guardar("listas", lista);
    this.listas.set(lista.id, lista);
    this._invalidar("listas");
    return lista;
  }

  async guardarLista(lista) {
    await bd.guardar("listas", lista);
    this.listas.set(lista.id, lista);
    this._invalidar("listas");
  }

  async anadirALista(listaId, ids) {
    const lista = this.listas.get(listaId);
    if (!lista) return 0;
    const nuevas = ids.filter((id) => !lista.pistas.includes(id));
    lista.pistas.push(...nuevas);
    await this.guardarLista(lista);
    return nuevas.length;
  }

  async eliminarLista(id) {
    await bd.borrar("listas", id);
    this.listas.delete(id);
    this._invalidar("listas");
  }
}

/** Orden natural de un álbum: álbum → nº de pista → título. */
function ordenAlbum(a, b) {
  return (
    normalizar(a.artista).localeCompare(normalizar(b.artista)) ||
    normalizar(a.album).localeCompare(normalizar(b.album)) ||
    (a.numero || 999) - (b.numero || 999) ||
    normalizar(a.titulo).localeCompare(normalizar(b.titulo))
  );
}

export const biblioteca = new Biblioteca();
