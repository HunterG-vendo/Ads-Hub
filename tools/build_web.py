#!/usr/bin/env python3
"""Build the web version of Ads Hub: a static site for GitHub Pages that runs the hub in the browser.

Run from the Ads Hub folder (the one with backend/, frontend/ and data/):

    python3 web/build_web.py

It asks for the team passcode, then writes the site to ../ads-hub-site (next to the Ads Hub folder).
Push that folder to GitHub. Options: --out <folder>, --passcode <text>, --skip-frontend (reuse the last page build).

Needs: Python 3.9+, the cryptography package (pip install cryptography), and Node/npm for the page build.
"""
from __future__ import annotations

import argparse
import base64
import getpass
import gzip
import hashlib
import io
import json
import os
import re
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import zipfile
from datetime import datetime
from pathlib import Path

WEB = Path(__file__).resolve().parent
PROJECT = WEB.parent
PART_SIZE = 8 * 1024 * 1024           # small parts so every file uploads easily (GitHub web uploader, browser tools)
KDF_ITERATIONS = 310_000

# Packages that ship with Pyodide (by name) and the extra pure Python wheels in runtime/pyodide.
PYODIDE_PACKAGES = ["numpy", "pandas", "python-dateutil", "pytz", "six", "sqlite3", "pydantic", "pydantic-core",
                    "typing-extensions", "annotated-types", "typing-inspection", "idna"]


def b64(b: bytes) -> str:
    return base64.b64encode(b).decode()


def encrypt(key: bytes, data: bytes) -> tuple[str, bytes]:
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    iv = os.urandom(12)
    return b64(iv), AESGCM(key).encrypt(iv, data, None)


def write_parts(data: bytes, folder: Path, stem: str, version: str) -> list[dict]:
    """Fixed file names (so a new build overwrites the old files in the repo); ?v= makes browsers fetch the new copy."""
    parts = []
    for i in range(0, len(data), PART_SIZE):
        chunk = data[i:i + PART_SIZE]
        name = f"{stem}.{len(parts) + 1:02d}.bin"
        (folder / name).write_bytes(chunk)
        parts.append({"file": f"data/{name}?v={version}", "size": len(chunk)})
    return parts


def published_at() -> str:
    try:
        from zoneinfo import ZoneInfo
        now = datetime.now(ZoneInfo("America/Chicago"))
    except Exception:
        now = datetime.now()
    return now.strftime("%b %d, %Y %I:%M %p").replace(" 0", " ")


def build_pages(out_tmp: Path):
    fe = PROJECT / "frontend"
    if not (fe / "node_modules").exists():
        subprocess.run(["npm", "install"], cwd=fe, check=True)
    subprocess.run(["npm", "run", "build", "--", "--base", "./", "--outDir", str(out_tmp), "--emptyOutDir"], cwd=fe, check=True)


def snapshot_db(src: Path) -> bytes:
    """A clean, consistent copy of the hub database (safe even while the Mac hub is running)."""
    with tempfile.TemporaryDirectory() as td:
        dst = Path(td) / "hub.db"
        s = sqlite3.connect(f"file:{src}?mode=ro", uri=True)
        d = sqlite3.connect(dst)
        s.backup(d)
        s.close()
        d.execute("PRAGMA journal_mode=DELETE")
        d.execute("VACUUM")
        d.close()
        return dst.read_bytes()


