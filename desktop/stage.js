// stage.js — copy the game assets (index.html, css/, js/) from the parent
// folder into desktop/game/ so electron-builder packages them cleanly.
// Runs automatically before `npm start` / `npm run build` (see package.json).
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');      // Game_Project/
const out = path.join(__dirname, 'game');      // desktop/game/

function copyRecursive(src, dst) {
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    fs.mkdirSync(dst, { recursive: true });
    for (const name of fs.readdirSync(src)) {
      copyRecursive(path.join(src, name), path.join(dst, name));
    }
  } else {
    fs.copyFileSync(src, dst);
  }
}

// Fresh copy each time.
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

// index.html
fs.copyFileSync(path.join(root, 'index.html'), path.join(out, 'index.html'));
// css/ and js/
for (const dir of ['css', 'js']) {
  const src = path.join(root, dir);
  if (fs.existsSync(src)) copyRecursive(src, path.join(out, dir));
}

console.log('Staged game assets into desktop/game/');
