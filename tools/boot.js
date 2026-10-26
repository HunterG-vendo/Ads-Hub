// Ads Hub web build: starts the hub's Python engine in the browser, then opens the normal pages.
// Every /api call the pages make is answered by the same FastAPI app the Mac version runs, just in this tab.
// Data lives in this browser (IndexedDB). The shared snapshot is encrypted with the team passcode.
(() => {
  "use strict";
  const BASE = new URL(".", document.currentScript ? document.currentScript.src : location.href).href; // .../runtime/
  const PERSIST = "/adshub-web-data";          // IndexedDB database name for the hub's files
  const DB_PATH = PERSIST + "/hub.db";
  const KV_DB = "adshub-web";                   // small store for the passcode key and choices
  const $ = (s) => document.querySelector(s);

  // ---------------- small IndexedDB key/value store ----------------
  function kvOpen() {
    return new Promise((res, rej) => {
      const r = indexedDB.open(KV_DB, 1);
      r.onupgradeneeded = () => r.result.createObjectStore("kv");
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  }
  async function kvGet(k) {
    try {
      const db = await kvOpen();
      return await new Promise((res) => { const q = db.transaction("kv").objectStore("kv").get(k); q.onsuccess = () => res(q.result); q.onerror = () => res(undefined); });
    } catch { return undefined; }
  }
  async function kvSet(k, v) {
    try {
      const db = await kvOpen();
      await new Promise((res) => { const tx = db.transaction("kv", "readwrite"); tx.objectStore("kv").put(v, k); tx.oncomplete = res; tx.onerror = res; });
    } catch { /* storage off: the passcode is asked again next time */ }
  }
  function deleteDb(name) {
    return new Promise((res, rej) => {
      const r = indexedDB.deleteDatabase(name);
      const t = setTimeout(() => rej(new Error("blocked")), 10000);
      r.onsuccess = r.onerror = () => { clearTimeout(t); res(); };
    });
  }

  // ---------------- screen ----------------
  // Loading view: a black dot with the percentage and a progress ring (no card, no logo).
  // Questions and errors (passcode, new data, other tab) show in a small glass card.
  const css = `
  #ahw{position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;padding:16px;
    background:#fff;font-family:"Geist Variable",ui-sans-serif,system-ui,sans-serif;color:#111113;font-size:13px}
  #ahw::before{content:"";position:fixed;inset:0;pointer-events:none;background:
    radial-gradient(38rem 26rem at 8% -4%,rgba(17,17,19,.06),transparent 70%),
    radial-gradient(34rem 30rem at 96% 8%,rgba(17,17,19,.05),transparent 70%)}
  #ahw .shell{position:relative;width:100%;max-width:380px;display:grid;justify-items:center;gap:22px}
  #ahw #ahw-body{width:100%;display:grid;justify-items:center}
  #ahw .card{position:relative;width:100%;border-radius:24px;padding:26px 26px 22px;
    background:rgba(255,255,255,.72);border:1px solid #e8e8ec;box-shadow:0 1px 0 rgba(255,255,255,.9) inset,0 18px 50px -24px rgba(17,17,19,.25);
    backdrop-filter:blur(18px)}
  #ahw .title{font-weight:600;font-size:16px;margin:0 0 4px;letter-spacing:-.01em}
  #ahw .sub{color:#74757c;margin:0 0 18px}
  #ahw label{display:block;font-weight:500;margin-bottom:6px}
  #ahw input{width:100%;box-sizing:border-box;height:40px;border-radius:999px;border:1px solid #d6d6dc;padding:0 16px;font:inherit;font-size:14px;outline:none;background:#fff}
  #ahw input:focus{border-color:#111113;box-shadow:0 0 0 3px rgba(17,17,19,.08)}
  #ahw button{height:40px;border-radius:999px;border:1px solid #111113;background:#111113;color:#fff;font:inherit;font-weight:500;padding:0 18px;cursor:pointer}
  #ahw button.ghost{background:#fff;color:#111113;border-color:#d6d6dc}
  #ahw button:disabled{opacity:.5;cursor:default}
  #ahw .row{display:flex;gap:8px;margin-top:12px}
  #ahw .row button{flex:1}
  #ahw .err{color:#c62828;margin-top:10px;min-height:1em;white-space:pre-wrap;word-break:break-word}
  #ahw .loader{display:grid;justify-items:center;gap:8px;text-align:center}
  #ahw .orb{position:relative;width:132px;height:132px;display:grid;place-items:center;margin-bottom:8px}
  #ahw .orb svg{position:absolute;inset:0;width:100%;height:100%;transform:rotate(-90deg)}
  #ahw .orb .track{fill:none;stroke:#ececf0;stroke-width:4}
  #ahw .orb .arc{fill:none;stroke:#111113;stroke-width:4;stroke-linecap:round;transition:stroke-dashoffset .6s ease}
  #ahw .dot{width:96px;height:96px;border-radius:50%;background:#111113;display:grid;place-items:center;
    box-shadow:0 18px 36px -18px rgba(17,17,19,.55);animation:ahwpulse 2.4s ease-in-out infinite;will-change:transform}
  @keyframes ahwpulse{50%{transform:scale(1.05)}}
  #ahw #ahw-pct{font-family:"Geist Mono Variable",ui-monospace,monospace;font-variant-numeric:tabular-nums;font-size:20px;font-weight:500;color:#fff;letter-spacing:-.02em}
  @media (prefers-reduced-motion:reduce){#ahw .dot{animation:none}}
  #ahw #ahw-status{color:#4b4c52;min-height:18px}
  #ahw .slow{color:#74757c;font-size:12px;min-height:16px}
  #ahw .slow a{color:#111113}
  #ahw .foot{color:#74757c;font-size:12px;display:flex;justify-content:center;flex-wrap:wrap;gap:6px 10px}
  #ahw .foot a{color:#74757c}
  #ahw-save{position:fixed;left:16px;bottom:16px;z-index:2147483000;padding:6px 12px;border-radius:999px;font:12px "Geist Variable",ui-sans-serif,system-ui,sans-serif;
    background:rgba(255,255,255,.9);border:1px solid #e8e8ec;color:#4b4c52;box-shadow:0 6px 20px -12px rgba(17,17,19,.3);transition:opacity .3s;opacity:0;pointer-events:none}
  #ahw-save.on{opacity:1}`;

  function mount() {
    if ($("#ahw")) return;
    if (!$("#ahw-css")) { const st = document.createElement("style"); st.id = "ahw-css"; st.textContent = css; document.head.appendChild(st); }
    const d = document.createElement("div"); d.id = "ahw";
    d.innerHTML = `<div class="shell"><div id="ahw-body"></div>
      <div class="foot"><span>Ads Hub</span><span id="ahw-ver"></span><a href="?reset=1" id="ahw-reset">Start over</a></div></div>`;
    document.body.appendChild(d);
  }
  // card for questions and errors
  function body(html) {
    stopBlob();
    $("#ahw-body").innerHTML = `<div class="card"><p class="title">Ads Hub</p><p class="sub">Test version for the PLTFRM ads team</p>${html}</div>`;
  }

  // ---- loading view: a black dot with the percentage and a thin ring ----
  // Kept light on purpose: the page's main thread is busy starting Python, so nothing here redraws every frame.
  const RING = 2 * Math.PI * 62;
  const B = { timer: 0, target: 0, cap: 0, shown: -1, changed: 0, text: "" };
  function blobView() {
    $("#ahw-body").innerHTML = `<div class="loader">
      <div class="orb">
        <svg viewBox="0 0 132 132" aria-hidden="true"><circle class="track" cx="66" cy="66" r="62"/>
          <circle class="arc" id="ahw-arc" cx="66" cy="66" r="62" stroke-dasharray="${RING.toFixed(1)}" stroke-dashoffset="${RING.toFixed(1)}"/></svg>
        <div class="dot"><span id="ahw-pct">0%</span></div>
      </div>
      <div id="ahw-status" role="status" aria-live="polite"></div>
      <div class="slow" id="ahw-slow"></div></div>`;
    B.shown = -1; B.changed = performance.now();
    clearInterval(B.timer); B.timer = setInterval(tick, 400);
    tick();
  }
  function stopBlob() { clearInterval(B.timer); B.timer = 0; }
  function tick() {
    if (!$("#ahw-pct")) { stopBlob(); return; }
    // creep toward the next step so a long step still moves
    if (B.target < B.cap) B.target = Math.min(B.cap, B.target + 0.7);
    const n = Math.floor(B.target);
    if (n !== B.shown) {
      B.shown = n;
      $("#ahw-pct").textContent = n + "%";
      $("#ahw-arc").setAttribute("stroke-dashoffset", (RING * (1 - n / 100)).toFixed(1));
    }
    const slow = $("#ahw-slow");
    const stuck = performance.now() - B.changed > 40000;
    if (stuck && !slow.firstChild) slow.innerHTML = `Taking longer than usual. <a href="javascript:location.reload()">Reload</a>`;
    if (!stuck && slow.firstChild) slow.textContent = "";
  }
  // progress(text, p, cap): p is how far along we are (0 to 100); the blob creeps toward cap until the next step
  function progress(text, p, cap) {
    if (!$("#ahw-core")) blobView();
    if (p !== undefined && p > B.target) { B.target = p; B.changed = performance.now(); }
    B.cap = Math.max(B.target, cap !== undefined ? cap : Math.min(97, B.target + 12));
    if (B.target >= 100) B.cap = 100;
    if (text !== B.text) { B.text = text; B.changed = performance.now(); $("#ahw-status").textContent = text; }
    tick();
  }
  function bump(p) { if (p > B.target) { B.target = p; B.changed = performance.now(); } }
  function fail(msg) {
    body(`<div class="err" style="margin-top:0">${msg}</div><div class="row"><button onclick="location.reload()">Try again</button></div>`);
  }
  function askPasscode(message) {
    return new Promise((resolve) => {
      body(`<form id="ahw-form"><label for="ahw-pass">Team passcode</label><input id="ahw-pass" type="password" autocomplete="current-password" autofocus>
        <div class="row"><button type="submit">Open the hub</button></div><div class="err" id="ahw-err">${message || ""}</div>
        <p class="sub" style="margin:14px 0 0">You only need this the first time in this browser.</p></form>`);
      const f = $("#ahw-form");
      setTimeout(() => $("#ahw-pass").focus(), 30);
      f.onsubmit = (e) => { e.preventDefault(); const v = $("#ahw-pass").value; if (v) { f.querySelector("button").disabled = true; resolve(v); } };
    });
  }
  function askNewData(published) {
    return new Promise((resolve) => {
      body(`<p style="margin:0 0 4px;font-weight:500">New shared data is available</p>
        <p class="sub" style="margin:0">Published ${published}. Loading it replaces the data in this browser, including files you uploaded here.</p>
        <div class="row"><button class="ghost" id="ahw-keep">Keep mine</button><button id="ahw-new">Load new data</button></div>`);
      $("#ahw-keep").onclick = () => resolve(false);
      $("#ahw-new").onclick = () => resolve(true);
    });
  }

  // ---------------- one tab at a time ----------------
  // Each tab holds its own copy of the database, so two open tabs would overwrite each other's saves and can
  // block each other's storage. The hub runs in one tab; another tab can take over with "Use here".
  const LOCK = "adshub-web-tab";
  const chan = "BroadcastChannel" in window ? new BroadcastChannel("adshub-web") : null;
  let active = false;
  function holdLock(steal) {
    return new Promise((resolve) => {
      if (!navigator.locks) { resolve(true); return; }
      navigator.locks.request(LOCK, steal ? { steal: true } : { ifAvailable: true }, (lock) => {
        if (!lock) { resolve(false); return undefined; }
        resolve(true);
        return new Promise(() => {});            // held until this tab closes or another tab takes over
      }).catch(() => { if (active) movedAway(); });
    });
  }
  function closeIdb() {
    try {
      const dbs = py && py.FS.filesystems.IDBFS.dbs;
      for (const k of Object.keys(dbs || {})) { try { dbs[k].close(); } catch { /* closed */ } delete dbs[k]; }
    } catch { /* nothing open */ }
  }
  function guardIdb() {
    // If another tab needs to clear or upgrade the storage, let go instead of blocking it.
    try {
      const dbs = py.FS.filesystems.IDBFS.dbs;
      for (const k of Object.keys(dbs)) dbs[k].onversionchange = () => { try { dbs[k].close(); } catch { /* closed */ } delete dbs[k]; };
    } catch { /* not open */ }
  }
  async function movedAway() {
    active = false;
    clearTimeout(saveTimer); saveTimer = null;
    try { await saveNow(); } catch { /* best effort */ }
    closeIdb();
    if (chan) chan.postMessage("released");
    mount();
    body(`<p style="margin:0 0 4px;font-weight:500">Ads Hub is open in another tab</p>
      <p class="sub" style="margin:0">Your work here was saved. Close this tab, or bring the hub back here.</p>
      <div class="row"><button id="ahw-here">Use here</button></div>`);
    $("#ahw-here").onclick = () => location.replace(location.pathname + "?take=1" + location.hash);
  }
  function askTakeOver() {
    return new Promise((resolve) => {
      body(`<p style="margin:0 0 4px;font-weight:500">Ads Hub is already open in another tab</p>
        <p class="sub" style="margin:0">Use that tab, or open the hub here instead. The other tab saves your work and pauses.</p>
        <div class="row"><button id="ahw-here">Use here</button></div>`);
      $("#ahw-here").onclick = () => resolve(true);
    });
  }
  function waitReleased(ms) {
    return new Promise((res) => {
      if (!chan) { setTimeout(res, 1500); return; }
      const t = setTimeout(res, ms);
      chan.onmessage = (e) => { if (e.data === "released") { clearTimeout(t); res(); } };
    });
  }
  function withTimeout(p, ms) {
    return Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), ms))]);
  }

  // ---------------- crypto ----------------
  const b64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  async function deriveKey(pass, meta) {
    const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(pass), "PBKDF2", false, ["deriveKey"]);
    return crypto.subtle.deriveKey({ name: "PBKDF2", salt: b64(meta.kdf.salt), iterations: meta.kdf.iterations, hash: "SHA-256" },
      base, { name: "AES-GCM", length: 256 }, false, ["decrypt"]);
  }
  const decrypt = (key, iv, data) => crypto.subtle.decrypt({ name: "AES-GCM", iv: b64(iv) }, key, data);
  async function keyWorks(key, meta) {
    try { const out = await decrypt(key, meta.check.iv, b64(meta.check.data)); return new TextDecoder().decode(out) === "ads-hub"; } catch { return false; }
  }
  async function fetchParts(parts, onBytes) {
    const bufs = [];
    let total = 0;
    for (const p of parts) {
      const r = await fetch(BASE + p.file);
      if (!r.ok) throw new Error(`Could not download ${p.file} (${r.status})`);
      const reader = r.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        bufs.push(value); total += value.length; onBytes && onBytes(total);
      }
    }
    const all = new Uint8Array(total);
    let o = 0; for (const b of bufs) { all.set(b, o); o += b.length; }
    return all;
  }
  async function gunzip(buf) {
    const ds = new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream("gzip")));
    return new Uint8Array(await ds.arrayBuffer());
  }

  // ---------------- Python ----------------
  let py = null, wm = null;
  async function startPython(meta) {
    const { loadPyodide } = await import(BASE + "pyodide/pyodide.mjs");
    py = await loadPyodide({ indexURL: BASE + "pyodide/", stdout: () => {}, stderr: (s) => console.warn("[hub]", s) });
    await py.loadPackage(meta.packages, { messageCallback: () => {} });
    await py.loadPackage(meta.wheels.map((w) => BASE + "pyodide/" + w), { messageCallback: () => {} });
    return py;
  }
  const syncfs = (populate) => new Promise((res, rej) => py.FS.syncfs(populate, (e) => (e ? rej(e) : res())));
  const exists = (p) => { try { py.FS.stat(p); return true; } catch { return false; } };
  const readText = (p) => (exists(p) ? py.FS.readFile(p, { encoding: "utf8" }) : null);

  // ---------------- saving ----------------
  let saveTimer = null, saving = null, again = false;
  function pill(text, on) {
    let p = $("#ahw-save");
    if (!p) { p = document.createElement("div"); p.id = "ahw-save"; document.body.appendChild(p); }
    p.textContent = text; p.classList.toggle("on", on);
  }
  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, 1200);
  }
  async function saveNow() {
    if (saving) { again = true; return saving; }
    pill("Saving in this browser…", true);
    saving = syncfs(false).then(() => { pill("Saved in this browser", true); setTimeout(() => pill("Saved in this browser", false), 1500); })
      .catch((e) => { console.error(e); pill("Could not save in this browser", true); })
      .finally(() => { saving = null; if (again) { again = false; saveNow(); } });
    return saving;
  }
  addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden" && saveTimer) { clearTimeout(saveTimer); saveTimer = null; saveNow(); } });
  addEventListener("beforeunload", (e) => { if (saveTimer || saving) { e.preventDefault(); e.returnValue = ""; } });

  // ---------------- the /api bridge ----------------
  const nativeFetch = window.fetch.bind(window);
  let queue = Promise.resolve();
  const SITE = new URL("..", BASE).pathname;   // the folder the hub is published in, e.g. /ads-hub/
  function apiPath(input) {
    const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input && input.url;
    if (!raw) return null;
    const u = new URL(raw, location.href);
    if (u.origin !== location.origin) return null;
    let p = null;
    if (u.pathname.startsWith("/api/")) p = u.pathname;
    else if (u.pathname.startsWith(SITE + "api/")) p = u.pathname.slice(SITE.length - 1);
    return p ? { path: p, query: u.search.replace(/^\?/, "") } : null;
  }
  async function bridged(input, init, target) {
    const req = input instanceof Request && !init ? input : new Request(new URL(target.path, location.origin), init || {});
    const method = req.method.toUpperCase();
    const headers = [];
    req.headers.forEach((v, k) => headers.push([k, v]));
    const bodyBuf = method === "GET" || method === "HEAD" ? new Uint8Array(0) : new Uint8Array(await req.arrayBuffer());
    const run = async () => {
      const r = await wm.handle(method, target.path, target.query, py.toPy(headers), bodyBuf);
      const [status, hdrs, bytes] = r.toJs();
      r.destroy();
      return { status, hdrs, bytes };
    };
    const job = queue.then(run, run);
    queue = job.catch(() => {});
    const { status, hdrs, bytes } = await job;
    if (method !== "GET" && status < 400) scheduleSave();
    const h = new Headers();
    for (const [k, v] of hdrs) { try { h.append(k, v); } catch { /* skip */ } }
    const nullBody = [101, 204, 205, 304].includes(status);
    return new Response(nullBody ? null : bytes, { status, headers: h });
  }
  function installBridge() {
    window.fetch = (input, init) => {
      const target = apiPath(input);
      if (!target) return nativeFetch(input, init);
      if (!active) return Promise.resolve(new Response(JSON.stringify({ detail: "Ads Hub is open in another tab." }),
        { status: 409, headers: { "Content-Type": "application/json" } }));
      return bridged(input, init, target).catch((e) => {
        console.error(e);
        return new Response(JSON.stringify({ detail: "The hub engine hit an error: " + String(e && e.message || e).split("\n").slice(-2).join(" ") }),
          { status: 500, headers: { "Content-Type": "application/json" } });
      });
    };
  }

  // ---------------- start ----------------
  async function main() {
    mount();
    const params = new URLSearchParams(location.search);
    const reset = params.has("reset");
    let got = await holdLock(false);
    if (!got) {
      if (!reset && !params.has("take")) await askTakeOver();
      progress("Moving the hub to this tab…", 2);
      const released = waitReleased(6000);
      got = await holdLock(true);
      await released;
    }
    active = true;
    if (params.has("take")) history.replaceState(null, "", location.pathname + location.hash);
    if (reset) {
      progress("Clearing the hub data in this browser…", 5);
      try { await deleteDb(PERSIST); await deleteDb(KV_DB); }
      catch { fail("Could not clear the hub data while another Ads Hub tab is open. Close the other tabs, then click Try again."); return; }
      location.replace(location.pathname + location.hash);
      return;
    }
    progress("Checking for updates…", 2);
    let meta;
    try {
      const r = await nativeFetch(BASE + "hub.json", { cache: "no-store" });
      meta = await r.json();
    } catch (e) { fail("Could not load the hub files. Check your connection and try again."); return; }
    $("#ahw-ver").textContent = "Data published " + meta.published;

    // Python loads while the passcode is typed.
    progress("Starting the hub engine…", 5, 42);
    const pyReady = startPython(meta).then(() => bump(45));
    pyReady.catch(() => {});

    // Passcode: remembered in this browser as a key that cannot be read back.
    let key = await kvGet("key");
    if (!key || !(await keyWorks(key, meta))) {
      let msg = "";
      for (;;) {
        const pass = await askPasscode(msg);
        progress("Checking the passcode…");
        const k = await deriveKey(pass, meta);
        if (await keyWorks(k, meta)) { key = k; await kvSet("key", k); break; }
        msg = "That passcode is not right. Try again.";
      }
    }

    progress("Starting the hub engine…", 10, 44);
    try { await pyReady; } catch (e) { console.error(e); fail("The hub engine could not start in this browser. Use a current version of Chrome, Edge or Safari."); return; }

    // The hub's code (encrypted, because it carries account setup and goals)
    progress("Unlocking the hub…", 50);
    const codeEnc = await fetchParts(meta.code.parts);
    const code = await decrypt(key, meta.code.iv, codeEnc);
    py.FS.mkdirTree("/app");
    py.unpackArchive(code, "zip", { extractDir: "/app" });

    // This browser's data
    py.FS.mkdirTree(PERSIST);
    py.FS.mount(py.FS.filesystems.IDBFS, {}, PERSIST);
    try { await withTimeout(syncfs(true), 60000); }
    catch (e) {
      console.error(e);
      fail("The hub's saved data did not open. Close any other Ads Hub tabs and click Try again.\nIf it keeps happening, click Start over.");
      return;
    }
    guardIdb();
    const localVersion = readText(PERSIST + "/snapshot.txt");
    const skipped = readText(PERSIST + "/skipped.txt");
    let load = !exists(DB_PATH);
    if (!load && localVersion !== meta.db.version && skipped !== meta.db.version) {
      load = await askNewData(meta.published);
      if (!load) { py.FS.writeFile(PERSIST + "/skipped.txt", meta.db.version); await syncfs(false); }
    }
    if (load) {
      const size = meta.db.parts.reduce((a, p) => a + p.size, 0);
      const mb = (n) => (n / 1048576).toFixed(0);
      progress(`Downloading shared data (0 of ${mb(size)} MB)…`, 52);
      const enc = await fetchParts(meta.db.parts, (n) => progress(`Downloading shared data (${mb(n)} of ${mb(size)} MB)…`, 52 + 28 * n / size));
      progress("Unpacking the data…", 82);
      const gz = await decrypt(key, meta.db.iv, enc);
      const dbBytes = await gunzip(new Uint8Array(gz));
      for (const f of ["hub.db", "hub.db-wal", "hub.db-shm", "hub.db-journal", "skipped.txt"]) { try { py.FS.unlink(PERSIST + "/" + f); } catch { /* not there */ } }
      py.FS.writeFile(DB_PATH, dbBytes);
      py.FS.writeFile(PERSIST + "/snapshot.txt", meta.db.version);
      progress("Saving the data in this browser…", 88);
      await syncfs(false);
    }

    progress("Opening the hub…", 92);
    py.runPython("import sys\nif '/app' not in sys.path: sys.path.insert(0, '/app')");
    wm = py.pyimport("webmain");
    wm.init(DB_PATH, "/tmp/adshub");
    await syncfs(false);               // the first open can add settings or columns
    installBridge();
    progress("Opening the hub…", 100);
    await import(new URL(meta.entry, location.href).href);
    await new Promise((r) => setTimeout(r, 350));      // let the ring reach 100%
    stopBlob();
    $("#ahw").remove();
  }
  window.__adsHubSave = saveNow;
  main().catch((e) => { console.error(e); fail("Something went wrong while starting the hub:\n" + String(e && e.message || e).slice(0, 400)); });
})();
