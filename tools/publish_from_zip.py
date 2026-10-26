#!/usr/bin/env python3
"""Turn a zip of the Ads Hub project into an update for the GitHub Pages site.

    python3 tools/publish_from_zip.py --zip "Ads Hub Sharable v3.zip" --repo <clone of Ads-Hub> --passcode ...

Steps: unzip the project (skipping data/raw and other bulky folders), put this repo's build kit in it as web/,
run web/build_web.py into the repo clone, then compare with git and write:
  <stage>/files/...        every new or changed file, at its repo path, ready to upload
  <stage>/plan.json        upload batches (one folder per batch, at most ~9 MB each) and files to delete
The browser side (uploading the batches on github.com) is done by hand or by Claude in Chrome.
"""
from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
import zipfile
from pathlib import Path

HERE = Path(__file__).resolve().parent            # <repo>/tools
BATCH_BYTES = 9 * 1024 * 1024
SKIP_PARTS = ("/data/raw/", "/node_modules/", "/.venv/", "/frontend/dist/", "/__pycache__/", "/web/.pages/",
              "/.pytest_cache/", "__MACOSX/")


def extract(zpath: Path, dest: Path) -> Path:
    with zipfile.ZipFile(zpath) as z:
        for info in z.infolist():
            name = "/" + info.filename
            if any(s in name for s in SKIP_PARTS) or Path(info.filename).name.startswith("._"):
                continue
            if Path(info.filename).name.startswith(".fuse_hidden"):
                continue
            z.extract(info, dest)
    hits = [p.parent for p in dest.rglob("backend/adshub/api/app.py")]
    roots = [p.parent.parent.parent for p in hits]           # .../backend/adshub/api -> project root
    roots = [r for r in roots if (r / "frontend" / "package.json").exists()]
    if not roots:
        sys.exit("Could not find the Ads Hub project (backend/ and frontend/) inside the zip.")
    root = min(roots, key=lambda r: len(r.parts))
    if not (root / "data" / "hub.db").exists():
        sys.exit(f"No data/hub.db in the zip under {root.name}/. Include the data folder (raw/ can be left out).")
    return root


def kit_into(project: Path, repo: Path):
    web = project / "web"
    shutil.rmtree(web, ignore_errors=True)
    (web / "runtime").mkdir(parents=True)
    for f in ("build_web.py", "webmain.py", "boot.js", "SITE_README.md"):
        shutil.copy2(HERE / f, web / f)
    shutil.copytree(repo / "runtime" / "pyodide", web / "runtime" / "pyodide")


def git_changes(repo: Path):
    out = subprocess.run(["git", "status", "--porcelain", "--untracked-files=all"], cwd=repo,
                         capture_output=True, text=True, check=True).stdout
    changed, deleted = [], []
    for line in out.splitlines():
        code, path = line[:2], line[3:].strip().strip('"')
        if "D" in code:
            deleted.append(path)
        else:
            changed.append(path)
    return sorted(changed), sorted(deleted)


def plan_batches(repo: Path, files: list[str]):
    by_dir: dict[str, list[str]] = {}
    for f in files:
        d = str(Path(f).parent)
        by_dir.setdefault("" if d == "." else d, []).append(f)
    batches = []
    for d in sorted(by_dir, key=lambda x: (x.count("/"), x)):
        cur, size = [], 0
        for f in sorted(by_dir[d], key=lambda f: -(repo / f).stat().st_size):
            s = (repo / f).stat().st_size
            if cur and size + s > BATCH_BYTES:
                batches.append({"dir": d, "files": cur, "bytes": size})
                cur, size = [], 0
            cur.append(f)
            size += s
        if cur:
            batches.append({"dir": d, "files": cur, "bytes": size})
    return batches


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--zip", required=True)
    ap.add_argument("--repo", required=True, help="a git clone of the Ads-Hub site repo")
    ap.add_argument("--passcode", required=True)
    ap.add_argument("--work", default="/tmp/adshub-publish")
    ap.add_argument("--stage", default="/mnt/user-data/uploads/ads-hub-publish")
    ap.add_argument("--python", default=sys.executable, help="python with cryptography installed")
    args = ap.parse_args()

    repo = Path(args.repo).resolve()
    work = Path(args.work)
    shutil.rmtree(work, ignore_errors=True)
    work.mkdir(parents=True)
    print("Unzipping the project...")
    project = extract(Path(args.zip), work / "src")
    print(f"  project: {project}")
    kit_into(project, repo)
    print("Building the site...")
    subprocess.run([args.python, str(project / "web" / "build_web.py"), "--out", str(repo), "--passcode", args.passcode],
                   check=True)
    # keep the kit in the repo current with what was just used
    changed, deleted = git_changes(repo)
    stage = Path(args.stage)
    shutil.rmtree(stage, ignore_errors=True)
    for f in changed:
        dst = stage / "files" / f
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(repo / f, dst)
    plan = {"batches": plan_batches(repo, changed), "delete": deleted,
            "stage_root": str(stage / "files"), "hub": json.loads((repo / "runtime" / "hub.json").read_text())}
    plan["hub"].pop("check", None)
    (stage / "plan.json").parent.mkdir(parents=True, exist_ok=True)
    (stage / "plan.json").write_text(json.dumps(plan, indent=1))
    print(f"\n{len(changed)} file(s) to upload in {len(plan['batches'])} batch(es), {len(deleted)} to delete.")
    for b in plan["batches"]:
        print(f"  [{b['dir'] or '(root)'}] {len(b['files'])} file(s), {b['bytes'] / 1e6:.1f} MB")
    for d in deleted:
        print(f"  delete: {d}")
    print(f"Plan: {stage / 'plan.json'}")


if __name__ == "__main__":
    main()
