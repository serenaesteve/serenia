/**
 * Serenia · lector de etiquetas (metadatos incrustados)
 *
 * Lee directamente los bytes del archivo, sin librerías:
 *   - ID3v2.2 / 2.3 / 2.4 (MP3): título, artista, álbum, año, pista, género, letra (USLT) y carátula (APIC)
 *   - ID3v1 (los últimos 128 bytes del MP3), por si no hay ID3v2
 *   - Comentarios Vorbis (Ogg Vorbis, Ogg Opus y FLAC), con carátula METADATA_BLOCK_PICTURE
 *   - Átomos MP4 / M4A (moov › udta › meta › ilst): ©nam, ©ART, ©alb, ©day, trkn, covr
 *
 * @typedef {object} Etiquetas
 * @property {string} [titulo]
 * @property {string} [artista]
 * @property {string} [album]
 * @property {string} [anio]
 * @property {number} [numero]   número de pista
 * @property {string} [genero]
 * @property {string} [letra]    letra sin sincronizar
 * @property {Blob}   [portada]
 * @property {string} formato    qué tipo de etiqueta se encontró
 */

const GENEROS_ID3V1 =
  "Blues|Classic Rock|Country|Dance|Disco|Funk|Grunge|Hip-Hop|Jazz|Metal|New Age|Oldies|Other|Pop|R&B|Rap|Reggae|Rock|Techno|Industrial|Alternative|Ska|Death Metal|Pranks|Soundtrack|Euro-Techno|Ambient|Trip-Hop|Vocal|Jazz+Funk|Fusion|Trance|Classical|Instrumental|Acid|House|Game|Sound Clip|Gospel|Noise|Alt. Rock|Bass|Soul|Punk|Space|Meditative|Instrumental Pop|Instrumental Rock|Ethnic|Gothic|Darkwave|Techno-Industrial|Electronic|Pop-Folk|Eurodance|Dream|Southern Rock|Comedy|Cult|Gangsta|Top 40|Christian Rap|Pop/Funk|Jungle|Native American|Cabaret|New Wave|Psychedelic|Rave|Showtunes|Trailer|Lo-Fi|Tribal|Acid Punk|Acid Jazz|Polka|Retro|Musical|Rock & Roll|Hard Rock".split(
    "|",
  );

