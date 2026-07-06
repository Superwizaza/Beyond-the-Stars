// ============================================================
// main.js — Electron main process for "Untitled Quest".
// Wraps the existing HTML/JS game in a standalone desktop window.
//
// Why this exists: browsers block webcam access (getUserMedia) on
// file:// pages, which is why the browser build needed a localhost
// server. Electron bundles its own Chromium and CAN grant the camera
// to a locally-loaded page — so the packaged app is a TRUE double-click
// with working webcam pose control, no server and no terminal.
//
// Game assets: `npm run stage` (see package.json) copies index.html,
// css/, and js/ into desktop/game/ so everything packages cleanly
// without electron-builder needing to reach into a parent folder.
// In dev (`npm start`) it falls back to the parent folder if game/
// hasn't been staged yet.
// ============================================================
const { app, BrowserWindow, session } = require('electron');
const path = require('path');
const fs = require('fs');

function resolveIndex() {
  const staged = path.join(__dirname, 'game', 'index.html');
  if (fs.existsSync(staged)) return staged;          // packaged / staged
  return path.join(__dirname, '..', 'index.html');    // dev fallback
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    title: 'Untitled Quest',
    backgroundColor: '#0d1117',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Grant camera permission automatically — this is what makes webcam pose
  // control work without a localhost server.
  session.defaultSession.setPermissionRequestHandler((wc, permission, cb) => cb(true));
  session.defaultSession.setPermissionCheckHandler(() => true);

  win.loadFile(resolveIndex());
  win.setMenuBarVisibility(false);
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
