# Serenia · Criterios de evaluación del RA3

**Serena Sania Esteve** · 0489 Programación multimedia y dispositivos móviles · DAM

Serenia es un reproductor de música y vídeo para el navegador. Lo he hecho con HTML, CSS y JavaScript, sin usar librerías de otras personas. Debajo funciona **Kroma**, una librería multimedia que también he hecho yo.

---

### a) Se han analizado entornos de desarrollo multimedia

He comparado varias formas de hacer programas multimedia: la web (HTML y JavaScript), Android, Java con JavaFX, Python y FFmpeg desde la terminal. Elegí la web porque funciona en cualquier ordenador o móvil sin instalar nada y porque es lo que hemos trabajado en clase.

Dentro de la app, la sección **Diagnóstico** muestra qué formatos de audio y vídeo puede reproducir y grabar tu navegador. La comparativa completa está en el README.

### b) Se han reconocido las clases que permiten la captura, procesamiento y almacenamiento de datos multimedia

- **Captura**: la grabadora graba el micrófono, la cámara o la pantalla.
- **Procesamiento**: al importar una canción, leo sus datos directamente del archivo: título, artista, álbum y carátula.
- **Almacenamiento**: todo se guarda en una base de datos del propio navegador. Las canciones, vídeos, listas y grabaciones siguen ahí aunque cierres la página.

### c) Se han utilizado clases para la conversión de datos multimedia de un formato a otro

El apartado **Conversor** permite:

- Pasar cualquier audio a WAV, eligiendo la calidad, mono o estéreo.
- Sacar una foto de un vídeo en PNG, JPG o WebP.
- Cambiar el formato de una imagen.
- Convertir subtítulos de SRT a VTT y al revés.

También se puede exportar cualquier canción a WAV con el ecualizador aplicado.

### d) Se han utilizado clases para procesar datos multimedia

- **Audio**: ecualizador de 5 bandas, efecto de sala (eco), balance izquierda/derecha y un limitador para que no se sature el sonido.
- **Volumen**: al importar, analizo lo fuerte que suena cada canción para que todas suenen igual (normalizar).
- **Fundido**: al pasar de una canción a otra, una baja y la otra sube a la vez.
- **Vídeo**: 13 efectos en tiempo real que cambian el color de cada píxel (blanco y negro, sepia, negativo, bordes…).

### e) Se han utilizado clases para el control de eventos, tipos de media y excepciones, entre otros

- **Eventos**: la app reacciona a todo lo que pasa: cuando empieza o termina una canción, cuando cambias el volumen, cuando arrastras un archivo, cuando pulsas una tecla… En **Diagnóstico** hay un monitor que muestra estos eventos en directo.
- **Tipos de media**: antes de reproducir, la app comprueba si el navegador soporta ese formato y, si hay varios, elige el que funciona.
- **Errores**: si un archivo no existe, está roto o falta un permiso, la app lo detecta, muestra un mensaje claro y sigue funcionando. En **Diagnóstico** hay botones para provocar estos errores y ver cómo se manejan.

### f) Se han utilizado clases para la creación y control de animaciones

- Visualizadores que se mueven con la música (barras, círculo y onda).
- La letra de la canción va resaltando la línea que suena, como en un karaoke.
- La carátula se inclina al pasar el ratón, el fondo se mueve despacio y hay transiciones al cambiar de pantalla.
- Avisos que entran y salen con animación.

Las animaciones se paran cuando no se ven, para no gastar batería, y se reducen si el sistema lo pide.

### g) Se han utilizado clases para reproducir contenidos multimedia

- Reproduzco música y vídeo con cola de reproducción, aleatorio y repetir.
- Los vídeos tienen subtítulos en varios idiomas, capítulos, pantalla completa y ventana flotante.
- Hay un mini reproductor que se queda siempre encima de las demás ventanas.
- Funcionan las teclas multimedia del teclado.
- Al volver a abrir la app, todo sigue donde lo dejaste.

### h) Se han depurado y documentado los programas desarrollados

- **Depuración**: hay un modo depuración que escribe en la consola todo lo que hace la app. Además he probado la app en Chrome y Firefox, en ordenador y en móvil.
- **Problemas resueltos**: he apuntado los fallos que encontré y cómo los arreglé. Por ejemplo, un hueco vacío en la versión de móvil o colores que no se veían con carátulas oscuras.
- **Documentación**: el código está comentado en español. El archivo **README.md** explica cómo arrancar la app, cómo está organizada, las pruebas que hice y esos problemas.
