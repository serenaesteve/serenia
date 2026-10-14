#!/usr/bin/env python3
"""
Genera la biblioteca de demostración de Serenia desde cero:

  - 6 canciones sintetizadas (osciladores + envolventes + batería) en 3 álbumes
  - 3 carátulas generativas (PNG) incrustadas como etiqueta ID3 APIC
  - etiquetas ID3v2.3 (título, artista, álbum, año, pista, género) y Vorbis (Ogg)
  - 3 vídeos generados con los filtros de FFmpeg, con subtítulos y capítulos
  - media/biblioteca.json: el índice que la app importa la primera vez

Uso:  python3 herramientas/generar-biblioteca.py      (necesita numpy, Pillow y ffmpeg)
"""

import json
import shutil
import subprocess
import sys
import tempfile
import wave
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

RAIZ = Path(__file__).resolve().parent.parent
MEDIA = RAIZ / "media"
SR = 44100
rng = np.random.default_rng(7)


# ════════════════════════════════════════════════════════════════════
#  Sintetizador
# ════════════════════════════════════════════════════════════════════

def nota(n):
    return 440.0 * 2 ** ((n - 69) / 12)


def env(n, ataque=0.01, caida=0.3):
    t = np.arange(n) / SR
    return np.minimum(1, t / max(ataque, 1e-4)) * np.exp(-t / caida)


def osc(f, n, forma="sin"):
    t = np.arange(n) / SR
    if forma == "sin":
        return np.sin(2 * np.pi * f * t)
    if forma == "tri":
        return 2 * np.abs(2 * ((f * t) % 1) - 1) - 1
    if forma == "saw":
        return sum(np.sin(2 * np.pi * f * k * t) / k for k in range(1, 7)) * 0.6
    if forma == "square":
        return sum(np.sin(2 * np.pi * f * k * t) / k for k in range(1, 9, 2)) * 0.7
    if forma == "pluck":
        return np.sin(2 * np.pi * f * t) + 0.4 * np.sin(4 * np.pi * f * t) * np.exp(-t * 6)
    if forma == "campana":
        return np.sin(2 * np.pi * f * t) + 0.5 * np.sin(2 * np.pi * f * 2.76 * t) * np.exp(-t * 3)


def mezclar(buf, senal, inicio, pan=0.0, vol=1.0):
    i = int(inicio * SR)
    if i >= buf.shape[0]:
        return
    s = senal[: buf.shape[0] - i] * vol
    buf[i : i + len(s), 0] += s * np.cos((pan + 1) * np.pi / 4)
    buf[i : i + len(s), 1] += s * np.sin((pan + 1) * np.pi / 4)


def bombo():
    n = int(0.35 * SR)
    t = np.arange(n) / SR
    f = 50 + 90 * np.exp(-t * 30)
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 9)


def caja():
    n = int(0.2 * SR)
    t = np.arange(n) / SR
    return (rng.standard_normal(n) * 0.6 + np.sin(2 * np.pi * 190 * t)) * np.exp(-t * 22)


def charles():
    n = int(0.06 * SR)
    r = np.diff(rng.standard_normal(n), prepend=0)
    return r * np.exp(-np.arange(n) / SR * 60) * 0.3


