const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const nbt = require('prismarine-nbt');

function ensureServerEntry(file, name, address, aliases = []) {
  let root = { type: 'compound', name: '', value: {} };
  let original;
  if (fs.existsSync(file)) {
    original = fs.readFileSync(file);
    try {
      const data = original[0] === 0x1f && original[1] === 0x8b
        ? zlib.gunzipSync(original) : original;
      root = nbt.parseUncompressed(data, 'big');
      if (root.type !== 'compound' || (root.value.servers &&
          (root.value.servers.type !== 'list' || root.value.servers.value.type !== 'compound'))) {
        throw new Error('Lista de servidores invalida');
      }
    } catch (error) {
      // Preserve unreadable data before rebuilding the official entry.
      fs.copyFileSync(file, `${file}.invalid-${Date.now()}.bak`);
      root = { type: 'compound', name: '', value: {} };
    }
  }
  const list = root.value.servers ||= { type: 'list', value: { type: 'compound', value: [] } };
  const addresses = new Set([address, ...aliases].map(value => value.toLowerCase()));
  const existing = list.value.value.find(server => addresses.has(String(server.ip?.value).toLowerCase()));
  if (existing) {
    existing.ip = { type: 'string', value: address };
    existing.hidden = { type: 'byte', value: 0 };
  } else {
    list.value.value.push({
      name: { type: 'string', value: name },
      ip: { type: 'string', value: address },
      hidden: { type: 'byte', value: 0 }
    });
  }
  const data = nbt.writeUncompressed(root, 'big');
  if (original?.equals(data)) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (original) fs.copyFileSync(file, `${file}.vilanexo.bak`);
  const temp = `${file}.tmp-${process.pid}`;
  try {
    fs.writeFileSync(temp, data);
    fs.renameSync(temp, file);
  } finally {
    fs.rmSync(temp, { force: true });
  }
}

module.exports = { ensureServerEntry };
