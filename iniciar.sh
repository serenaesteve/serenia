#!/usr/bin/env bash
# Arranca Kroma Player con un servidor local (funciona desde cualquier carpeta).
#   bash iniciar.sh          → puerto 8000
#   bash iniciar.sh 8080     → otro puerto
cd "$(dirname "$0")"
PUERTO="${1:-8000}"
if command -v python3 >/dev/null; then PY=python3; else PY=python; fi
echo "Kroma Player en  http://localhost:$PUERTO   (Ctrl+C para parar)"
exec "$PY" -m http.server "$PUERTO" --bind 0.0.0.0