def pista(bpm, acordes, arp, forma_arp, forma_pad, bateria, duracion, caja_en=None):
    buf = np.zeros((int(duracion * SR), 2))
    pulso = 60 / bpm
    compas = pulso * 4
    c = 0
    while c * compas < duracion:
        acorde = acordes[c % len(acordes)]
        t0 = c * compas
        largo = int(compas * SR)
        for k, n in enumerate(acorde):
            mezclar(buf, osc(nota(n), largo, forma_pad) * env(largo, 0.4, 3.0), t0, pan=-0.5 + k * 0.4, vol=0.07)
        b = int(pulso * 2 * SR)
        bajo = osc(nota(acorde[0] - 12), b, "tri") * env(b, 0.01, 0.6)
        mezclar(buf, bajo, t0, vol=0.22)
        mezclar(buf, bajo, t0 + pulso * 2, vol=0.18)
        for p in range(arp):
            n = acorde[p % len(acorde)] + 12 * (1 + (p // len(acorde)) % 2)
            l = int(compas / arp * SR * 1.5)
            mezclar(buf, osc(nota(n), l, forma_arp) * env(l, 0.005, 0.25), t0 + p * compas / arp, pan=np.sin(p) * 0.7, vol=0.11)
        if bateria and c > 0:
            for i in range(4):
                mezclar(buf, bombo(), t0 + i * pulso, vol=0.5)
                mezclar(buf, charles(), t0 + i * pulso + pulso / 2, pan=0.3, vol=0.6)
                if caja_en and i in caja_en:
                    mezclar(buf, caja(), t0 + i * pulso, pan=-0.1, vol=0.25)
        c += 1
    f = int(1.5 * SR)
    buf[:f] *= np.linspace(0, 1, f)[:, None]
    buf[-f:] *= np.linspace(1, 0, f)[:, None]
    return buf / (np.max(np.abs(buf)) * 1.1)


def guardar_wav(ruta, buf, volumen=1.0):
    datos = (buf * volumen * 32767).astype("<i2")
    with wave.open(str(ruta), "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(datos.tobytes())


# ════════════════════════════════════════════════════════════════════
#  Carátulas generativas
# ════════════════════════════════════════════════════════════════════

def caratula_senal(ruta):
    """Interferencia de ondas en coral, ámbar y menta."""
    n = 600
    y, x = np.mgrid[0:n, 0:n] / n
    d1 = np.hypot(x - 0.3, y - 0.35)
    d2 = np.hypot(x - 0.75, y - 0.7)
    onda = np.sin(d1 * 60) + np.sin(d2 * 52)
    t = (onda + 2) / 4
    paleta = np.array([[27, 31, 59], [255, 94, 126], [255, 200, 87], [45, 225, 194]], float)
    idx = np.clip(t * 3, 0, 2.999)
    i = idx.astype(int)
    f = (idx - i)[..., None]
    img = paleta[i] * (1 - f) + paleta[i + 1] * f
    img *= (0.55 + 0.45 * (1 - np.hypot(x - 0.5, y - 0.5)))[..., None]
    Image.fromarray(img.clip(0, 255).astype(np.uint8)).save(ruta)


def caratula_horizontes(ruta):
    """Puesta de sol con líneas de mar."""
    n = 600
    img = Image.new("RGB", (n, n))
    d = ImageDraw.Draw(img)
    for yy in range(n):
        t = yy / n
        c = (int(255 * (1 - t) + 40 * t), int(170 * (1 - t) + 70 * t), int(120 * (1 - t) + 140 * t))
        d.line([(0, yy), (n, yy)], fill=c)
    d.ellipse([170, 170, 430, 430], fill=(255, 236, 190))
    mar = Image.new("RGB", (n, n // 2), (18, 60, 96))
    dm = ImageDraw.Draw(mar)
    for k in range(18):
        yy = 6 + k * k * 0.9
        dm.line([(0, yy), (n, yy)], fill=(120 + k * 6, 200, 220), width=2)
    img.paste(mar, (0, n // 2 + 20))
    img = img.filter(ImageFilter.GaussianBlur(0.6))
    img.save(ruta)


def caratula_medianoche(ruta):
    """Luna creciente con estrellas sobre violeta."""
    n = 600
    y, x = np.mgrid[0:n, 0:n] / n
    base = np.stack([40 + 70 * y, 12 + 20 * y, 80 + 90 * (1 - y)], -1)
    img = Image.fromarray(base.astype(np.uint8))
    d = ImageDraw.Draw(img)
    for _ in range(140):
        sx, sy = rng.integers(0, n, 2)
        r = rng.choice([1, 1, 1, 2, 3])
        d.ellipse([sx - r, sy - r, sx + r, sy + r], fill=(255, 255, 255))
    d.ellipse([200, 140, 420, 360], fill=(255, 226, 160))
    d.ellipse([250, 115, 470, 335], fill=tuple(int(v) for v in base[220, 330]))
    img.save(ruta)


# ════════════════════════════════════════════════════════════════════
#  Catálogo
# ════════════════════════════════════════════════════════════════════

ALBUMES = {
    "senal": {"album": "Señal", "artista": "Kroma Synth", "anio": "2026", "genero": "Synthwave", "caratula": caratula_senal},
    "horizontes": {"album": "Horizontes", "artista": "Las Ondas", "anio": "2025", "genero": "Chill", "caratula": caratula_horizontes},
    "medianoche": {"album": "Medianoche", "artista": "Nébula", "anio": "2026", "genero": "Ambient", "caratula": caratula_medianoche},
}

CANCIONES = [
    # archivo, título, álbum, nº, formato, síntesis
    ("amanecer-digital", "Amanecer digital", "senal", 1, "mp3",
     lambda: pista(90, [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]], 8, "pluck", "sin", True, 34, caja_en=[1, 3])),
    ("neon", "Neón", "senal", 2, "mp3",
     lambda: pista(120, [[50, 53, 57], [46, 50, 53], [53, 57, 60], [48, 52, 55]], 16, "saw", "tri", True, 30, caja_en=[1, 3])),
    ("pixel", "Píxel", "senal", 3, "mp3",
     lambda: pista(132, [[60, 64, 67], [57, 60, 64], [53, 57, 60], [55, 59, 62]], 16, "square", "square", True, 28, caja_en=[1, 3])),
    ("brisa", "Brisa", "horizontes", 1, "ogg",
     lambda: pista(72, [[48, 52, 55, 59], [45, 48, 52, 55], [41, 45, 48, 52], [43, 47, 50, 55]], 8, "sin", "sin", False, 30)),
    ("marea", "Marea", "horizontes", 2, "mp3",
     lambda: pista(96, [[52, 55, 59], [48, 52, 55], [55, 59, 62], [50, 54, 57]], 8, "campana", "sin", True, 32, caja_en=[2])),
    ("medianoche", "Medianoche", "medianoche", 1, "mp3",
     lambda: pista(70, [[45, 48, 52], [41, 45, 48], [43, 47, 50], [40, 43, 47]], 6, "campana", "tri", False, 30)),
]

VIDEOS = [
    {
        "archivo": "bienvenida", "titulo": "Bienvenida a Serenia", "artista": "Serenia", "audio": "brisa",
        "fuente": "gradients=s=960x540:r=30:n=4:speed=0.015:c0=0x2a2026:c1=0xff9cc2:c2=0xe3d1ff:c3=0xffd3b8:d={d}",
        "texto": "KROMA", "duracion": 24,
    },
    {
        "archivo": "viaje-fractal", "titulo": "Viaje fractal", "artista": "Nébula", "audio": "medianoche",
        "fuente": "mandelbrot=s=960x540:r=30:start_scale=3:end_scale=0.0005:end_pts=900:inner=mincol,hue=h='t*12':s=1.4",
        "texto": "", "duracion": 28, "calidad": ["-crf", "30", "-maxrate", "1200k", "-bufsize", "2400k"],
    },
    {
        "archivo": "vida-artificial", "titulo": "Vida artificial", "artista": "Kroma Synth", "audio": "pixel",
        "fuente": "life=s=240x135:r=30:mold=8:life_color=#2de1c2:death_color=#ff5e7e:mold_color=#1b1f3b:ratio=0.12,scale=960:540:flags=neighbor",
        "texto": "", "duracion": 26, "calidad": ["-crf", "28", "-maxrate", "900k", "-bufsize", "1800k"],
    },
]


def ffmpeg(*args):
    subprocess.run(["ffmpeg", "-loglevel", "error", "-y", *args], check=True)


def main():
    if not shutil.which("ffmpeg"):
        sys.exit("Falta ffmpeg")
    musica = MEDIA / "musica"
    videos = MEDIA / "videos"
    caratulas = MEDIA / "caratulas"
    for carpeta in (musica, videos, caratulas):
        carpeta.mkdir(parents=True, exist_ok=True)

    indice = {"version": 2, "elementos": []}

    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)

        for clave, a in ALBUMES.items():
            png = tmp / f"{clave}.png"
            a["caratula"](png)
            # JPEG: pesa 10 veces menos que PNG y es lo habitual en las etiquetas ID3
            Image.open(png).convert("RGB").save(caratulas / f"{clave}.jpg", quality=88)
            print("carátula", clave)

        wavs = {}
        for archivo, titulo, alb, numero, formato, sintesis in CANCIONES:
            a = ALBUMES[alb]
            wav = tmp / f"{archivo}.wav"
            # Volúmenes distintos a propósito: así se nota la normalización de la app
            guardar_wav(wav, sintesis(), volumen={"neon": 0.55, "medianoche": 0.7}.get(archivo, 0.95))
            wavs[archivo] = wav
            destino = musica / f"{archivo}.{formato}"
            meta = [
                "-metadata", f"title={titulo}", "-metadata", f"artist={a['artista']}",
                "-metadata", f"album={a['album']}", "-metadata", f"date={a['anio']}",
                "-metadata", f"track={numero}", "-metadata", f"genre={a['genero']}",
            ]
            if formato == "mp3":
                # Carátula incrustada como ID3 APIC (portada frontal)
                ffmpeg("-i", str(wav), "-i", str(caratulas / f"{alb}.jpg"), "-map", "0:a", "-map", "1:v",
                       "-c:a", "libmp3lame", "-b:a", "160k", "-c:v", "copy", "-id3v2_version", "3",
                       "-metadata:s:v", "title=Album cover", "-metadata:s:v", "comment=Cover (front)",
                       "-disposition:v", "attached_pic", *meta, str(destino))
            else:
                ffmpeg("-i", str(wav), "-c:a", "libopus", "-b:a", "128k", *meta, str(destino))
            indice["elementos"].append({"tipo": "audio", "src": f"media/musica/{destino.name}"})
            print("canción", destino.name)

        for v in VIDEOS:
            destino = videos / f"{v['archivo']}.mp4"
            filtro = "[0]format=yuv420p[v]"
            if v["texto"]:
                filtro = (
                    "[0]drawtext=fontfile=/usr/share/fonts/truetype/freefont/FreeSerifBoldItalic.ttf:text='Serenia':fontsize=120:"
                    "fontcolor=white@0.92:x=(w-tw)/2:y=(h-th)/2-30,"
                    "drawtext=fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf:text='%{pts\\:hms}':fontsize=30:"
                    "fontcolor=white@0.85:x=(w-tw)/2:y=h/2+70,format=yuv420p[v]"
                )
            ffmpeg("-f", "lavfi", "-i", v["fuente"].format(d=v["duracion"]), "-i", str(wavs[v["audio"]]),
                   "-filter_complex", filtro, "-map", "[v]", "-map", "1:a", "-t", str(v["duracion"]),
                   "-c:v", "libx264", "-preset", "medium", *v.get("calidad", ["-crf", "27"]), "-c:a", "aac", "-b:a", "128k",
                   "-metadata", f"title={v['titulo']}", "-metadata", f"artist={v['artista']}",
                   "-movflags", "+faststart", str(destino))
            elemento = {"tipo": "video", "src": f"media/videos/{destino.name}", "titulo": v["titulo"], "artista": v["artista"]}
            subs = sorted(p.name for p in videos.glob(f"{v['archivo']}.*.*") if p.suffix in (".vtt", ".srt"))
            if subs:
                elemento["subtitulos"] = [f"media/videos/{s}" for s in subs]
            capitulos = videos / f"{v['archivo']}.capitulos.vtt"
            if capitulos.exists():
                elemento["capitulos"] = f"media/videos/{capitulos.name}"
                elemento["subtitulos"] = [s for s in elemento.get("subtitulos", []) if "capitulos" not in s]
            indice["elementos"].append(elemento)
            print("vídeo", destino.name)

    # Letras: .vtt o .lrc con el mismo nombre que la canción
    for e in indice["elementos"]:
        if e["tipo"] != "audio":
            continue
        base = Path(e["src"]).stem
        for ext in ("vtt", "lrc"):
            if (musica / f"{base}.{ext}").exists():
                e["letra"] = f"media/musica/{base}.{ext}"

    (MEDIA / "biblioteca.json").write_text(json.dumps(indice, ensure_ascii=False, indent=2), encoding="utf-8")
    print("biblioteca.json:", len(indice["elementos"]), "elementos")


if __name__ == "__main__":
    main()
