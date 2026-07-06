// ============================================================
// electron-main.js — desktop app wrapper for Untitled Quest.
// Named electron-main.js so it never collides with the game's
// own js/main.js. This opens the game in a bundled Chromium
// window and grants webcam permission automatically, so pose
// control works with NO local server and NO terminal — end
// users just double-click the built app.
// ============================================================
const { app, BrowserWindow, session } = require('electron');
const path = require('path');

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    title: 'Untitled Quest',
    backgroundColor: '#0d1117',
    webPreferences: {
      // The game is plain global scripts (no Node in the page); keep it sandboxed.
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Auto-grant camera (and mic) requests so the webcam pose control works
  // without any prompt friction. This is the app asking for its OWN camera.
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    if (permission === 'media') return callback(true);
    return callback(true);
  });
  // Some Chromium builds route getUserMedia through this check too.
  if (session.defaultSession.setPermissionCheckHandler) {
    session.defaultSession.setPermissionCheckHandler(() => true);
  }

  win.setMenuBarVisibility(false);
  win.loadFile('index.html');
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
