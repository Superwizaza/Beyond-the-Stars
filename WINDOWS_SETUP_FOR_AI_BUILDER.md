# Windows Setup & Distribution Guide (for an AI / developer)

**Goal:** take this game folder and make it runnable on a Windows laptop, and
optionally package it as a **free, standalone `.exe`** that anyone can double-click
with **no setup and no cost** (webcam included). Everything here uses free,
open-source tooling only.

This is written for another AI app-builder or developer picking up the project.

---

## 0. What you're working with

A browser game: `index.html` + `css/` + `js/` (Three.js from CDN). Two run modes:

- **Keyboard/mouse** — pure `file://`, no server needed.
- **Webcam pose control** — requires a secure context (`http://localhost` or a packaged
  app), because browsers block `getUserMedia` on `file://`.

There are **three distribution options**, cheapest-effort first.

---

## Option A — Just share the folder (keyboard play, zero cost, zero build)

1. Copy the entire `Game_Project` folder to the Windows laptop (USB, zip, cloud drive).
   - You can delete the `js_backup_*` and `html_backup_*` folders first — they're only
     safety snapshots and are not needed to run.
2. On Windows: **double-click `index.html`** → opens in Edge/Chrome → play with keyboard/mouse.

✅ Works on any Windows laptop instantly. ❌ No webcam in this mode.

---

## Option B — Webcam via the batch launcher (free, needs Python)

The repo already includes **`Play Game (Windows).bat`**. It finds its own folder, starts a
local Python web server, and opens the browser to the game.

**Requirement:** Python must be installed on that laptop.
1. Install Python (free): https://www.python.org/downloads/ — during install, **check
   "Add Python to PATH."**
2. Double-click **`Play Game (Windows).bat`**.
3. A console window opens ("Serving… port 8000") and the browser launches to
   `http://localhost:8000`. Press **V** in-game to enable webcam control.
4. Keep the console window open while playing; close it to stop the server.

✅ Free, webcam works. ❌ Each laptop needs Python; the console window stays open.

---

## Option C — Standalone `.exe` (free, no setup for end users) — RECOMMENDED for sharing

Package the game as a **Windows `.exe`** with Electron. End users then just double-click
the app — no Python, no server, no console, webcam auto-granted. Electron and its builder
are **100% free / open-source**; there is no license fee.

### Critical fact about cross-building
- **A build only produces an app for the OS you build ON.** A Mac build (`npm run build:mac`)
  makes a Mac `.app`; it does **NOT** produce a Windows `.exe`.
- To get a **Windows `.exe`, you must run the build on a Windows machine** (or a Windows VM /
  CI runner). This is the single most important gotcha.

### Files already in the repo for this
- `electron-main.js` — the desktop window wrapper; loads `index.html` and **auto-grants the
  camera permission** (so pose control works with no prompt).
- `package.json` — app manifest with Electron + `electron-builder` deps and build targets
  (`build:win` → NSIS installer `.exe`).
- `desktop/` — additional Electron scaffolding (`main.js`, `stage.js`, `BUILD_INSTRUCTIONS.md`).

### One-time build steps ON THE WINDOWS MACHINE
```
REM 1. Install Node.js LTS (free) from https://nodejs.org  (includes npm)
REM    Verify:
node --version

REM 2. In the game folder:
cd path\to\Game_Project
npm install            REM pulls in Electron + electron-builder automatically

REM 3. (optional) Test it live in a desktop window — instant, no build:
npm start

REM 4. Build the distributable Windows app:
npm run build:win
```
The finished installer appears in a new **`dist\`** folder, e.g.
`dist\Untitled Quest Setup 1.0.0.exe`.

### What end users do
Run the installer once (or the portable `.exe`), then launch **Untitled Quest** from the
Start menu / desktop. They need **nothing installed** — Electron bundles its own browser
engine, and the camera permission is granted by the app. Fully free.

### Notes / gotchas
- **Node.js is a build-time tool only.** It's installed on the *builder's* machine; it does
  **not** ship to end users and they never see it.
- If `npm install` fails behind a corporate proxy, set `npm config set proxy` / `https-proxy`,
  or build on a network without the proxy.
- Windows SmartScreen may warn on an unsigned `.exe` the first time ("More info → Run anyway").
  To remove the warning you'd need a paid code-signing certificate — **optional**, not required
  for it to run.
- The game files referenced by the build are listed under `build.files` in `package.json`
  (`index.html`, `css/**`, `js/**`, `pose-model/**`). If you add assets, update that list.

---

## Decision guide

| You want… | Use |
|---|---|
| Fastest share, keyboard only | **Option A** (copy folder, double-click `index.html`) |
| Webcam, willing to install Python on each laptop | **Option B** (`Play Game (Windows).bat`) |
| Polished, no-setup, shareable app with webcam, free | **Option C** (build `.exe` on Windows) |

For a game meant to be handed to many people, **Option C** is the right long-term answer —
just remember the `.exe` must be built on Windows.
