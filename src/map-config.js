const fs = require('fs');
const path = require('path');

function migrateMapConfig(gameDir) {
  const marker = path.join(gameDir, 'VilaNexo', 'xaero-migration-v1');
  if (fs.existsSync(marker)) return;
  for (const relative of ['local/ftbchunks-client.snbt', 'local/ftbchunks/client-config.snbt']) {
    const file = path.join(gameDir, relative);
    if (!fs.existsSync(file)) continue;
    const original = fs.readFileSync(file, 'utf8');
    const updated = original.replace(/(\bminimap\s*:\s*\{[^{}]*?\benabled\s*:\s*)true\b/, '$1false');
    if (original !== updated) {
      fs.copyFileSync(file, `${file}.before-xaero.bak`);
      fs.writeFileSync(file, updated);
    }
  }
  fs.mkdirSync(path.dirname(marker), { recursive: true });
  fs.writeFileSync(marker, 'Xaero replaces the FTB minimap. Claims are preserved.\n');
}

module.exports = { migrateMapConfig };
