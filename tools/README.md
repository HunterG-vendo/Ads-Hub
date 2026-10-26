# tools/: how this site is built

The site is the Ads Hub project (Python backend + React pages) running in the browser with Pyodide.
These files turn a zip of the project into an update for this repo.

- `publish_from_zip.py`: unzip the project, build into a clone of this repo, list what changed in upload batches
- `build_web.py`: the build itself (pages, encrypted hub code and database, `runtime/hub.json`)
- `boot.js`: browser start-up, passcode screen, the `/api` bridge, saving to the browser (copied to `runtime/boot.js`)
- `webmain.py`: the Python side of the bridge; runs FastAPI requests without a server
- `SITE_README.md`: the repo README

The Python runtime the build uses is `runtime/pyodide/` in this repo (Pyodide 0.29.5 and the hub's wheels).

## Update the site

```
git clone https://github.com/HunterG-vendo/Ads-Hub
python3 -m pip install cryptography
python3 Ads-Hub/tools/publish_from_zip.py --zip "Ads Hub.zip" --repo Ads-Hub --passcode '<team passcode>' --stage ./publish
```

Then commit the changes (git push, or upload the batches from `publish/plan.json` on github.com; the web uploader
fails on large commits, so keep each commit under about 9 MB). Use the same passcode every time so the team is not
asked again. Data files keep fixed names, so new ones replace the old ones.

The zip needs `backend/`, `frontend/` and `data/hub.db`. `data/raw/` is not used and can be left out to keep it small.
