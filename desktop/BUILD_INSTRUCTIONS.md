# Building "Untitled Quest" as a standalone desktop app

This turns the game into a **normal double-click app** (`.app` on Mac, `.exe`
installer on Windows) with **working webcam pose control** — no terminal, no
localhost server, no browser needed by the end user.

You only build **once**. After that, anyone can run the resulting app with a
plain double-click and zero setup.

---

## Why this is needed

Browsers block webcam access on double-clicked `file://` pages — that's why the
web version needed `localhost:8000`. This desktop app bundles its own Chromium
(via Electron) and grants the camera to the local page, removing that limit
entirely.

---

## One-time build (on any machine with Node.js)

You need **Node.js** installed once to *produce* the app (not to run it).
Get it from https://nodejs.org (LTS). Then:

```
cd "/Users/deesharp/Downloads/Game_Project/desktop"
npm install
npm run build:mac      # produces a .dmg in desktop/dist/  (Mac)
# or
npm run build:win      # produces a .exe installer in desktop/dist/  (Windows)
```

- **Mac output:** `desktop/dist/Untitled Quest-1.0.0.dmg` — open it, drag the
  app to Applications, done. Double-click to play.
- **Windows output:** `desktop/dist/Untitled Quest Setup 1.0.0.exe` — run the
  installer; it creates a Start-menu / desktop shortcut.

> Build Mac apps on a Mac and Windows apps on Windows (cross-building is
> possible but fiddly — easiest to build each on its own OS).

---

## Test without packaging (quick dev run)

```
cd "/Users/deesharp/Downloads/Game_Project/desktop"
npm install
npm start
```

This opens the game in an Electron window immediately, with the webcam working —
handy to confirm everything before the full build.

---

## What the pieces are

| File | Role |
|---|---|
| `main.js` | Electron entry — opens the window, auto-grants the camera, loads the game |
| `package.json` | Dependencies + electron-builder packaging config |
| `stage.js` | Copies `index.html`, `css/`, `js/` into `desktop/game/` before packaging |
| `dist/` | Where the finished `.dmg` / `.exe` lands (created by the build) |

The game's own files (`index.html`, `css/`, `js/`) are **not** modified — the
desktop app just wraps them, so the browser version keeps working too.

---

## Controls (unchanged)

WASD/arrows move · Mouse look · Shift sprint · Space jump · Left-click attack ·
Right-click place · E grab · Q break · F eat · C craft · M map · V webcam pose
control.
