// Abertura animada do launcher VilaNexo (2.6 — "o corte").
// 1. brasas sobem no escuro; 2. um golpe de pincel vermelho rasga a tela;
// 3. o logo sai de dentro do corte em estilhaços e se monta no lugar;
// 4. impacto: clarão, onda de choque, tremor e glitch vermelho; 5. brilho passa no logo e a coroa acende.
// Clique para pular. Se algo falhar, a tela libera sozinha.
(() => {
  const root = document.getElementById('intro');
  const done = () => {
    if (document.body.classList.contains('ready') && !document.getElementById('intro')) return;
    document.body.classList.add('ready');
    document.body.classList.remove('booting');
    const el = document.getElementById('intro'); if (el) el.remove();
  };
  if (!root) { done(); return; }
  const safety = setTimeout(done, 10000);
  try {
  if (new URLSearchParams(location.search).get('back')) { done(); return; }
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) { done(); return; }

  const $ = (s) => root.querySelector(s);
  const logo = $('.intro-logo');
  const imgMain = $('.il-main'), imgR = $('.il-r'), imgC = $('.il-c');
  const glint = $('.intro-glint'), crown = $('.intro-crown');
  const flash = $('.intro-flash'), pulse = $('.intro-pulse');
  const stage = $('.intro-stage');
  const caption = $('.intro-caption'), bar = $('.intro-caption em');
  const bars = root.querySelectorAll('.intro-bars i');
  const canvas = $('#introFx');
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas 2d indisponível');

  const rnd = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const easeOutQuart = t => 1 - Math.pow(1 - t, 4);
  const easeInOut = t => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  const now = () => performance.now();

  let W = 0, H = 0, dpr = 1, alive = true;
  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = root.clientWidth; H = root.clientHeight;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
  }
  resize();
  window.addEventListener('resize', resize);

  // ------------------------------------------------------------ brasas e tinta
  const embers = [], drops = [], rings = [];
  function ember(burst, x, y) {
    const hot = Math.random();
    embers.push({
      x: burst ? x : rnd(0, W), y: burst ? y : H + rnd(0, 40),
      vx: burst ? rnd(-6, 6) : rnd(-.3, .3), vy: burst ? rnd(-9, -1) : rnd(-1.6, -.5),
      size: rnd(.8, burst ? 3.2 : 2.4), life: burst ? rnd(50, 110) : rnd(160, 320), age: 0, t: rnd(0, 6),
      c: hot < .2 ? [255, 220, 180] : hot < .6 ? [255, 70, 40] : [210, 10, 24]
    });
  }
  for (let i = 0; i < 26; i++) { ember(false); embers[i].y = rnd(H * .3, H); }
  function splatter(x, y, dx, dy, n) {
    for (let i = 0; i < n; i++) {
      const sp = rnd(2, 15), a = Math.atan2(dy, dx) + rnd(-.55, .55);
      drops.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, g: .32, r: rnd(1, 4.5), life: rnd(30, 60), age: 0 });
    }
  }

  // ------------------------------------------------------------ o corte (pincel)
  // Curva levemente arqueada atravessando a tela da esquerda-baixo para a direita-cima.
  let slash = { p: 0, fade: 1, on: false };
  const S0 = () => ({ x: W * .06, y: H * .66 }), S1 = () => ({ x: W * .94, y: H * .30 }), SC = () => ({ x: W * .52, y: H * .38 });
  function slashAt(t) {
    const a = S0(), b = S1(), c = SC(), u = 1 - t;
    return { x: u * u * a.x + 2 * u * t * c.x + t * t * b.x, y: u * u * a.y + 2 * u * t * c.y + t * t * b.y };
  }
  // pincel seco: cerdas com largura, começo/fim e falhas diferentes (nada de linha lisa)
  const bristles = Array.from({ length: 16 }, () => {
    const off = rnd(-1, 1);
    return { off, w: rnd(.25, 2.4), t0: rnd(0, .12) + Math.abs(off) * .08, t1: 1 - rnd(0, .1) - Math.abs(off) * rnd(.05, .3),
      gaps: Array.from({ length: 3 + (Math.random() * 6 | 0) }, () => [rnd(0, 1), rnd(.008, .07) * (Math.abs(off) + .3)]), dry: rnd(.55, 1), jit: rnd(.5, 2.5) };
  });
  const flecks = Array.from({ length: 70 }, () => ({ t: rnd(.03, .97), off: rnd(-1.6, 1.6), r: rnd(.5, 2.2) }));
  function drawSlash() {
    if (!slash.on || slash.fade <= 0) return;
    const maxW = Math.min(W, H) * .05;
    const N = 110, end = slash.p;
    const width = t => maxW * Math.pow(Math.sin(Math.PI * clamp(t, 0, 1)), .7) * (.75 + .25 * Math.sin(t * 23));
    const pt = (t, off) => {
      const p = slashAt(t), q = slashAt(Math.min(1, t + .01));
      const nx = -(q.y - p.y), ny = q.x - p.x, nl = Math.hypot(nx, ny) || 1;
      const wv = width(t);
      return [p.x + nx / nl * off * wv, p.y + ny / nl * off * wv];
    };
    ctx.globalCompositeOperation = 'source-over';
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (const br of bristles) {
      const tEnd = Math.min(end, br.t1);
      if (tEnd <= br.t0) continue;
      ctx.beginPath();
      let pen = false;
      for (let i = 0; i <= N; i++) {
        const t = br.t0 + (i / N) * (tEnd - br.t0);
        if (br.gaps.some(([g, l]) => t > g && t < g + l)) { pen = false; continue; }
        const [x, y] = pt(t, br.off + Math.sin(t * 40 + br.jit) * .04);
        if (!pen) { ctx.moveTo(x, y); pen = true; } else ctx.lineTo(x, y);
      }
      const edge = Math.abs(br.off);
      ctx.strokeStyle = `rgba(${Math.round(150 + 80 * (1 - edge))},${Math.round(4 + 14 * (1 - edge))},${Math.round(12 + 10 * (1 - edge))},${slash.fade * br.dry})`;
      ctx.lineWidth = br.w * maxW * .13;
      ctx.stroke();
    }
    for (const f of flecks) {
      if (f.t > end) continue;
      const [x, y] = pt(f.t, f.off);
      ctx.fillStyle = `rgba(190,10,22,${.8 * slash.fade})`;
      ctx.beginPath(); ctx.arc(x, y, f.r, 0, Math.PI * 2); ctx.fill();
    }
    // fio de luz no meio do corte (fino)
    ctx.globalCompositeOperation = 'lighter';
    ctx.beginPath();
    for (let i = 0; i <= N; i++) { const t = .1 + (i / N) * Math.max(0, Math.min(end, .9) - .1); const p = slashAt(t); i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y); }
    ctx.strokeStyle = `rgba(255,170,150,${.45 * slash.fade})`; ctx.lineWidth = 1;
    ctx.shadowColor = 'rgba(255,30,40,.8)'; ctx.shadowBlur = 10; ctx.stroke(); ctx.shadowBlur = 0;
  }

  // ------------------------------------------------------------ estilhaços do logo
  let shards = [], shardStart = 0, L = null;
  const img = new Image();
  const imgReady = new Promise(res => { img.onload = () => res(true); img.onerror = () => res(false); });
  img.src = imgMain.getAttribute('src');
  function buildShards() {
    const r = logo.getBoundingClientRect();
    L = { x: r.left, y: r.top, w: r.width, h: r.height };
    // mapa de transparência para pular pedaços vazios
    const A = 48, oc = document.createElement('canvas'); oc.width = oc.height = A;
    const octx = oc.getContext('2d'); octx.drawImage(img, 0, 0, A, A);
    const alpha = octx.getImageData(0, 0, A, A).data;
    const filled = (u0, v0, u1, v1) => {
      for (let y = Math.floor(v0 * A); y <= Math.min(A - 1, Math.floor(v1 * A)); y++)
        for (let x = Math.floor(u0 * A); x <= Math.min(A - 1, Math.floor(u1 * A)); x++)
          if (alpha[(y * A + x) * 4 + 3] > 40) return true;
      return false;
    };
    const G = 13, P = [];
    for (let j = 0; j <= G; j++) { P[j] = []; for (let i = 0; i <= G; i++) {
      const edge = i === 0 || j === 0 || i === G || j === G;
      P[j][i] = [i / G + (edge ? 0 : rnd(-.3, .3) / G), j / G + (edge ? 0 : rnd(-.3, .3) / G)];
    } }
    shards = [];
    for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) {
      const a = P[j][i], b = P[j][i + 1], c = P[j + 1][i + 1], d = P[j + 1][i];
      const tris = Math.random() < .5 ? [[a, b, c], [a, c, d]] : [[a, b, d], [b, c, d]];
      for (const t of tris) {
        const us = t.map(p => p[0]), vs = t.map(p => p[1]);
        if (!filled(Math.min(...us), Math.min(...vs), Math.max(...us), Math.max(...vs))) continue;
        const cu = (us[0] + us[1] + us[2]) / 3, cv = (vs[0] + vs[1] + vs[2]) / 3;
        const target = { x: L.x + cu * L.w, y: L.y + cv * L.h };
        const s = .08 + .84 * cu;                       // sai do corte na mesma altura horizontal
        const sp = slashAt(s);
        shards.push({
          pts: t.map(p => [L.x + p[0] * L.w, L.y + p[1] * L.h]), target,
          from: { x: sp.x + rnd(-26, 26), y: sp.y + rnd(-26, 26) },
          mid: { x: (sp.x + target.x) / 2 + rnd(-140, 140), y: (sp.y + target.y) / 2 + rnd(-160, 40) },
          rot: rnd(-3.2, 3.2), s0: rnd(.15, .5), delay: cu * 520 + rnd(0, 200), dur: rnd(720, 980)
        });
      }
    }
  }
  function drawShards(t) {
    if (!shards.length || !L) return 0;
    let settled = 0;
    ctx.globalCompositeOperation = 'source-over';
    for (const sh of shards) {
      const k = clamp((t - shardStart - sh.delay) / sh.dur, 0, 1);
      if (k <= 0) continue;
      const e = easeOutQuart(k);
      if (k >= 1) settled++;
      // trajetória curva (bezier quadrática) do corte até o lugar
      const u = 1 - e;
      const x = u * u * sh.from.x + 2 * u * e * sh.mid.x + e * e * sh.target.x;
      const y = u * u * sh.from.y + 2 * u * e * sh.mid.y + e * e * sh.target.y;
      const sc = sh.s0 + (1 - sh.s0) * e, rot = sh.rot * u;
      ctx.save();
      ctx.translate(x, y); ctx.rotate(rot); ctx.scale(sc, sc); ctx.translate(-sh.target.x, -sh.target.y);
      ctx.beginPath(); ctx.moveTo(sh.pts[0][0], sh.pts[0][1]); ctx.lineTo(sh.pts[1][0], sh.pts[1][1]); ctx.lineTo(sh.pts[2][0], sh.pts[2][1]); ctx.closePath();
      ctx.save(); ctx.clip();
      const xs = sh.pts.map(p => p[0]), ys = sh.pts.map(p => p[1]);
      const bx = Math.min(...xs) - 1, by = Math.min(...ys) - 1, bw = Math.max(...xs) - bx + 2, bh = Math.max(...ys) - by + 2;
      const sx = (bx - L.x) / L.w * img.naturalWidth, sy = (by - L.y) / L.h * img.naturalHeight;
      ctx.globalAlpha = clamp(k * 3, 0, 1);
      ctx.drawImage(img, sx, sy, bw / L.w * img.naturalWidth, bh / L.h * img.naturalHeight, bx, by, bw, bh);
      ctx.restore();
      if (k < 1) { ctx.globalAlpha = 1; ctx.strokeStyle = `rgba(255,${Math.round(40 + 160 * u)},${Math.round(40 + 100 * u)},${.9 * u})`; ctx.lineWidth = 1.4 / sc; ctx.stroke(); }
      ctx.restore();
    }
    ctx.globalAlpha = 1;
    return settled / shards.length;
  }

  // ------------------------------------------------------------ laço de desenho
  let shardsOn = false;
  function frame() {
    if (!alive) return;
    const t = now();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    if (Math.random() < .5) ember(false);
    drawSlash();
    if (shardsOn) drawShards(t);
    ctx.globalCompositeOperation = 'lighter';
    for (const r of rings) {
      r.age++; r.r += r.v; r.v *= .94;
      const k = 1 - r.age / r.life; if (k <= 0) continue;
      ctx.beginPath(); ctx.strokeStyle = `rgba(${r.c},${k * .85})`; ctx.lineWidth = r.w * k;
      ctx.arc(r.x, r.y, r.r, 0, Math.PI * 2); ctx.stroke();
    }
    for (let i = rings.length - 1; i >= 0; i--) if (rings[i].age >= rings[i].life) rings.splice(i, 1);
    for (const p of embers) {
      p.age++; p.t += .05; p.vx *= .985; p.vy = p.vy * .99 - .01; p.x += p.vx + Math.sin(p.t) * .35; p.y += p.vy;
      const k = 1 - p.age / p.life; if (k <= 0) continue;
      const [r, g, b] = p.c, a = Math.min(1, k * 1.6) * (.6 + .4 * Math.sin(p.t * 3));
      ctx.fillStyle = `rgba(${r},${g},${b},${a})`;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.size * (.5 + k * .5), 0, Math.PI * 2); ctx.fill();
    }
    for (let i = embers.length - 1; i >= 0; i--) if (embers[i].age >= embers[i].life || embers[i].y < -20) embers.splice(i, 1);
    ctx.globalCompositeOperation = 'source-over';
    for (const d of drops) {
      d.age++; d.vx *= .96; d.vy = d.vy * .96 + d.g; d.x += d.vx; d.y += d.vy;
      const k = 1 - d.age / d.life; if (k <= 0) continue;
      ctx.fillStyle = `rgba(214,12,24,${Math.min(1, k * 1.5)})`;
      ctx.beginPath(); ctx.ellipse(d.x, d.y, d.r, d.r * (1 + Math.min(2, Math.hypot(d.vx, d.vy) * .12)), Math.atan2(d.vy, d.vx) + Math.PI / 2, 0, Math.PI * 2); ctx.fill();
    }
    for (let i = drops.length - 1; i >= 0; i--) if (drops[i].age >= drops[i].life) drops.splice(i, 1);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // ------------------------------------------------------------ sequência
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  const anim = (el, kf, opt) => el.animate(kf, { fill: 'forwards', ...opt }).finished.catch(() => {});
  const tween = (ms, fn, ease = x => x) => new Promise(res => {
    const t0 = now();
    const step = () => { const k = clamp((now() - t0) / ms, 0, 1); fn(ease(k)); if (k < 1 && alive) requestAnimationFrame(step); else res(); };
    requestAnimationFrame(step);
  });
  const shake = (px, ms) => anim(stage, [{ transform: 'translate(0,0)' }, { transform: `translate(${-px}px,${px * .7}px)` }, { transform: `translate(${px * .8}px,${-px * .6}px)` }, { transform: `translate(${-px * .4}px,${px * .3}px)` }, { transform: 'translate(0,0)' }], { duration: ms, fill: 'none' });
  let skipped = false;

  async function run() {
    const ok = await Promise.race([imgReady, wait(2500).then(() => false)]);
    // barras de cinema fecham um pouco
    bars.forEach(b => anim(b, [{ height: '0' }, { height: '7vh' }], { duration: 700, easing: 'cubic-bezier(.2,.8,.2,1)' }));
    await wait(420);
    if (skipped) return;

    // 2. o corte
    slash.on = true;
    const a0 = slashAt(0);
    splatter(a0.x, a0.y, -1, .4, 6);
    await tween(360, k => {
      const prev = slash.p; slash.p = k;
      const p = slashAt(k), q = slashAt(Math.max(0, prev));
      if (Math.random() < .7) splatter(p.x, p.y, p.x - q.x, p.y - q.y - 2, 2);
    }, easeInOut);
    if (skipped) return;
    const e1 = slashAt(1);
    splatter(e1.x, e1.y, 1, -.4, 34);
    shake(9, 280);
    anim(pulse, [{ opacity: 0 }, { opacity: .9, offset: .15 }, { opacity: 0 }], { duration: 700, easing: 'ease-out' });
    await wait(140);

    // 3. o logo sai do corte em estilhaços
    if (ok) {
      buildShards(); shardStart = now(); shardsOn = true;
      setTimeout(() => tween(700, k => { slash.fade = 1 - k; }), 350);
      await wait(520 + 200 + 980);
    } else {
      await wait(300);
    }
    if (skipped) return;
    if (slash.fade > 0) tween(300, k => { slash.fade = Math.min(slash.fade, 1 - k); });

    // 4. impacto
    shardsOn = false;
    logo.style.opacity = 1;
    const r = logo.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    rings.push({ x: cx, y: cy, r: r.width * .25, v: 26, life: 40, age: 0, w: 9, c: '255,255,255' });
    rings.push({ x: cx, y: cy, r: r.width * .2, v: 16, life: 55, age: 0, w: 5, c: '255,30,40' });
    for (let i = 0; i < 70; i++) ember(true, cx + rnd(-r.width * .4, r.width * .4), cy + rnd(-r.height * .2, r.height * .35));
    anim(flash, [{ opacity: 0, transform: 'translate(-50%,-50%) scale(.1)' }, { opacity: 1, transform: 'translate(-50%,-50%) scale(.45)', offset: .18 }, { opacity: 0, transform: 'translate(-50%,-50%) scale(1)' }], { duration: 1100, easing: 'ease-out' });
    anim(pulse, [{ opacity: 0 }, { opacity: 1, offset: .1 }, { opacity: 0 }], { duration: 1200, easing: 'ease-out' });
    shake(14, 360);
    anim(logo, [
      { transform: 'translate(-50%,-50%) scale(1.06)', filter: 'brightness(2.2) contrast(1.2)' },
      { transform: 'translate(-50%,-50%) scale(.985)', filter: 'brightness(1.1)', offset: .45 },
      { transform: 'translate(-50%,-50%) scale(1)', filter: 'brightness(1)' }
    ], { duration: 700, easing: 'cubic-bezier(.2,.8,.2,1)' });
    // glitch vermelho / ciano (aberração cromática) em pulsos curtos
    const gl = (el, dx) => anim(el, [
      { opacity: .9, transform: `translate(${dx}px,0)` }, { opacity: .7, transform: `translate(${-dx * .6}px,${dx * .2}px)`, offset: .2 },
      { opacity: .8, transform: `translate(${dx * 1.4}px,0)`, offset: .45 }, { opacity: .5, transform: 'translate(0,0)', offset: .7 }, { opacity: 0, transform: 'translate(0,0)' }
    ], { duration: 520, easing: 'steps(6)' });
    gl(imgR, 9); gl(imgC, -9);
    await wait(520);
    if (skipped) return;

    // 5. brilho e coroa
    anim(glint, [{ opacity: 1, backgroundPosition: '120% 0' }, { opacity: 1, backgroundPosition: '-20% 0' }], { duration: 950, easing: 'cubic-bezier(.4,0,.2,1)' });
    anim(crown, [{ opacity: 0, transform: 'translate(-50%,-50%) scale(.5)' }, { opacity: 1, transform: 'translate(-50%,-50%) scale(1.15)', offset: .35 }, { opacity: .55, transform: 'translate(-50%,-50%) scale(1)' }], { duration: 1100, delay: 250, easing: 'ease-out' });
    setTimeout(() => { const c = crown.getBoundingClientRect(); for (let i = 0; i < 18; i++) ember(true, c.left + c.width / 2 + rnd(-c.width * .3, c.width * .3), c.top + c.height / 2); }, 380);
    anim(logo, [{ transform: 'translate(-50%,-50%) scale(1)' }, { transform: 'translate(-50%,-50%) scale(1.035)' }], { duration: 2200, easing: 'ease-out' });
    anim(caption, [{ opacity: 0, transform: 'translate(-50%, 12px)', letterSpacing: '0' }, { opacity: 1, transform: 'translate(-50%, 0)' }], { duration: 500, delay: 200, easing: 'ease-out' });
    await anim(bar, [{ width: '0%' }, { width: '100%' }], { duration: 1350, delay: 250, easing: 'cubic-bezier(.4,0,.2,1)' });
    if (skipped) return;
    finish();
  }

  let finishing = false;
  async function finish() {
    if (finishing) return;
    finishing = true;
    document.body.classList.add('ready');
    bars.forEach(b => anim(b, [{ height: getComputedStyle(b).height }, { height: '0' }], { duration: 500 }));
    await Promise.race([
      anim(root, [{ opacity: 1, transform: 'scale(1)', filter: 'blur(0) brightness(1)' }, { opacity: 0, transform: 'scale(1.08)', filter: 'blur(8px) brightness(1.6)' }], { duration: 650, easing: 'cubic-bezier(.4,0,.2,1)' }),
      wait(1000)
    ]);
    alive = false;
    clearTimeout(safety);
    done();
  }

  root.addEventListener('click', () => { skipped = true; finish(); });
  run().catch((e) => { console.error('abertura', e); finish(); });
  setTimeout(() => finish(), 9000);
  } catch (e) {
    console.error('abertura falhou', e);
    clearTimeout(safety);
    done();
  }
})();
