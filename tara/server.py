#!/usr/bin/env python3
"""Tara case console — JSON API + single-page UI, standard library only.

    python3 -m tara.server                 # http://127.0.0.1:8787
    python3 -m tara.server --host 0.0.0.0  # reachable from the LAN / phone

The store is plain directories under --cases (default ./cases). Nothing here
interprets evidence: it hashes, stores, lists and serves. Findings only get
created when a human marks a window in the review station.
"""
from __future__ import annotations

import argparse
import json
import mimetypes
import os
import re
import tempfile
import traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse

from . import case_store as store

ROOT = Path(__file__).resolve().parent.parent
WEB_DIST = ROOT / "web" / "dist"
MAX_UPLOAD = 8 << 30  # 8 GiB
BASE = ROOT / "cases"

CASE_ID = r"([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})"


class Handler(BaseHTTPRequestHandler):
    server_version = "TaraCaseConsole/1.0"
    protocol_version = "HTTP/1.1"

    # ---------------------------------------------------------------- helpers
    def log_message(self, fmt: str, *args) -> None:
        print(f"  {self.address_string()} {fmt % args}")

    def _send(self, status: int, body: bytes, ctype: str, extra: dict | None = None) -> None:
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def _json(self, payload, status: int = 200) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self._send(status, body, "application/json; charset=utf-8")

    def _error(self, status: int, message: str) -> None:
        self._json({"error": message}, status)

    def _body(self, limit: int = 1 << 20) -> bytes:
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            length = 0
        if length <= 0:
            return b""
        if length > limit:
            raise store.CaseError(f"payload too large (limit {limit} bytes)")
        return self.rfile.read(length)

    def _json_body(self) -> dict:
        raw = self._body()
        if not raw:
            return {}
        try:
            payload = json.loads(raw)
        except ValueError:
            raise store.CaseError("body must be JSON")
        if not isinstance(payload, dict):
            raise store.CaseError("body must be a JSON object")
        return payload

    def _receive_to_case(self, case_id: str) -> Path:
        """Stream the request body to a temp file inside the case (same fs)."""
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            length = 0
        if length <= 0:
            raise store.CaseError("empty upload")
        if length > MAX_UPLOAD:
            raise store.CaseError("upload too large")
        d = store.case_dir(BASE, case_id)
        fd, tmp = tempfile.mkstemp(dir=d, prefix=".incoming-")
        remaining = length
        try:
            with os.fdopen(fd, "wb") as f:
                while remaining > 0:
                    chunk = self.rfile.read(min(1 << 20, remaining))
                    if not chunk:
                        raise store.CaseError("upload truncated")
                    f.write(chunk)
                    remaining -= len(chunk)
        except BaseException:
            try:
                os.unlink(tmp)
            except OSError:
                pass
            raise
        return Path(tmp)

    # -------------------------------------------------------------------- GET
    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        path = unquote(parsed.path)
        try:
            if path == "/api/health":
                return self._json({"ok": True, "cases_dir": str(BASE), "version": store.SCHEMA_VERSION})
            if path == "/api/cases":
                return self._json(store.list_cases(BASE))

            m = re.fullmatch(rf"/api/cases/{CASE_ID}/raw/(.+)", path)
            if m:
                return self._serve_raw(m.group(1), m.group(2))

            m = re.fullmatch(rf"/api/cases/{CASE_ID}/archive", path)
            if m:
                return self._serve_archive(m.group(1))

            m = re.fullmatch(rf"/api/cases/{CASE_ID}/verify", path)
            if m:
                return self._json(store.verify_case(BASE, m.group(1)))

            m = re.fullmatch(rf"/api/cases/{CASE_ID}", path)
            if m:
                return self._json(store.load_manifest(store.case_dir(BASE, m.group(1))))

            if path.startswith("/api/"):
                return self._error(404, "unknown endpoint")
            return self._serve_static(path)
        except store.CaseError as e:
            return self._error(e.status, str(e))
        except Exception:
            traceback.print_exc()
            return self._error(500, "internal error")

    # ------------------------------------------------------------------- POST
    def do_POST(self) -> None:
        parsed = urlparse(self.path)
        path = unquote(parsed.path)
        query = parse_qs(parsed.query)
        try:
            if path == "/api/cases":
                body = self._json_body()
                manifest = store.create_case(BASE, body.get("name", ""))
                return self._json(manifest, 201)

            m = re.fullmatch(rf"/api/cases/{CASE_ID}/artifacts", path)
            if m:
                case_id = m.group(1)
                name = (query.get("name") or [""])[0].strip()
                if not name:
                    return self._error(400, "name query parameter is required")
                kind = (query.get("kind") or [None])[0]
                source = (query.get("source") or ["tara-ui"])[0]
                tmp = self._receive_to_case(case_id)
                try:
                    entry = store.add_artifact(BASE, case_id, tmp, original_name=name, kind=kind, source=source)
                finally:
                    try:
                        os.unlink(tmp)
                    except OSError:
                        pass
                return self._json(entry, 201)

            m = re.fullmatch(rf"/api/cases/{CASE_ID}/notes", path)
            if m:
                body = self._json_body()
                entry = store.add_note(
                    BASE,
                    m.group(1),
                    body.get("title", ""),
                    body.get("text", ""),
                    analyst=body.get("analyst", "tara-ui"),
                )
                return self._json(entry, 201)

            m = re.fullmatch(rf"/api/cases/{CASE_ID}/findings", path)
            if m:
                body = self._json_body()
                entry = store.add_finding(BASE, m.group(1), body)
                return self._json(entry, 201)

            m = re.fullmatch(rf"/api/cases/{CASE_ID}/findings/{CASE_ID}/reviews", path)
            if m:
                body = self._json_body()
                entry = store.add_review(BASE, m.group(1), m.group(2), body)
                return self._json(entry, 201)

            m = re.fullmatch(rf"/api/cases/{CASE_ID}/close", path)
            if m:
                return self._json(store.close_case(BASE, m.group(1)))

            return self._error(404, "unknown endpoint")
        except store.CaseError as e:
            return self._error(e.status, str(e))
        except Exception:
            traceback.print_exc()
            return self._error(500, "internal error")

    # --------------------------------------------------------------- delivery
    def _serve_raw(self, case_id: str, stored_as: str) -> None:
        p = store.artifact_path(BASE, case_id, stored_as)
        if not p.is_file():
            return self._error(404, "artifact file missing")
        size = p.stat().st_size
        ctype = mimetypes.guess_type(p.name)[0] or "application/octet-stream"

        start, end, status = 0, size - 1, 200
        rng = self.headers.get("Range")
        if rng:
            m = re.fullmatch(r"bytes=(\d*)-(\d*)", rng.strip())
            if m and (m.group(1) or m.group(2)):
                if m.group(1):
                    start = int(m.group(1))
                    end = int(m.group(2)) if m.group(2) else size - 1
                else:
                    start = max(0, size - int(m.group(2)))
                end = min(end, size - 1)
                if start > end or start >= size:
                    return self._send(416, b"", "text/plain", {"Content-Range": f"bytes */{size}"})
                status = 206

        length = max(0, end - start + 1)
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(length))
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Cache-Control", "no-store")
        if status == 206:
            self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        self.end_headers()
        if self.command == "HEAD":
            return
        with open(p, "rb") as f:
            f.seek(start)
            remaining = length
            while remaining > 0:
                chunk = f.read(min(1 << 20, remaining))
                if not chunk:
                    break
                self.wfile.write(chunk)
                remaining -= len(chunk)

    def _serve_archive(self, case_id: str) -> None:
        archive = Path(BASE) / f"{case_id}.zip"
        if not archive.is_file():
            store.case_dir(BASE, case_id)
            return self._error(404, "case has not been closed yet")
        data = archive.read_bytes()
        name = f"{case_id}.zip"
        self._send(200, data, "application/zip", {"Content-Disposition": f'attachment; filename="{name}"'})

    def _serve_static(self, path: str) -> None:
        if path in ("/", ""):
            path = "/index.html"
        dist = WEB_DIST.resolve()
        target = (dist / path.lstrip("/")).resolve()
        if not str(target).startswith(str(dist) + os.sep) or not target.is_file():
            target = dist / "index.html"
        if not target.is_file():
            msg = (
                "Tara UI is not built yet.\n\n"
                "  cd web && npm install && npm run build\n\n"
                "Then reload, or run the dev server with: cd web && npm run dev\n"
            )
            return self._send(200, msg.encode(), "text/plain; charset=utf-8")
        ctype = mimetypes.guess_type(target.name)[0] or "application/octet-stream"
        self._send(200, target.read_bytes(), ctype)

    def do_HEAD(self) -> None:
        self.do_GET()


def main() -> None:
    global BASE
    ap = argparse.ArgumentParser(description="Tara case console")
    ap.add_argument("--host", default="127.0.0.1", help="bind address (0.0.0.0 to expose on the network)")
    ap.add_argument("--port", type=int, default=8787)
    ap.add_argument("--cases", default=str(ROOT / "cases"), help="case store directory")
    args = ap.parse_args()

    BASE = Path(args.cases).expanduser().resolve()
    BASE.mkdir(parents=True, exist_ok=True)

    httpd = ThreadingHTTPServer((args.host, args.port), Handler)
    httpd.daemon_threads = True
    print(f"Tara case console  http://{args.host}:{args.port}")
    print(f"case store         {BASE}")
    if not (WEB_DIST / "index.html").is_file():
        print("ui                 not built (cd web && npm install && npm run build)")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nstopped")


if __name__ == "__main__":
    main()
