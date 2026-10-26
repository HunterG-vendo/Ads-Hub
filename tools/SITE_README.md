# Ads Hub (web test version)

The PLTFRM Ads Hub, running fully in the browser. Open the GitHub Pages link, enter the team passcode once, and the hub loads with the latest shared data.

## For the team

- Use a current Chrome, Edge or Safari on a computer. The first open downloads about 50 MB and takes 20 to 40 seconds; after that it opens faster.
- The passcode is asked once per browser.
- Your changes and uploads are saved in your own browser only. Nobody else sees them, and they are not sent anywhere.
- When new shared data is published, the hub asks whether to load it. Loading it replaces what is in your browser.
- Use one tab at a time. Two open tabs each keep their own copy, and the last one to save wins.
- Something stuck? Add `?reset=1` to the end of the link to clear the hub from your browser and start over.
- Very large ads exports (several hundred MB) can be slow or run out of memory in a browser. Smaller date ranges work best.

## For Hunter: publishing an update

The site is built from the Ads Hub project with `web/build_web.py`:

```
cd "Ads Hub"
python3 -m pip install cryptography      # first time only
python3 web/build_web.py --out ../ads-hub-site
```

Then commit and push this folder. Everything client-related (hub code with account setup and goals, and the database) is encrypted with the team passcode; only the page shell and the Python runtime are readable.

## What is in here

- `index.html`, `assets/`: the hub pages (built from `frontend/`)
- `runtime/boot.js`: starts the engine, asks for the passcode, routes the pages' `/api` calls to it, saves to the browser
- `runtime/pyodide/`: Python for the browser (Pyodide 0.29.5) and the packages the hub uses
- `runtime/data/`: the encrypted hub code and database snapshot
- `runtime/hub.json`: versions and decryption settings (no secrets)
