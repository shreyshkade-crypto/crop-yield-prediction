#!/bin/bash
# One command: sets everything up and starts the website.  Usage:  bash run.sh
set -e
cd "$(dirname "$0")/backend"
command -v python3 >/dev/null || { echo "Python 3 not found. Install it from https://www.python.org/downloads/"; exit 1; }
[ -d venv ] || python3 -m venv venv
source venv/bin/activate
python -m pip install -q --upgrade pip
python -m pip install -q -r requirements.txt
[ -f data/crop_yield.csv ] || python make_demo_data.py
[ -f models/yield_model.joblib ] || python train_model.py
PORT="${FLASK_PORT:-5001}"
if ! python -c 'import socket,sys; s=socket.socket(); s.setsockopt(socket.SOL_SOCKET,socket.SO_REUSEADDR,1); s.bind(("127.0.0.1",int(sys.argv[1]))); s.close()' "$PORT" 2>/dev/null; then
  if [ -n "${FLASK_PORT:-}" ]; then
    echo "Port $PORT is already in use. Choose another with FLASK_PORT=5002 bash run.sh"; exit 1
  fi
  PORT=5002
  if ! python -c 'import socket,sys; s=socket.socket(); s.setsockopt(socket.SOL_SOCKET,socket.SO_REUSEADDR,1); s.bind(("127.0.0.1",int(sys.argv[1]))); s.close()' "$PORT" 2>/dev/null; then
    echo "Ports 5001 and 5002 are busy. Stop one server and run this script again."; exit 1
  fi
fi
export FLASK_PORT="$PORT"
echo ""; echo "Ready. Open this in your browser:  http://localhost:$PORT"; echo "(Press Ctrl+C to stop)"; echo ""
python app.py
