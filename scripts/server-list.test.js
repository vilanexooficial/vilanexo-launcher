const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const nbt = require('prismarine-nbt');
const { ensureServerEntry } = require('../src/server-list');
const { migrateMapConfig } = require('../src/map-config');

test('first launch, persistence, gzip migration and player entries', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vilanexo-servers-'));
  try {
    const file = path.join(dir, 'servers.dat');
    const ensure = () => ensureServerEntry(file, 'VilaNexo Cobblemon', 'poke.vilanexo.com', ['poke.vilanexo.com:25566']);
    ensure();
    const first = fs.readFileSync(file);
    assert.equal(first[0], 10, 'Java NBT must be uncompressed');
    let root = nbt.parseUncompressed(first);
    assert.equal(root.value.servers.value.value[0].ip.value, 'poke.vilanexo.com');
    ensure();
    assert.deepEqual(fs.readFileSync(file), first);
    root.value.servers.value.value[0].ip.value = 'poke.vilanexo.com:25566';
    root.value.servers.value.value.push({ name: { type: 'string', value: 'Meu servidor' }, ip: { type: 'string', value: 'example.com' }, icon: { type: 'string', value: 'custom-icon' } });
    const previous = zlib.gzipSync(nbt.writeUncompressed(root));
    fs.writeFileSync(file, previous);
    ensure();
    root = nbt.parseUncompressed(fs.readFileSync(file));
    assert.equal(root.value.servers.value.value.length, 2);
    assert.equal(root.value.servers.value.value[1].icon.value, 'custom-icon');
    assert.deepEqual(fs.readFileSync(`${file}.vilanexo.bak`), previous);
    ensure();
    assert.equal(nbt.simplify(nbt.parseUncompressed(fs.readFileSync(file))).servers.length, 2);
    fs.writeFileSync(file, 'broken-data');
    ensure();
    assert.equal(nbt.simplify(nbt.parseUncompressed(fs.readFileSync(file))).servers.length, 1);
    const backup = fs.readdirSync(dir).find(name => name.includes('.invalid-'));
    assert.equal(fs.readFileSync(path.join(dir, backup), 'utf8'), 'broken-data');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('map migration preserves local settings and runs only once', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vilanexo-map-'));
  try {
    fs.mkdirSync(path.join(dir, 'local'));
    const file = path.join(dir, 'local', 'ftbchunks-client.snbt');
    const original = '{ minimap: { enabled: true, scale: 2 }, waypoints: { enabled: true } }';
    fs.writeFileSync(file, original);
    migrateMapConfig(dir);
    assert.equal(fs.readFileSync(file, 'utf8'), original.replace('enabled: true', 'enabled: false'));
    assert.equal(fs.readFileSync(`${file}.before-xaero.bak`, 'utf8'), original);
    fs.writeFileSync(file, original);
    migrateMapConfig(dir);
    assert.equal(fs.readFileSync(file, 'utf8'), original);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
