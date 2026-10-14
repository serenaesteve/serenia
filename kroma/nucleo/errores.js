/**
 * Kroma · errores
 *
 * Jerarquía de excepciones propia + traducción de los errores del navegador
 * (MediaError y DOMException) a mensajes que entiende cualquier persona.
 */

export class KromaError extends Error {
  /**
   * @param {string} mensaje   texto para el usuario
   * @param {object} [o]
   * @param {string} [o.codigo] identificador corto (p. ej. "permiso-denegado")
   * @param {unknown} [o.causa] error original
   */
  constructor(mensaje, { codigo = "desconocido", causa } = {}) {
    super(mensaje, { cause: causa });
    this.name = new.target.name;
    this.codigo = codigo;
  }
}

/** El archivo existe pero el navegador no sabe decodificarlo. */
export class ErrorFormato extends KromaError {}

/** No se pudo descargar un recurso (404, sin red, CORS, file://…). */
export class ErrorCarga extends KromaError {}

/** El usuario o el navegador denegó el acceso a micro/cámara/pantalla. */
export class ErrorPermiso extends KromaError {}

/** Falta una API en este navegador (MediaRecorder, PiP…). */
export class ErrorSoporte extends KromaError {}

// ── MediaError ───────────────────────────────────────────────────────
// El elemento <audio>/<video> expone media.error con un código numérico.
const MENSAJES_MEDIA = {
  1: ["abortado", "La carga del archivo se ha cancelado."],
  2: ["red", "Error de red al descargar el archivo."],
  3: ["decodificacion", "El archivo está dañado o usa un códec que el navegador no puede decodificar."],
  4: ["no-soportado", "El navegador no puede reproducir este archivo: no existe o su formato no está soportado."],
};

/** Convierte media.error en un KromaError legible. */
export function desdeMediaError(mediaError) {
  const [codigo, mensaje] = MENSAJES_MEDIA[mediaError?.code] ?? ["desconocido", "Error desconocido del reproductor."];
  const Clase = codigo === "red" ? ErrorCarga : ErrorFormato;
  const detalle = mediaError?.message ? ` (${mediaError.message})` : "";
  return new Clase(mensaje + detalle, { codigo, causa: mediaError });
}

// ── DOMException ─────────────────────────────────────────────────────
// play(), getUserMedia(), requestFullscreen()… rechazan con DOMException.
const MENSAJES_DOM = {
  NotAllowedError: ["permiso-denegado", "Permiso denegado. Revisa los permisos del sitio o pulsa primero en la página.", ErrorPermiso],
  NotFoundError: ["sin-dispositivo", "No se ha encontrado el dispositivo (¿hay micrófono o cámara conectados?).", ErrorPermiso],
  NotReadableError: ["dispositivo-ocupado", "El dispositivo está siendo usado por otra aplicación.", ErrorPermiso],
  OverconstrainedError: ["restricciones", "Ningún dispositivo cumple la configuración pedida.", ErrorPermiso],
  SecurityError: ["seguridad", "El navegador lo ha bloqueado por seguridad. Abre la página desde http://localhost o https.", ErrorPermiso],
  NotSupportedError: ["no-soportado", "Este navegador no soporta la operación o el formato.", ErrorSoporte],
  EncodingError: ["decodificacion", "No se ha podido decodificar el archivo.", ErrorFormato],
  AbortError: ["abortado", "La operación se ha interrumpido.", KromaError],
};

/** Convierte cualquier excepción en un KromaError con un mensaje claro. */
export function normalizarError(error) {
  if (error instanceof KromaError) return error;
  const entrada = MENSAJES_DOM[error?.name];
  if (entrada) {
    const [codigo, mensaje, Clase] = entrada;
    return new Clase(mensaje, { codigo, causa: error });
  }
  if (error instanceof TypeError && /fetch/i.test(error.message)) {
    return new ErrorCarga("No se pudo descargar el recurso. ¿Estás abriendo la página con un servidor local?", {
      codigo: "red",
      causa: error,
    });
  }
  return new KromaError(error?.message || String(error), { causa: error });
}

/** Comprueba que estamos en un contexto donde funcionan cámara/micro. */
export function exigirContextoSeguro() {
  if (!window.isSecureContext) {
    throw new ErrorPermiso("La captura de audio y vídeo solo funciona en https o en http://localhost.", {
      codigo: "contexto-inseguro",
    });
  }
}
