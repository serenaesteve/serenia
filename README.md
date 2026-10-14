# Serenia

> Proyecto del **RA3** · 0489 Programación multimedia y dispositivos móviles · DAM
> *«Crea tu propia librería multimedia / reproductor de audio / reproductor de vídeo»*

**Serenia** es un reproductor multimedia completo para el navegador, al estilo de Spotify o Apple Music pero para **música y vídeo**. Está hecho con HTML, CSS y JavaScript, sin frameworks ni dependencias. Funciona encima de **Kroma**, una librería multimedia propia (reproductores, procesado, conversión, captura y animación) que también forma parte del proyecto.

Importas tus archivos o carpetas y la app lee sus etiquetas y carátulas, calcula la forma de onda y el volumen de cada canción, empareja letras y subtítulos y lo guarda todo en el navegador. Desde ahí la escuchas con cola, fundidos, ecualizador, letras sincronizadas, efectos de vídeo y mini reproductor flotante.

---

## Índice

1. [Cómo ponerlo en marcha](#1-cómo-ponerlo-en-marcha)
2. [Qué hace](#2-qué-hace)
3. [Atajos de teclado](#3-atajos-de-teclado)
4. [Arquitectura](#4-arquitectura)
5. [Criterios de evaluación del RA3](#5-criterios-de-evaluación-del-ra3)
6. [Análisis de entornos de desarrollo multimedia](#6-análisis-de-entornos-de-desarrollo-multimedia)
7. [Depuración y pruebas](#7-depuración-y-pruebas)
8. [Limitaciones y mejoras futuras](#8-limitaciones-y-mejoras-futuras)
9. [Créditos](#9-créditos)

---

## 1. Cómo ponerlo en marcha

La app usa módulos ES, `fetch()` y un *service worker*, así que **hay que abrirla desde un servidor local**: con doble clic (`file://`) no funciona, y la propia página lo avisa.

```bash
cd kroma
python3 -m http.server 8000
# abre http://localhost:8000
```

También vale la extensión **Live Server** de VS Code.

- La **primera vez** se carga sola una biblioteca de demostración: 6 canciones en 3 álbumes y 3 vídeos con subtítulos y capítulos.
- Para añadir tu música: botón **Importar**, arrastrar archivos o carpetas a la ventana, o **Ajustes › Biblioteca**.
- Se puede **instalar como aplicación** (PWA) desde el botón que aparece en la cabecera, o desde el menú del navegador.

Lo he probado en Chromium 156, tanto en escritorio como en vista móvil de 390 px. Las APIs más nuevas (mini reproductor flotante, Picture-in-Picture) solo existen en Chrome y Edge; en otros navegadores la app lo detecta y avisa.

## 2. Qué hace

### Biblioteca
- **Importar** archivos sueltos o **carpetas enteras** (botón o arrastrando a la ventana, carpetas anidadas incluidas).
- **Lectura de etiquetas byte a byte**, sin librerías externas:
  - **ID3v2.2/2.3/2.4** e ID3v1 (MP3)
  - **comentarios Vorbis** (Ogg, Opus, FLAC)
  - **átomos MP4** (M4A, MP4)
  - incluye título, artista, álbum, año, nº de pista, género, letra y **carátula**.
- Si un archivo no tiene etiquetas, se **deduce del nombre**: `01 - Artista - Título.mp3`.
- **Archivos acompañantes**: letra `cancion.lrc` o `cancion.vtt`, subtítulos `peli.es.srt`/`peli.en.vtt`, capítulos `peli.capitulos.vtt` y carátula de carpeta `cover.jpg`/`folder.jpg`.
- Al importar se **analiza** cada canción: forma de onda (180 picos por canal) y **sonoridad RMS** para normalizar. En los vídeos se saca la resolución y una **miniatura**.
- **Color dominante** de cada carátula: tiñe la interfaz mientras suena.
- Todo se guarda en **IndexedDB**: sigue ahí al cerrar el navegador.
- Vistas de **Inicio** (accesos rápidos, recientes, estadísticas), **Canciones** (filtrar y ordenar), **Álbumes**, **Artistas**, **Vídeos** («continuar viendo»), **Favoritos**, **Listas** y **Explorar por géneros**.
- **Listas de reproducción**: crear, renombrar, reordenar y añadir arrastrando a la barra lateral, con portada en mosaico.
- **Editar la información** de cada pista y cambiar su carátula.

### Reproducción
- **Motor propio** con cola: reproducir a continuación, añadir al final, quitar y **reordenar arrastrando**.
- **Aleatorio** (Fisher–Yates, que se puede deshacer) y **repetir** todas o una.
- **Fundido cruzado** entre canciones (0–12 s), con dos `<audio>` que se alternan y precarga de la siguiente.
- **Normalización de volumen**: cada canción tiene su ganancia, y un limitador evita la saturación.
- **Ecualizador de 5 bandas** con presets, **reverb por convolución**, **balance** y **velocidad** (sin cambiar el tono).
- **Sesión recordada**: al volver, la cola y la posición siguen donde estaban; los vídeos recuerdan **por dónde ibas**.
- **Temporizador de apagado** (15/30/45/60 min o «al acabar la canción») con bajada suave del volumen.
- **Media Session**: las teclas multimedia del teclado y la pantalla de bloqueo controlan la app.
- **Mini reproductor flotante** (Document Picture-in-Picture): una ventanita siempre visible con carátula, controles y visualizador.
- Barra de progreso con la **forma de onda** de la canción.

### «Ahora suena»
- **Música**: carátula grande con **inclinación 3D** al pasar el ratón, fondo con la carátula desenfocada en movimiento y, a elegir:
  - **letra karaoke** (LRC/VTT; se puede pulsar una línea para saltar a ella)
  - **visualizador** (barras, círculo u osciloscopio) con los colores de la carátula.
- **Vídeo**: el reproductor de vídeo de Kroma con **subtítulos** en varios idiomas (los SRT se convierten al vuelo), **capítulos** marcados en la barra, **miniatura al pasar el ratón**, **13 efectos en tiempo real**, captura de fotograma, PiP y pantalla completa.
- Si sales de la vista con un vídeo sonando, sigue en una **ventanita flotante** que se puede arrastrar.

### Herramientas
- **Grabadora**: graba micrófono, cámara o pantalla, guarda en IndexedDB y puede **añadir la grabación a la biblioteca**.
- **Conversor**:
  - audio → WAV 16/24/32 bits, con remuestreo, mono/estéreo, recorte, normalización y fundidos
  - vídeo → PNG/JPEG/WebP y hoja de contactos
  - imágenes entre formatos
  - SRT ⇄ VTT con corrección de desfase.
- **Exportar a WAV** cualquier canción con tu ecualizador aplicado.
- **Diagnóstico**: monitor de eventos en directo, botones que provocan errores reales, soporte del navegador y dónde se cumple cada criterio.

### Diseño
Serenia sigue el estilo de mi web personal, [serenaesteve.com](https://serenaesteve.com) (cristal, aurora difuminada, Playfair Display), con una paleta propia en **azul y coral**:
- **Tema claro**: fondo de **aurora pastel** con manchas azul cielo `#9CC4FF`, coral `#FFC1AE` y lavanda `#C9D2FF` sobre `#F4F6FC`. Se mueven muy despacio y llevan un grano fino por encima.
- **Tema oscuro**: azul noche `#0B1020` con auroras azul, índigo y coral. Se cambia con el botón de sol/luna o desde Ajustes; por defecto sigue al sistema.
- **Paneles de cristal** (`backdrop-filter`) muy redondeados.
- **Botones en píldora** azul marino `#1C2238` (blanco azulado en oscuro), con el texto en mayúsculas espaciadas.
- **Acento azul** `#2F6BFF`, y **coral** `#FF7F66` en el logo y en los degradados. Si se activa el *color dinámico*, el acento pasa a ser el color de la carátula que suena.
- **Tipografías**: **Playfair Display** para los titulares (negrita mezclada con cursiva: «Buenos *días*»), **DM Sans** para el texto y **DM Mono** para tiempos y datos técnicos.
- **Etiquetas** en mayúsculas con una raya delante («—— BIBLIOTECA»).
- **Logo**: el mismo en la app y en la pestaña del navegador (`iconos/logo-claro.svg` / `logo-oscuro.svg`, que cambian con el tema).
- Todos los colores son **variables CSS** (`app/app.css`, bloques `[data-tema="claro"]` y `[data-tema="oscuro"]`). La librería Kroma se tematiza con sus propias variables `--kr-*`.

### Interfaz
- **Paleta de comandos** (`Ctrl + K`): busca canciones, álbumes, artistas, listas y acciones.
- **Menú contextual** (clic derecho) en cualquier canción.
- **Responsive**: en móvil el menú lateral se convierte en pestañas inferiores.
- Respeta `prefers-reduced-motion`.
- **PWA** instalable, con funcionamiento sin conexión.

## 3. Atajos de teclado

| Tecla | Acción | | Tecla | Acción |
|---|---|---|---|---|
| `Espacio` / `K` | Reproducir / pausar | | `S` | Aleatorio |
| `←` / `→` | −5 s / +5 s | | `R` | Repetir |
| `Mayús` + `←` / `→` | Anterior / siguiente | | `L` | Letra |
| `↑` / `↓` | Volumen | | `Q` | Cola |
| `M` | Silencio | | `F` | Favorito |
| `Ctrl` + `K` o `/` | Paleta de comandos | | `?` | Atajos del vídeo (con el vídeo enfocado) |

Con el reproductor de vídeo enfocado: `E` efectos, `C` subtítulos, `S` captura, `F` pantalla completa, `P` PiP, `,` / `.` fotograma a fotograma, `0`–`9` saltar al 0–90 %.

## 4. Arquitectura

```
kroma/
├── index.html                 Esqueleto de la app
├── manifest.webmanifest, sw.js, iconos/   PWA
├── app/                       ── SERENIA (la aplicación) ──
│   ├── main.js                Arranque, router (#/ruta), atajos, importar, vídeo flotante, color dinámico
│   ├── contexto.js            Objetos compartidos entre módulos (motor, vídeo, navegar…)
│   ├── app.css                Estilos de la app
│   ├── datos/
│   │   ├── bd.js              IndexedDB: pistas, listas, historial, ajustes
│   │   ├── etiquetas.js       Lector de ID3v2/ID3v1, Vorbis (Ogg/FLAC) y MP4
│   │   ├── importador.js      Archivo → pista: etiquetas, análisis, acompañantes
│   │   ├── colores.js         Color dominante de una carátula
│   │   └── biblioteca.js      Biblioteca en memoria: álbumes, artistas, búsqueda, listas
│   ├── motor/
│   │   └── Motor.js           Cola, fundido, normalización, grafo de Web Audio, sesión, temporizador
│   ├── ui/                    Barra, panel (cola/letra), letra karaoke, paleta, menús, tablas, mini reproductor
│   └── vistas/                Inicio, colección, «Ahora suena», herramientas/diagnóstico/ajustes
├── kroma/                     ── KROMA (la librería multimedia) ──
│   ├── reproductores/         ReproductorBase → ReproductorVideo, ReproductorAudio
│   ├── procesado/             Filtros de vídeo por píxel, cadena de Web Audio, forma de onda
│   ├── conversion/            WAV, remuestreo, imágenes, hoja de contactos
│   ├── subtitulos/            VTT, SRT y LRC: lectura, conversión, búsqueda binaria
│   ├── captura/               Grabadora (MediaRecorder) + almacén IndexedDB
│   ├── animacion/             Visualizador y notificaciones
│   ├── componentes/           Laboratorio de conversión, monitor de eventos, soporte
│   └── nucleo/                Errores, registro de depuración, tipos de media, utilidades
├── media/                     Biblioteca de demostración (generada por mí)
└── herramientas/
    └── generar-biblioteca.py  Sintetiza las canciones, dibuja las carátulas y genera los vídeos
```

Unas **9.900 líneas de JavaScript** y **5.300 de CSS**, en módulos ES con clases y comentarios JSDoc.

### Capas

```
 Vistas y UI  ──usa──►  Motor  ──usa──►  Biblioteca  ──usa──►  IndexedDB
     │                    │                  ▲
     │                    ▼                  │
     └────────────►  Librería Kroma  ◄── Importador (etiquetas, análisis, colores)
             (ReproductorVideo, Visualizador, conversor, subtítulos, grabadora…)
```

La UI no toca los `<audio>`/`<video>` directamente: llama al motor, y el motor avisa con eventos (`pista`, `estado`, `cola`, `modo`, `volumen`, `error`…) a los que se suscriben la barra, el panel y las vistas.

### Cómo viaja el sonido

```
 <audio> A ─ fuente ─ ganancia A ┐   (normalización × fundido)
 <audio> B ─ fuente ─ ganancia B ┼─► ecualizador 5 bandas ─┬─ seco ─────────────┬─► balance ─► limitador ─► analizador ─► altavoces
 <video>   ─ fuente ─ ganancia V ┘                         └─ reverb (convolver)┘                              │
                                                                                                    visualizadores, mini reproductor
```

- El **fundido cruzado** programa dos rampas lineales sobre las ganancias A y B (`linearRampToValueAtTime`): una baja y la otra sube a la vez.
- La **reverb** es un `ConvolverNode` con una respuesta al impulso sintética (ruido con caída exponencial). Se mezcla seco/húmedo con potencia constante (seno/coseno).
- El **limitador** es un `DynamicsCompressorNode` con umbral −1 dBFS y ratio 20:1.

### Cómo se leen las etiquetas (ejemplo ID3v2)

```
"ID3" │ versión │ banderas │ tamaño (4 bytes "synchsafe": 7 bits útiles cada uno)
  └─ frames: id (TIT2, TPE1, TALB, APIC…) │ tamaño │ banderas │ datos
       └─ texto: 1 byte de codificación (0 Latin-1, 1 UTF-16 con BOM, 2 UTF-16BE, 3 UTF-8) + cadena
       └─ APIC: codificación │ MIME\0 │ tipo de imagen │ descripción\0 │ bytes de la imagen → Blob
```

En Ogg hay que reconstruir los **paquetes** a partir de las **páginas** (`OggS`) para encontrar `OpusTags`/`\x03vorbis`. En MP4 se recorren las cajas `moov › udta › meta › ilst`.

## 5. Criterios de evaluación del RA3

| | Criterio | Dónde está |
|---|---|---|
| **a** | Se han analizado entornos de desarrollo multimedia | **Diagnóstico › Tu navegador**: detección en vivo de codecs (`canPlayType`), formatos de grabación (`MediaRecorder.isTypeSupported`) y APIs. Comparativa con Android, JavaFX, Python y FFmpeg en el [apartado 6](#6-análisis-de-entornos-de-desarrollo-multimedia). |
| **b** | Se han reconocido las clases que permiten la captura, procesamiento y almacenamiento de datos multimedia | **Captura**: `getUserMedia`, `getDisplayMedia`, `MediaStream` y `MediaRecorder` (`kroma/captura/Grabadora.js`). **Procesamiento de los datos crudos**: `Blob`, `ArrayBuffer`, `DataView` y `TextDecoder` para leer las etiquetas byte a byte (`app/datos/etiquetas.js`); `AudioBuffer` para el análisis. **Almacenamiento**: `IndexedDB` con Blobs (`app/datos/bd.js`), `localStorage`, Cache Storage del service worker. |
| **c** | Se han utilizado clases para la conversión de datos multimedia de un formato a otro | `kroma/conversion/conversor.js`: `AudioBuffer` → **WAV** (cabecera RIFF escrita con `DataView`), remuestreo con `OfflineAudioContext`, fotograma → PNG/JPEG/WebP con `canvas.toBlob`, imagen → otro formato con `createImageBitmap`. `kroma/subtitulos/subtitulos.js`: **SRT ⇄ VTT** y **LRC**. Exportación a WAV **con el ecualizador aplicado** (`renderizarConEcualizador`). |
| **d** | Se han utilizado clases para procesar datos multimedia | `app/motor/Motor.js`: `BiquadFilterNode` (EQ), `ConvolverNode` (reverb), `StereoPannerNode`, `DynamicsCompressorNode` (limitador), `GainNode` (normalización y fundido), `AnalyserNode` (FFT). `app/datos/importador.js`: picos y sonoridad RMS. `app/datos/colores.js`: cuantización de color. `kroma/procesado/filtrosVideo.js`: 13 filtros de vídeo por píxel (LUT, convolución 3×3, Sobel…). |
| **e** | Se han utilizado clases para el control de eventos, tipos de media y excepciones | **Eventos**: el motor y la biblioteca extienden `EventTarget`; `CustomEvent`, `IntersectionObserver`, `ResizeObserver`, arrastrar y soltar (`DataTransfer`, `webkitGetAsEntry`), teclado, `MediaSession`. **Tipos de media**: detección por MIME/extensión, elección de fuente, `canPlayType`. **Excepciones**: jerarquía `KromaError` → `ErrorFormato`, `ErrorCarga`, `ErrorPermiso`, `ErrorSoporte`, y traducción de `MediaError` y `DOMException` (`kroma/nucleo/errores.js`). Botones en **Diagnóstico** que provocan errores reales. |
| **f** | Se han utilizado clases para la creación y control de animaciones | Visualizadores con `requestAnimationFrame` (el del mini reproductor usa el de su **propia ventana**, para no congelarse en segundo plano), letra karaoke con transiciones, carátula 3D, fondos animados, transiciones entre vistas, barritas de «sonando», tostadas. Las animaciones **se controlan**: se pausan fuera de pantalla y respetan `prefers-reduced-motion`. |
| **g** | Se han utilizado clases para reproducir contenidos multimedia | `HTMLMediaElement` controlado por el motor (cola, fundido, sesión), `ReproductorVideo` de Kroma, **Document Picture-in-Picture**, **Picture-in-Picture**, **Fullscreen API** y **Media Session API**. |
| **h** | Se han depurado y documentado los programas desarrollados | Modo depuración (`?depurar` en la URL o el interruptor de Diagnóstico), registro con historial (`kroma/nucleo/registro.js`), monitor de eventos, `window.KromaPlayer` en la consola, JSDoc en todo el código, esta memoria y el [registro de incidencias](#incidencias-encontradas-y-cómo-se-resolvieron). |

## 6. Análisis de entornos de desarrollo multimedia

| Entorno | Reproducción | Captura | Procesado | Conversión | Animación |
|---|---|---|---|---|---|
| **Web (HTML5 + Web APIs)** ← *este proyecto* | `HTMLMediaElement` | `getUserMedia`, `MediaRecorder` | Web Audio API, Canvas 2D | `OfflineAudioContext`, `canvas.toBlob` | CSS, `requestAnimationFrame` |
| **Android (Kotlin/Java)** | `MediaPlayer`, ExoPlayer (Media3) | `MediaRecorder`, CameraX | `AudioTrack`, OpenGL ES | `MediaCodec`, `MediaMuxer` | `ObjectAnimator`, MotionLayout |
| **Java de escritorio (JavaFX)** | `Media`, `MediaPlayer`, `MediaView` | `javax.sound.sampled` | `AudioSpectrumListener`, `PixelWriter` | `AudioSystem` (WAV/AIFF) | `Timeline`, `Transition` |
| **Python** | pygame, python-vlc | sounddevice, OpenCV | NumPy, librosa, OpenCV | FFmpeg, pydub | pygame, Manim |
| **Línea de comandos** | ffplay | ffmpeg | filtros de ffmpeg, Whisper | ffmpeg | — |

**Por qué la web:**
- Funciona en Windows, Linux, macOS y móvil sin instalar nada, y con la PWA hasta se instala como una app.
- El navegador ya trae decodificadores de MP3, AAC, Opus, FLAC, H.264, VP9 y AV1.
- Web Audio ofrece un grafo de procesado comparable al de una aplicación de escritorio.
- Es la plataforma que hemos trabajado en clase.

**Su límite:** el navegador sabe *decodificar* casi todo, pero solo *codifica* unos pocos formatos:
- WAV, escrito a mano
- PNG, JPEG y WebP, desde un canvas
- WebM o MP4 en tiempo real, con `MediaRecorder`.

Para exportar a MP3 o pasar de WebM a MP4 haría falta FFmpeg (en un servidor o como WebAssembly). Por eso he usado FFmpeg, igual que en clase, pero solo en `herramientas/` para generar los medios de prueba.

## 7. Depuración y pruebas

### Herramientas de depuración
- **`?depurar`** en la URL, o el interruptor de **Diagnóstico**: cada módulo escribe en la consola con su origen y color.
- **Monitor de eventos** (Diagnóstico): todos los eventos de los `<audio>`/`<video>` (los del motor incluidos) y los eventos propios `kroma:*`.
- **Consola**: `Serenia.app.motor`, `Serenia.biblioteca`, `Serenia.bd` y `Kroma.registro.historial`.
- **Errores provocados** (Diagnóstico): archivo 404, archivo dañado, decodificación de algo que no es audio y permiso de micrófono.

### Pruebas realizadas

Automatizadas con Chromium (Playwright), con capturas de pantalla en escritorio (1440 px) y móvil (390 px):

- [x] Primera visita: se importa la demo y se leen las etiquetas **ID3v2.3**, **Vorbis (Opus)** y **MP4**, con carátulas, letras LRC/VTT, subtítulos y capítulos.
- [x] La normalización detecta la canción grabada más baja («Neón», +6,6 dB).
- [x] Reproducir un álbum, la vista «Ahora suena» con letra karaoke y con visualizador.
- [x] El volumen del usuario se aplica antes del grafo (nivel RMS 0,033 → 0,009 al bajar de 85 % a 10 %).
- [x] **Fundido cruzado**: a 5 s del final la siguiente canción ya suena (t = 1,4 s) y la anterior se apaga.
- [x] Cola en el panel, ecualizador con preset, paleta de comandos (buscar «marea» + Enter), letra en el panel.
- [x] Menú contextual › Añadir a una lista › Nueva lista; la lista aparece en el lateral.
- [x] Vídeo con subtítulos SRT; al cambiar de vista sigue sonando en la **ventana flotante**.
- [x] Importar archivos **sin etiquetas**: deduce «Mi Artista» / «Primera prueba» del nombre y empareja `.lrc` y `cover.jpg`.
- [x] Grabación del micrófono (dispositivo simulado) y **añadirla a la biblioteca**.
- [x] Sin errores de JavaScript en la consola en ninguna de las pruebas.
- [x] Sin desbordamiento horizontal en móvil.

### Incidencias encontradas y cómo se resolvieron

| Problema | Causa | Solución |
|---|---|---|
| En móvil aparecía una columna vacía a la derecha | El panel lateral tenía `grid-area: panel`, que no existía en la plantilla móvil, y CSS Grid creó una **columna implícita** para él | En móvil el panel no ocupa celda: solo aparece como capa fija al abrirlo |
| Con carátulas oscuras el botón de play y el progreso eran casi invisibles | El color dominante de una carátula azul marino es azul marino | El acento se pasa a HSL y se limita la luminosidad al 58–72 % con saturación mínima del 55 % |
| El fondo desenfocado de «Ahora suena» no se veía | El fondo con `z-index: -1` se pintaba detrás del fondo del contenedor | `isolation: isolate` en la vista crea un contexto de apilamiento propio |
| Al recuperar la sesión con un vídeo en pausa salía la ventana flotante en la portada | Se mostraba siempre que la pista era un vídeo | Solo aparece si el vídeo está sonando (o ya estaba visible) |
| Al detener la grabadora desde otra vista fallaba `_alParar` | `onstop` llega después de que `_liberar()` ponga `grabador = null` | El manejador recibe su propio `MediaRecorder` por parámetro |
| El temporizador «al acabar la canción» a veces volvía a reproducir | Varios oyentes del final de pista competían con el motor | El propio motor comprueba el temporizador en `_alTerminar()` antes de pasar a la siguiente |
| Al bajar el volumen poco a poco (temporizador) se guardaba como volumen del usuario | `volumechange` del elemento se sincronizaba con los ajustes | Bandera `_ignorarVolumen` durante la bajada |
| Soltar un archivo en el conversor también lo importaba a la biblioteca | El arrastre global de la ventana recibía el mismo `drop` | En la sección del conversor se desactiva la importación global |
| Grabaciones de Chrome con duración `Infinity` | `MediaRecorder` no escribe la duración en WebM | Truco: saltar a `currentTime = 1e101` obliga a calcularla |

## 8. Limitaciones y mejoras futuras

- **Exportar a MP3/MP4**: integrar `ffmpeg.wasm`.
- **Bibliotecas enormes**: con miles de canciones convendría virtualizar la tabla (pintar solo las filas visibles).
- **Leer carpetas sin copiarlas**: con la File System Access API se podrían reproducir los archivos sin guardar una copia en IndexedDB.
- **Transcripción automática**: generar subtítulos con Whisper desde un pequeño servidor, como hicimos en clase.
- **Efectos de vídeo en GPU** (WebGL) para 4K a 60 fps.

## 9. Créditos

- **Código, diseño, música, carátulas y vídeos**: hechos para este proyecto. Las canciones se sintetizan con NumPy, las carátulas se dibujan con Pillow y los vídeos se generan con los filtros `gradients`, `mandelbrot` y `life` de FFmpeg (`herramientas/generar-biblioteca.py`).
- **Iconos**: trazados SVG basados en Material Icons (licencia Apache 2.0).
- **Tipografías**: Playfair Display, DM Sans y DM Mono (Google Fonts, licencia OFL); sin conexión se usan las del sistema.
- **Identidad visual**: basada en mi web, [serenaesteve.com](https://serenaesteve.com), con paleta azul y coral.
- Punto de partida: los ejemplos de la unidad *Utilización de librerías multimedia integradas* del curso.

---

*Hecho por **Serena Sania Esteve** · DAM · 2026*
