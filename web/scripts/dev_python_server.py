"""Dev-only HTTP server that wraps the Vercel handler in web/api/predict.py.

Used by `next dev` rewrites to bridge /api/predict to a local Python process.
Not deployed — production runs predict.py as a Vercel Python serverless function
directly.

Run from web/ with the project venv:
    ../.venv/bin/python scripts/dev_python_server.py
"""
from __future__ import annotations

import sys
from http.server import HTTPServer
from pathlib import Path

WEB_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(WEB_DIR / "api"))

from predict import handler  # noqa: E402

PORT = 8000

if __name__ == "__main__":
    server = HTTPServer(("127.0.0.1", PORT), handler)
    print(f"dev python server listening on http://127.0.0.1:{PORT}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        server.server_close()
