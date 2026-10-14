/**
 * Kroma · almacén de grabaciones (IndexedDB)
 *
 * localStorage solo guarda texto y unos pocos MB; IndexedDB guarda Blobs
 * (audio y vídeo) de forma persistente en el navegador.
 * Esta clase envuelve la API (basada en eventos) en promesas.
 */

import { KromaError } from "../nucleo/errores.js";

const BASE = "kroma";
const VERSION = 1;
const ALMACEN = "grabaciones";

/** Convierte una IDBRequest en promesa. */
function promesa(peticion) {
  return new Promise((resolver, rechazar) => {
    peticion.onsuccess = () => resolver(peticion.result);
    peticion.onerror = () => rechazar(peticion.error);
  });
}

export class Almacen {
  constructor() {
    this._db = null;
  }

  async abrir() {
    if (this._db) return this._db;
    if (!("indexedDB" in window)) throw new KromaError("Este navegador no tiene IndexedDB: las grabaciones no se pueden guardar.", { codigo: "sin-indexeddb" });
    const peticion = indexedDB.open(BASE, VERSION);
    // Se ejecuta la primera vez (o al subir VERSION): creamos la estructura
    peticion.onupgradeneeded = () => {
      const db = peticion.result;
      if (!db.objectStoreNames.contains(ALMACEN)) {
        const almacen = db.createObjectStore(ALMACEN, { keyPath: "id", autoIncrement: true });
        almacen.createIndex("fecha", "fecha");
      }
    };
    try {
      this._db = await promesa(peticion);
    } catch (error) {
      throw new KromaError("No se pudo abrir la base de datos del navegador (¿modo privado?).", { codigo: "indexeddb", causa: error });
    }
    return this._db;
  }

  async _almacen(modo) {
    const db = await this.abrir();
    return db.transaction(ALMACEN, modo).objectStore(ALMACEN);
  }

  /** Guarda una grabación y devuelve su id. */
  async guardar(grabacion) {
    return promesa((await this._almacen("readwrite")).put(grabacion));
  }

  /** Todas las grabaciones, de la más nueva a la más antigua. */
  async todas() {
    const lista = await promesa((await this._almacen("readonly")).index("fecha").getAll());
    return lista.reverse();
  }

  async obtener(id) {
    return promesa((await this._almacen("readonly")).get(id));
  }

  async borrar(id) {
    return promesa((await this._almacen("readwrite")).delete(id));
  }

  async renombrar(id, nombre) {
    const grabacion = await this.obtener(id);
    if (!grabacion) return;
    grabacion.nombre = nombre;
    return this.guardar(grabacion);
  }

  /** Espacio usado y disponible (aproximado) para esta web. */
  static async espacio() {
    try {
      return await navigator.storage?.estimate?.();
    } catch {
      return null;
    }
  }
}
