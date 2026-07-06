# Building the standalone app (one time)

You only do this **once**. After it's built, anyone can double-click the app —
no terminal, no server, no Python, webcam works.

## Step 1 — Install Node.js (one time, free)
Download the **LTS** installer from https://nodejs.org and run it.
Verify in Terminal (only to check it installed):
```
node --version
```

## Step 2 — In the game folder, install dependencies (one time)
```
cd "/Users/deesharp/Downloads/Game_Project"
npm install
```
This pulls in Electron + the builder automatically. Nothing is installed globally.

## Step 3 — Try it live (optional, instant)
```
npm start
```
This opens the game in a desktop window immediately (webcam works). Great for
testing without building the full app.

## Step 4 — Build the double-clickable app
Mac:
```
npm run build:mac
```
Windows (run on a Windows machine):
```
npm run build:win
```
The finished app appears in a new **`dist/`** folder:
- Mac → `dist/Untitled Quest-1.0.0.dmg` (open it, drag the app to Applications)
- Windows → `dist/Untitled Quest Setup 1.0.0.exe`

## What end users do
Just open/run the app and play. The camera permission is auto-granted by the
app. They need **nothing installed**.

---

### Notes
- A build produces an app for the OS you build **on**. Build on Mac → Mac app.
  For a Windows `.exe`, run `npm run build:win` on Windows.
- Keyboard/mouse play also still works by double-clicking `index.html` directly
  (no webcam in that mode — browsers block the camera on `file://`).
- The `.command` / `.bat` launchers remain as a no-build fallback if you ever
  want the browser version.