const leerBytes = async (blob, inicio, fin) => new Uint8Array(await blob.slice(inicio, fin).arrayBuffer());
const ascii = (b, i, n) => String.fromCharCode(...b.subarray(i, i + n));
const u32 = (b, i) => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
const u32le = (b, i) => (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0;
const u24 = (b, i) => (b[i] << 16) | (b[i + 1] << 8) | b[i + 2];
/** Entero "synchsafe" de ID3: 4 bytes de 7 bits útiles cada uno. */
const synchsafe = (b, i) => (b[i] << 21) | (b[i + 1] << 14) | (b[i + 2] << 7) | b[i + 3];
const utf8 = new TextDecoder("utf-8");

/** Lee las etiquetas de un archivo. Nunca lanza: si algo falla devuelve lo que haya podido leer. */
export async function leerEtiquetas(blob) {
  try {
    const cabecera = await leerBytes(blob, 0, 12);
    if (ascii(cabecera, 0, 3) === "ID3") return { ...(await leerID3v2(blob, cabecera)) };
    if (ascii(cabecera, 0, 4) === "OggS") return await leerOgg(blob);
    if (ascii(cabecera, 0, 4) === "fLaC") return await leerFlac(blob);
    if (ascii(cabecera, 4, 4) === "ftyp") return await leerMP4(blob);
    // MP3 sin ID3v2: probamos ID3v1 al final
    const v1 = await leerID3v1(blob);
    if (v1) return v1;
  } catch (error) {
    console.warn("Kroma · etiquetas:", error);
  }
  return { formato: "ninguna" };
}

// ════════════════════════════════════════════════════════════════════
//  ID3v2
// ════════════════════════════════════════════════════════════════════

/** Equivalencias de los identificadores de 3 letras de ID3v2.2 */
const V22 = { TT2: "TIT2", TP1: "TPE1", TP2: "TPE2", TAL: "TALB", TYE: "TYER", TRK: "TRCK", TCO: "TCON", PIC: "APIC", ULT: "USLT" };

function decodificarTexto(bytes, codificacion) {
  let texto;
  if (codificacion === 1 || codificacion === 2) {
    // UTF-16 con BOM (1) o UTF-16BE sin BOM (2)
    let be = codificacion === 2;
    let inicio = 0;
    if (bytes[0] === 0xff && bytes[1] === 0xfe) inicio = 2;
    else if (bytes[0] === 0xfe && bytes[1] === 0xff) (be = true), (inicio = 2);
    texto = new TextDecoder(be ? "utf-16be" : "utf-16le").decode(bytes.subarray(inicio));
  } else if (codificacion === 3) texto = utf8.decode(bytes);
  else texto = new TextDecoder("latin1").decode(bytes);
  // Puede haber varios valores separados por \0: nos quedamos con el primero
  return texto.split("\0")[0].trim();
}

/** Posición del final de una cadena terminada en \0 (o \0\0 en UTF-16). */
function finDeCadena(b, i, codificacion) {
  if (codificacion === 1 || codificacion === 2) {
    while (i + 1 < b.length && !(b[i] === 0 && b[i + 1] === 0)) i += 2;
    return i + 2;
  }
  while (i < b.length && b[i] !== 0) i++;
  return i + 1;
}

/** Quita la "desincronización" de ID3 (0xFF 0x00 → 0xFF). */
function quitarDesincronizacion(b) {
  const salida = [];
  for (let i = 0; i < b.length; i++) {
    salida.push(b[i]);
    if (b[i] === 0xff && b[i + 1] === 0x00) i++;
  }
  return Uint8Array.from(salida);
}

async function leerID3v2(blob, cabecera) {
  const version = cabecera[3];
  const banderas = cabecera[5];
  const tam = synchsafe(cabecera, 6);
  let b = await leerBytes(blob, 10, 10 + tam);
  if (banderas & 0x80 && version < 4) b = quitarDesincronizacion(b);

  let i = 0;
  if (banderas & 0x40) {
    // Cabecera extendida: la saltamos
    i = version === 4 ? synchsafe(b, 0) : u32(b, 0) + 4;
  }

  const r = { formato: `ID3v2.${version}` };
  const largoId = version === 2 ? 3 : 4;
  const largoCabecera = version === 2 ? 6 : 10;

  while (i + largoCabecera <= b.length) {
    let id = ascii(b, i, largoId);
    if (!/^[A-Z0-9]+$/.test(id)) break; // relleno
    const tamFrame = version === 2 ? u24(b, i + 3) : version === 4 ? synchsafe(b, i + 4) : u32(b, i + 4);
    const banderasFrame = version === 2 ? 0 : b[i + 9];
    let datos = b.subarray(i + largoCabecera, i + largoCabecera + tamFrame);
    i += largoCabecera + tamFrame;
    if (!tamFrame) continue;
    if (version === 2) id = V22[id] ?? id;
    if (version === 4 && banderasFrame & 0x02) datos = quitarDesincronizacion(datos);

    const cod = datos[0];
    switch (id) {
      case "TIT2":
        r.titulo = decodificarTexto(datos.subarray(1), cod);
        break;
      case "TPE1":
        r.artista = decodificarTexto(datos.subarray(1), cod);
        break;
      case "TPE2":
        r.artistaAlbum = decodificarTexto(datos.subarray(1), cod);
        break;
      case "TALB":
        r.album = decodificarTexto(datos.subarray(1), cod);
        break;
      case "TYER":
      case "TDRC":
        r.anio = decodificarTexto(datos.subarray(1), cod).slice(0, 4);
        break;
      case "TRCK":
        r.numero = parseInt(decodificarTexto(datos.subarray(1), cod), 10) || undefined;
        break;
      case "TCON":
        r.genero = genero(decodificarTexto(datos.subarray(1), cod));
        break;
      case "USLT": {
        // codificación, idioma (3), descripción\0, texto
        const fin = finDeCadena(datos, 4, cod);
        r.letra = decodificarTexto(datos.subarray(fin), cod) || r.letra;
        break;
      }
      case "APIC": {
        if (r.portada && r.tipoPortada === 3) break; // ya tenemos la portada frontal
        let j;
        let mime;
        if (version === 2) {
          const formato = ascii(datos, 1, 3).toUpperCase();
          mime = formato === "PNG" ? "image/png" : "image/jpeg";
          j = 4;
        } else {
          const finMime = finDeCadena(datos, 1, 0);
          mime = ascii(datos, 1, finMime - 2) || "image/jpeg";
          if (!mime.includes("/")) mime = `image/${mime.toLowerCase().replace("jpg", "jpeg")}`;
          j = finMime;
        }
        const tipoImagen = datos[j]; // 3 = portada frontal
        j = finDeCadena(datos, j + 1, cod);
        r.portada = new Blob([datos.slice(j)], { type: mime });
        r.tipoPortada = tipoImagen;
        break;
      }
    }
  }
  delete r.tipoPortada;
  if (!r.titulo) Object.assign(r, { ...(await leerID3v1(blob)), ...r });
  return r;
}

function genero(texto) {
  // "(17)", "17", "(17)Rock" o directamente "Rock"
  const m = texto.match(/^\(?(\d+)\)?(.*)$/);
  if (m) return m[2]?.trim() || GENEROS_ID3V1[Number(m[1])] || texto;
  return texto;
}

async function leerID3v1(blob) {
  if (blob.size < 128) return null;
  const b = await leerBytes(blob, blob.size - 128, blob.size);
  if (ascii(b, 0, 3) !== "TAG") return null;
  const campo = (i, n) => new TextDecoder("latin1").decode(b.subarray(i, i + n)).replace(/\0.*$/, "").trim();
  const r = { formato: "ID3v1", titulo: campo(3, 30), artista: campo(33, 30), album: campo(63, 30), anio: campo(93, 4) };
  if (b[125] === 0 && b[126]) r.numero = b[126];
  if (GENEROS_ID3V1[b[127]]) r.genero = GENEROS_ID3V1[b[127]];
  return r;
}

// ════════════════════════════════════════════════════════════════════
//  Comentarios Vorbis (Ogg y FLAC)
// ════════════════════════════════════════════════════════════════════

/** Interpreta un bloque de comentarios: longitud del vendedor, vendedor, nº de comentarios y "CLAVE=valor". */
function comentariosVorbis(b, i, formato) {
  const r = { formato };
  i += 4 + u32le(b, i); // saltamos el "vendor"
  const total = u32le(b, i);
  i += 4;
  for (let n = 0; n < total && i + 4 <= b.length; n++) {
    const largo = u32le(b, i);
    const texto = utf8.decode(b.subarray(i + 4, i + 4 + largo));
    i += 4 + largo;
    const igual = texto.indexOf("=");
    if (igual < 0) continue;
    const clave = texto.slice(0, igual).toUpperCase();
    const valor = texto.slice(igual + 1).trim();
    if (clave === "TITLE") r.titulo = valor;
    else if (clave === "ARTIST") r.artista ??= valor;
    else if (clave === "ALBUMARTIST") r.artistaAlbum = valor;
    else if (clave === "ALBUM") r.album = valor;
    else if (clave === "DATE" || clave === "YEAR") r.anio = valor.slice(0, 4);
    else if (clave === "TRACKNUMBER") r.numero = parseInt(valor, 10) || undefined;
    else if (clave === "GENRE") r.genero = valor;
    else if (clave === "LYRICS" || clave === "UNSYNCEDLYRICS") r.letra = valor;
    else if (clave === "METADATA_BLOCK_PICTURE") {
      try {
        const bin = Uint8Array.from(atob(valor), (c) => c.charCodeAt(0));
        r.portada = bloqueImagenFlac(bin, 0);
      } catch {
        /* imagen mal codificada: la ignoramos */
      }
    }
  }
  return r;
}

/** Bloque PICTURE de FLAC: tipo, mime, descripción, medidas y los bytes de la imagen. */
function bloqueImagenFlac(b, i) {
  i += 4; // tipo de imagen
  const largoMime = u32(b, i);
  const mime = ascii(b, i + 4, largoMime);
  i += 4 + largoMime;
  i += 4 + u32(b, i); // descripción
  i += 16; // ancho, alto, profundidad, colores
  const largo = u32(b, i);
  return new Blob([b.slice(i + 4, i + 4 + largo)], { type: mime || "image/jpeg" });
}

/**
 * Ogg: el archivo son "páginas" (OggS…) y dentro van "paquetes".
 * El segundo paquete es la cabecera de comentarios (OpusTags o \x03vorbis).
 */
async function leerOgg(blob) {
  const b = await leerBytes(blob, 0, Math.min(blob.size, 2 * 1024 * 1024));
  const paquetes = [];
  let actual = [];
  let i = 0;
  while (i + 27 <= b.length && paquetes.length < 2 && ascii(b, i, 4) === "OggS") {
    const segmentos = b[i + 26];
    const tabla = b.subarray(i + 27, i + 27 + segmentos);
    let datos = i + 27 + segmentos;
    for (const largo of tabla) {
      actual.push(b.subarray(datos, datos + largo));
      datos += largo;
      if (largo < 255) {
        // Un segmento de menos de 255 bytes cierra el paquete
        const total = actual.reduce((s, p) => s + p.length, 0);
        const paquete = new Uint8Array(total);
        let k = 0;
        for (const p of actual) paquete.set(p, (k += p.length) - p.length);
        paquetes.push(paquete);
        actual = [];
        if (paquetes.length === 2) break;
      }
    }
    i = datos;
  }
  const c = paquetes[1];
  if (!c) return { formato: "Ogg" };
  if (ascii(c, 0, 8) === "OpusTags") return comentariosVorbis(c, 8, "Vorbis (Opus)");
  if (c[0] === 3 && ascii(c, 1, 6) === "vorbis") return comentariosVorbis(c, 7, "Vorbis (Ogg)");
  return { formato: "Ogg" };
}

async function leerFlac(blob) {
  const b = await leerBytes(blob, 0, Math.min(blob.size, 4 * 1024 * 1024));
  let i = 4;
  let r = { formato: "Vorbis (FLAC)" };
  let ultimo = false;
  while (!ultimo && i + 4 <= b.length) {
    ultimo = (b[i] & 0x80) !== 0;
    const tipo = b[i] & 0x7f;
    const largo = u24(b, i + 1);
    if (tipo === 4) r = { ...comentariosVorbis(b, i + 4, r.formato), portada: r.portada };
    if (tipo === 6 && !r.portada) r.portada = bloqueImagenFlac(b, i + 4);
    i += 4 + largo;
  }
  return r;
}

// ════════════════════════════════════════════════════════════════════
//  MP4 / M4A
// ════════════════════════════════════════════════════════════════════

async function leerMP4(blob) {
  // Recorremos las cajas de primer nivel leyendo solo sus cabeceras hasta encontrar "moov"
  let pos = 0;
  while (pos + 8 <= blob.size) {
    const cab = await leerBytes(blob, pos, pos + 16);
    let tam = u32(cab, 0);
    const tipo = ascii(cab, 4, 4);
    if (tam === 1) tam = Number((BigInt(u32(cab, 8)) << 32n) | BigInt(u32(cab, 12)));
    if (tam === 0) tam = blob.size - pos;
    if (tam < 8) break;
    if (tipo === "moov") {
      const moov = await leerBytes(blob, pos, pos + tam);
      return interpretarIlst(moov);
    }
    pos += tam;
  }
  return { formato: "MP4" };
}

/** Busca una caja por ruta (["moov","udta","meta","ilst"]) dentro de un bloque. */
function buscarCaja(b, ruta, inicio = 8, fin = b.length) {
  let i = inicio;
  while (i + 8 <= fin) {
    const tam = u32(b, i);
    const tipo = ascii(b, i + 4, 4);
    if (tam < 8) return null;
    if (tipo === ruta[0]) {
      if (ruta.length === 1) return { i, tam };
      // "meta" es una "full box": 4 bytes de versión/banderas antes de sus hijas
      const hijas = i + 8 + (tipo === "meta" ? 4 : 0);
      return buscarCaja(b, ruta.slice(1), hijas, i + tam);
    }
    i += tam;
  }
  return null;
}

function interpretarIlst(moov) {
  const r = { formato: "MP4 (iTunes)" };
  const ilst = buscarCaja(moov, ["udta", "meta", "ilst"]);
  if (!ilst) return r;
  let i = ilst.i + 8;
  const fin = ilst.i + ilst.tam;
  while (i + 8 <= fin) {
    const tam = u32(moov, i);
    const clave = String.fromCharCode(...moov.subarray(i + 4, i + 8));
    const data = buscarCaja(moov, ["data"], i + 8, i + tam);
    if (data) {
      const tipo = u32(moov, data.i + 8) & 0xffffff;
      const valor = moov.subarray(data.i + 16, data.i + data.tam);
      const texto = () => utf8.decode(valor);
      switch (clave) {
        case "\xa9nam":
          r.titulo = texto();
          break;
        case "\xa9ART":
          r.artista = texto();
          break;
        case "aART":
          r.artistaAlbum = texto();
          break;
        case "\xa9alb":
          r.album = texto();
          break;
        case "\xa9day":
          r.anio = texto().slice(0, 4);
          break;
        case "\xa9gen":
          r.genero = texto();
          break;
        case "\xa9lyr":
          r.letra = texto();
          break;
        case "trkn":
          r.numero = (valor[2] << 8) | valor[3] || undefined;
          break;
        case "covr":
          r.portada = new Blob([valor.slice()], { type: tipo === 14 ? "image/png" : "image/jpeg" });
          break;
      }
    }
    if (tam < 8) break;
    i += tam;
  }
  return r;
}
