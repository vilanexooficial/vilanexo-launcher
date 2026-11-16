// 2.7.4: Discord Rich Presence ("Jogando VilaNexo Cobblemon") sem dependencias.
// Fala direto com o Discord aberto no PC pelo pipe local (discord-ipc-0..9).
const net = require('net');
const path = require('path');
const os = require('os');

class DiscordRPC {
  constructor(log) { this.log = log || (() => {}); this.sock = null; this.ready = false; this.pending = undefined; this.appId = null; this.buf = Buffer.alloc(0); }
  frame(op, obj) {
    const d = Buffer.from(JSON.stringify(obj), 'utf8');
    const h = Buffer.alloc(8); h.writeInt32LE(op, 0); h.writeInt32LE(d.length, 4);
    return Buffer.concat([h, d]);
  }
  pipeName(i) {
    if (process.platform === 'win32') return `\\\\?\\pipe\\discord-ipc-${i}`;
    const base = process.env.XDG_RUNTIME_DIR || process.env.TMPDIR || process.env.TMP || process.env.TEMP || os.tmpdir();
    return path.join(base, `discord-ipc-${i}`);
  }
  connect(appId) {
    return new Promise(resolve => {
      let i = 0;
      const next = () => {
        if (i > 9) return resolve(false);
        const s = net.createConnection(this.pipeName(i++));
        let ok = false;
        const t = setTimeout(() => { if (!ok) { try { s.destroy(); } catch {} next(); } }, 1500);
        s.once('connect', () => {
          ok = true; clearTimeout(t);
          this.sock = s; this.ready = false; this.buf = Buffer.alloc(0);
          s.on('error', () => {});
          s.on('close', () => { if (this.sock === s) { this.sock = null; this.ready = false; } });
          s.on('data', d => this.onData(d));
          try { s.write(this.frame(0, { v: 1, client_id: appId })); } catch {}
          resolve(true);
        });
        s.once('error', () => { if (!ok) { clearTimeout(t); next(); } });
      };
      next();
    });
  }
  onData(d) {
    try {
      this.buf = Buffer.concat([this.buf, d]);
      while (this.buf.length >= 8) {
        const op = this.buf.readInt32LE(0), len = this.buf.readInt32LE(4);
        if (this.buf.length < 8 + len) break;
        const body = this.buf.slice(8, 8 + len); this.buf = this.buf.slice(8 + len);
        let msg = {}; try { msg = JSON.parse(body.toString('utf8')); } catch {}
        if (op === 3 && this.sock) { this.sock.write(this.frame(4, msg)); continue; }
        if (op === 2) { this.close(); return; }
        if (msg.evt === 'READY') { this.ready = true; if (this.pending !== undefined) this.send(this.pending); }
        else if (msg.evt === 'ERROR') this.log(`Discord: ${msg.data && msg.data.message || 'erro'}`, 'AVISO');
      }
    } catch {}
  }
  send(activity) {
    if (!this.sock || !this.ready) return;
    const args = { pid: process.pid };
    if (activity) args.activity = activity;
    try { this.sock.write(this.frame(1, { cmd: 'SET_ACTIVITY', args, nonce: `${Date.now()}-${Math.random()}` })); } catch {}
  }
  async set(appId, activity) {
    this.pending = activity;
    if (!this.sock || this.appId !== appId) {
      this.close(); this.appId = appId;
      return this.connect(appId);
    }
    if (this.ready) this.send(activity);
    return true;
  }
  clear() {
    this.pending = undefined;
    if (this.sock && this.ready) this.send(null);
    setTimeout(() => this.close(), 600);
  }
  close() { try { if (this.sock) this.sock.end(); } catch {} this.sock = null; this.ready = false; }
}

module.exports = { DiscordRPC };
