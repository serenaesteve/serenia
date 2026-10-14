/**
 * Serenia · base de datos (IndexedDB)
 *
 * Almacenes:
 *   pistas     canciones y vídeos con sus metadatos (y el archivo, si se importó)
 *   listas     listas de reproducción del usuario
 *   historial  qué se escuchó y cuándo (para "Recientes" y estadísticas)
 *   ajustes    pares clave → valor (cola, volumen, ecualizador…)
 */

const NOMBRE = "serenia";
const VERSION = 1;

let conexion = null;

function peticion(p) {
  return new Promise((resolver, rechazar) => {
    p.onsuccess = () => resolver(p.result);
    p.onerror = () => rechazar(p.error);
  });
}

export async function abrir() {
  if (conexion) return conexion;
  const p = indexedDB.open(NOMBRE, VERSION);
  p.onupgradeneeded = () => {
    const db = p.result;
    if (!db.objectStoreNames.contains("pistas")) db.createObjectStore("pistas", { keyPath: "id" });
    if (!db.objectStoreNames.contains("listas")) db.createObjectStore("listas", { keyPath: "id" });
    if (!db.objectStoreNames.contains("historial")) db.createObjectStore("historial", { keyPath: "n", autoIncrement: true }).createIndex("fecha", "fecha");
    if (!db.objectStoreNames.contains("ajustes")) db.createObjectStore("ajustes", { keyPath: "clave" });
  };
  conexion = await peticion(p);
  // Si otra pestaña actualiza la versión, cerramos para no bloquearla
  conexion.onversionchange = () => conexion.close();
  return conexion;
}

async function almacen(nombre, modo = "readonly") {
  return (await abrir()).transaction(nombre, modo).objectStore(nombre);
}

export const bd = {
  async todas(nombre) {
    return peticion((await almacen(nombre)).getAll());
  },
  async obtener(nombre, clave) {
    return peticion((await almacen(nombre)).get(clave));
  },
  async guardar(nombre, valor) {
    return peticion((await almacen(nombre, "readwrite")).put(valor));
  },
  /** Varias escrituras en una sola transacción (mucho más rápido al importar). */
  async guardarVarias(nombre, valores) {
    const tx = (await abrir()).transaction(nombre, "readwrite");
    const a = tx.objectStore(nombre);
    for (const v of valores) a.put(v);
    return new Promise((resolver, rechazar) => {
      tx.oncomplete = resolver;
      tx.onerror = () => rechazar(tx.error);
      tx.onabort = () => rechazar(tx.error);
    });
  },
  async borrar(nombre, clave) {
    return peticion((await almacen(nombre, "readwrite")).delete(clave));
  },
  async vaciar(nombre) {
    return peticion((await almacen(nombre, "readwrite")).clear());
  },

  // Ajustes: atajos para guardar/leer valores sueltos
  async leerAjuste(clave, porDefecto) {
    try {
      const fila = await this.obtener("ajustes", clave);
      return fila ? fila.valor : porDefecto;
    } catch {
      return porDefecto;
    }
  },
  async guardarAjuste(clave, valor) {
    try {
      await this.guardar("ajustes", { clave, valor });
    } catch {
      /* sin almacenamiento: la app sigue funcionando sin recordar */
    }
  },

  /** Historial de las últimas N reproducciones (más reciente primero). */
  async historialReciente(limite = 50) {
    const a = await almacen("historial");
    return new Promise((resolver, rechazar) => {
      const resultado = [];
      const cursor = a.index("fecha").openCursor(null, "prev");
      cursor.onsuccess = () => {
        const c = cursor.result;
        if (!c || resultado.length >= limite) return resolver(resultado);
        resultado.push(c.value);
        c.continue();
      };
      cursor.onerror = () => rechazar(cursor.error);
    });
  },

  async borrarTodo() {
    for (const nombre of ["pistas", "listas", "historial", "ajustes"]) await this.vaciar(nombre);
  },
};

/** Identificador único para pistas y listas. */
export const nuevoId = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`);
