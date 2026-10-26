"""Ads Hub web runtime: runs the same FastAPI app inside the browser (Pyodide).

boot.js calls init() once, then handle() for every /api request the pages make.
Nothing here changes how the hub calculates anything; it only swaps the network layer.
"""
from __future__ import annotations

import asyncio
import os
import sys
import types
from pathlib import Path


def _stub_ssl():
    """anyio imports ssl at load time. The browser build has no network sockets, so a stub is enough."""
    if "ssl" in sys.modules:
        return
    try:
        import ssl  # noqa: F401
        return
    except Exception:
        pass
    m = types.ModuleType("ssl")

    def _missing(name):
        base = (OSError,) if name.endswith("Error") else (object,)
        cls = type(name, base, {})
        setattr(m, name, cls)
        return cls

    m.__getattr__ = _missing
    m.HAS_ALPN = False
    sys.modules["ssl"] = m


def _no_threads():
    """FastAPI runs plain def endpoints in a thread pool. The browser has no threads, so run them inline."""
    import anyio.to_thread

    async def run_sync(func, *args, abandon_on_cancel=False, cancellable=None, limiter=None):
        return func(*args)

    anyio.to_thread.run_sync = run_sync


app = None


def init(db_path: str, work_dir: str):
    global app
    _stub_ssl()
    _no_threads()
    work = Path(work_dir)
    (work / "raw").mkdir(parents=True, exist_ok=True)
    (work / "incoming").mkdir(parents=True, exist_ok=True)
    os.environ["ADSHUB_DB"] = db_path
    os.environ["ADSHUB_DATA"] = work_dir
    os.environ["ADSHUB_SAMPLES"] = str(work / "no-samples")

    from sqlalchemy import event
    import adshub.store.db as db
    import adshub.store.sync as sync

    # Raw uploads stay in memory for the session instead of filling the browser's storage.
    def raw_dir(engine) -> Path:
        d = work / "raw"
        d.mkdir(parents=True, exist_ok=True)
        return d

    db.raw_dir = raw_dir
    sync.raw_dir = raw_dir

    # One database file (no WAL side files) so the browser copy saves cleanly.
    _get_engine = db.get_engine

    def get_engine(path=None):
        eng = _get_engine(path)
        eng.dispose()

        @event.listens_for(eng, "connect")
        def _single_file(dbapi_conn, _):
            cur = dbapi_conn.cursor()
            cur.execute("PRAGMA journal_mode=DELETE")
            cur.close()

        return eng

    db.get_engine = get_engine

    import adshub.api.app as appmod
    appmod.INCOMING = work / "incoming"
    app = appmod.app
    return True


async def handle(method: str, path: str, query: str, headers, body):
    """Run one request through the app. Returns (status, [[name, value]...], body bytes)."""
    if hasattr(headers, "to_py"):
        headers = headers.to_py()
    if hasattr(body, "to_bytes"):
        data = body.to_bytes()
    elif isinstance(body, (bytes, bytearray, memoryview)):
        data = bytes(body)
    else:
        data = b""          # None or JS null

    scope = {
        "type": "http",
        "asgi": {"version": "3.0", "spec_version": "2.3"},
        "http_version": "1.1",
        "method": method.upper(),
        "scheme": "http",
        "path": path,
        "raw_path": path.encode(),
        "root_path": "",
        "query_string": (query or "").encode(),
        "headers": [(str(k).lower().encode("latin-1"), str(v).encode("latin-1")) for k, v in headers],
        "client": ("127.0.0.1", 0),
        "server": ("localhost", 80),
    }
    done = asyncio.Event()
    sent_body = False
    status = 500
    out_headers: list = []
    chunks: list[bytes] = []

    async def receive():
        nonlocal sent_body
        if not sent_body:
            sent_body = True
            return {"type": "http.request", "body": data, "more_body": False}
        await done.wait()
        return {"type": "http.disconnect"}

    async def send(msg):
        nonlocal status, out_headers
        if msg["type"] == "http.response.start":
            status = msg["status"]
            out_headers = [[k.decode("latin-1"), v.decode("latin-1")] for k, v in msg.get("headers", [])]
        elif msg["type"] == "http.response.body":
            chunks.append(bytes(msg.get("body", b"")))
            if not msg.get("more_body"):
                done.set()

    try:
        await app(scope, receive, send)
    finally:
        done.set()
    return [status, out_headers, b"".join(chunks)]