def code_zip() -> bytes:
    buf = io.BytesIO()
    backend = PROJECT / "backend"
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        for folder in ("adshub", "seeds"):
            for f in sorted((backend / folder).rglob("*")):
                if f.is_file() and "__pycache__" not in f.parts and f.suffix != ".pyc":
                    z.write(f, f.relative_to(backend).as_posix())
        z.write(WEB / "webmain.py", "webmain.py")
    return buf.getvalue()


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", default=str(PROJECT.parent / "ads-hub-site"))
    ap.add_argument("--passcode", default=os.environ.get("ADSHUB_WEB_PASSCODE"))
    ap.add_argument("--db", default=str(PROJECT / "data" / "hub.db"))
    ap.add_argument("--skip-frontend", action="store_true", help="reuse web/.pages from the last build")
    args = ap.parse_args()

    try:
        import cryptography  # noqa: F401
    except ImportError:
        sys.exit("Install the cryptography package first:  python3 -m pip install cryptography")

    passcode = args.passcode or getpass.getpass("Team passcode: ")
    if not passcode:
        sys.exit("A passcode is needed.")
    out = Path(args.out).resolve()
    out.mkdir(parents=True, exist_ok=True)

    pages = WEB / ".pages"
    if not args.skip_frontend or not pages.exists():
        print("Building the pages...")
        build_pages(pages)

    # Keep the same salt as the last build, so browsers that already have the passcode are not asked again
    salt = None
    try:
        old = json.loads((out / "runtime" / "hub.json").read_text())
        old_salt = base64.b64decode(old["kdf"]["salt"])
        old_key = hashlib.pbkdf2_hmac("sha256", passcode.encode(), old_salt, old["kdf"]["iterations"], dklen=32)
        from cryptography.hazmat.primitives.ciphers.aead import AESGCM
        AESGCM(old_key).decrypt(base64.b64decode(old["check"]["iv"]), base64.b64decode(old["check"]["data"]), None)
        salt = old_salt
    except Exception:
        pass            # first build, or the passcode changed: everyone enters the new one once

    # Clean the parts this script owns, keep everything else (for example .git)
    for name in ("assets", "runtime"):
        shutil.rmtree(out / name, ignore_errors=True)
    for f in ("index.html", "favicon.svg"):
        (out / f).unlink(missing_ok=True)

    shutil.copytree(pages / "assets", out / "assets")
    for f in pages.iterdir():
        if f.is_file() and f.name != "index.html":
            shutil.copy2(f, out / f.name)

    # index.html: the pages start only after boot.js has the engine running
    html = (pages / "index.html").read_text()
    m = re.search(r'<script type="module" crossorigin src="([^"]+)"></script>\s*', html)
    if not m:
        sys.exit("Could not find the page script in index.html")
    entry = m.group(1)
    html = html.replace(m.group(0), "")
    html = html.replace("</body>", '    <script src="runtime/boot.js"></script>\n  </body>')
    (out / "index.html").write_text(html)

    rt = out / "runtime"
    shutil.copytree(WEB / "runtime" / "pyodide", rt / "pyodide")
    shutil.copy2(WEB / "boot.js", rt / "boot.js")
    data_dir = rt / "data"
    data_dir.mkdir(parents=True)

    print("Encrypting the hub code and data...")
    salt = salt or os.urandom(16)
    key =hashlib.pbkdf2_hmac("sha256", passcode.encode(), salt, KDF_ITERATIONS, dklen=32)
    check_iv, check = encrypt(key, b"ads-hub")

    code = code_zip()
    code_iv, code_enc = encrypt(key, code)
    code_ver = hashlib.sha256(code_enc).hexdigest()[:12]
    code_parts = write_parts(code_enc, data_dir, "code", code_ver)

    db_bytes = snapshot_db(Path(args.db))
    db_ver = hashlib.sha256(db_bytes).hexdigest()[:12]
    db_gz = gzip.compress(db_bytes, compresslevel=9, mtime=0)
    db_iv, db_enc = encrypt(key, db_gz)
    db_parts = write_parts(db_enc, data_dir, "hub", db_ver)

    bundled = {n.replace("-", "_") for n in PYODIDE_PACKAGES}
    wheels = sorted(p.name for p in (rt / "pyodide").glob("*.whl") if p.name.split("-")[0].lower() not in bundled)
    meta = {
        "published": published_at(),
        "entry": entry,
        "packages": PYODIDE_PACKAGES,
        "wheels": wheels,
        "kdf": {"salt": b64(salt), "iterations": KDF_ITERATIONS},
        "check": {"iv": check_iv, "data": b64(check)},
        "code": {"iv": code_iv, "version": code_ver, "parts": code_parts},
        "db": {"iv": db_iv, "version": db_ver, "size": len(db_bytes), "parts": db_parts},
    }
    (rt / "hub.json").write_text(json.dumps(meta, indent=1))
    (out / ".nojekyll").write_text("")
    readme = out / "README.md"
    if not readme.exists():
        shutil.copy2(WEB / "SITE_README.md", readme)

    big = [p for p in out.rglob("*") if p.is_file() and ".git" not in p.parts and p.stat().st_size > 25 * 1024 * 1024]
    print(f"Done. Site written to {out}")
    print(f"  data: {len(db_bytes) / 1e6:.0f} MB database, {len(db_enc) / 1e6:.1f} MB encrypted in {len(db_parts)} part(s)")
    if big:
        print("  Note: files over 25 MB (use git or GitHub Desktop, not the web uploader):", *[p.name for p in big])


if __name__ == "__main__":
    main()
