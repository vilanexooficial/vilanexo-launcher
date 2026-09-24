// Abertura animada do launcher VilaNexo.
// Sequência: o cubo do logo cai, balança 3 vezes (como numa captura),
// explode em luz e revela o logo VilaNexo Cobblemon. Clique para pular.
(() => {
  const root = document.getElementById('intro');
  const done = () => {
    if (document.body.classList.contains('ready')) return;
    document.body.classList.add('ready');
    document.body.classList.remove('booting');
    if (root) root.remove();
  };
  if (!root) { done(); return; }
  // Voltando do jogo: sem abertura.
  if (new URLSearchParams(location.search).get('back')) { done(); return; }
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  if (reduce) { done(); return; }

  const $ = (s) => root.querySelector(s);
  const cube = $('.intro-cube');
  const cubeImg = $('.intro-cube img');
  const btnGlow = $('.intro-btn-glow');
  const shadow = $('.intro-shadow');
  const flash = $('.intro-flash');
  const logo = $('.intro-logo');
  const rays = $('.intro-rays');
  const caption = $('.intro-caption');
  const bar = $('.intro-caption em');
  const stage = $('.intro-stage');
  const canvas = $('#introFx');
  const ctx = canvas.getContext('2d');

  // ---------------------------------------------------------- partículas
  let W = 0, H = 0, dpr = 1, parts = [], rings = [], alive = true;
  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = root.clientWidth; H = root.clientHeight;
    canvas.width = W * dpr; canvas.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  resize();
  window.addEventListener('resize', resize);
  const center = () => {
    const r = cube.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height };
  };
  const rnd = (a, b) => a + Math.random() * (b - a);

  function dust(x, y, n = 40) {
    for (let i = 0; i < n; i++) {
      const a = rnd(Math.PI * 1.05, Math.PI * 1.95);
      const s = rnd(1.5, 6);
      parts.push({ x: x + rnd(-60, 60), y, vx: Math.cos(a) * s * 1.6, vy: Math.sin(a) * s * .55, g: .06, life: rnd(40, 70), age: 0, size: rnd(2, 5), color: [200, 190, 230], square: true, drag: .95 });
    }
  }
  function burst(x, y) {
    const palette = [[255, 255, 255], [255, 214, 90], [255, 90, 70], [180, 130, 255], [120, 220, 255]];
    for (let i = 0; i < 170; i++) {
      const a = rnd(0, Math.PI * 2);
      const s = rnd(3, 16);
      const c = palette[(Math.random() * palette.length) | 0];
      parts.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, g: .08, life: rnd(45, 95), age: 0, size: rnd(2, 6.5), color: c, square: Math.random() < .55, drag: .955, spin: rnd(-.3, .3), rot: 0 });
    }
    rings.push({ x, y, r: 10, v: 22, life: 38, age: 0, w: 10, color: '255,255,255' });
    rings.push({ x, y, r: 10, v: 14, life: 50, age: 0, w: 5, color: '255,210,90' });
    rings.push({ x, y, r: 10, v: 9, life: 62, age: 0, w: 3, color: '170,120,255' });
  }
  function sparkle(x, y, n = 14) {
    for (let i = 0; i < n; i++) {
      const a = rnd(0, Math.PI * 2), s = rnd(1, 4);
      parts.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, g: 0, life: rnd(20, 34), age: 0, size: rnd(1.5, 3), color: [255, 255, 255], square: false, drag: .93 });
    }
  }
  function frame() {
    if (!alive) return;
    ctx.clearRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'lighter';
    for (const r of rings) {
      r.age++; r.r += r.v; r.v *= .93;
      const t = 1 - r.age / r.life;
      if (t <= 0) continue;
      ctx.beginPath(); ctx.strokeStyle = `rgba(${r.color},${t * .9})`; ctx.lineWidth = r.w * t;
      ctx.arc(r.x, r.y, r.r, 0, Math.PI * 2); ctx.stroke();
    }
    rings = rings.filter(r => r.age < r.life);
    for (const p of parts) {
      p.age++; p.vx *= p.drag; p.vy = p.vy * p.drag + p.g; p.x += p.vx; p.y += p.vy;
      const t = 1 - p.age / p.life;
      if (t <= 0) continue;
      const [cr, cg, cb] = p.color;
      ctx.fillStyle = `rgba(${cr},${cg},${cb},${Math.min(1, t * 1.4)})`;
      if (p.square) {
        p.rot = (p.rot || 0) + (p.spin || 0);
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot);
        const s = p.size * (.4 + t * .6); ctx.fillRect(-s / 2, -s / 2, s, s); ctx.restore();
      } else {
        ctx.beginPath(); ctx.arc(p.x, p.y, p.size * t, 0, Math.PI * 2); ctx.fill();
      }
    }
    parts = parts.filter(p => p.age < p.life);
    ctx.globalCompositeOperation = 'source-over';
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // ---------------------------------------------------------- sequência
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  const anim = (el, kf, opt) => el.animate(kf, { fill: 'forwards', ...opt }).finished.catch(() => {});
  let skipped = false;

  async function run() {
    await wait(250);
    // 1. linha de luz e legenda
    anim($('.intro-line'), [{ transform: 'scaleX(0)', opacity: 0 }, { transform: 'scaleX(1)', opacity: 1 }, { transform: 'scaleX(1.2)', opacity: 0 }], { duration: 900, easing: 'cubic-bezier(.2,.8,.2,1)' });
    anim($('.intro-kicker'), [{ opacity: 0, letterSpacing: '1.4em' }, { opacity: 1, letterSpacing: '.7em' }, { opacity: 0, letterSpacing: '.6em' }], { duration: 1100, easing: 'ease-out' });
    await wait(450);

    // 2. queda
    cube.style.opacity = 1;
    anim(shadow, [{ opacity: 0, transform: 'translateX(-50%) scale(.2)' }, { opacity: 1, transform: 'translateX(-50%) scale(1)' }], { duration: 520, easing: 'cubic-bezier(.55,0,1,.45)' });
    await anim(cube, [
      { transform: 'translateY(-120vh) rotate(-28deg) scale(.9)', filter: 'blur(6px)' },
      { transform: 'translateY(0) rotate(0deg) scale(1)', filter: 'blur(0)' }
    ], { duration: 520, easing: 'cubic-bezier(.55,0,1,.45)' });
    if (skipped) return;
    const c0 = center();
    dust(c0.x, c0.y + c0.h * .46, 46);
    rings.push({ x: c0.x, y: c0.y + c0.h * .46, r: 30, v: 12, life: 26, age: 0, w: 4, color: '200,180,255' });
    anim(stage, [{ transform: 'translate(0,0)' }, { transform: 'translate(-7px,5px)' }, { transform: 'translate(6px,-4px)' }, { transform: 'translate(-3px,2px)' }, { transform: 'translate(0,0)' }], { duration: 260, easing: 'linear', fill: 'none' });
    await anim(cube, [
      { transform: 'translateY(0) scale(1.08, .86)' },
      { transform: 'translateY(-26px) scale(.96, 1.05)' },
      { transform: 'translateY(0) scale(1.03, .97)' },
      { transform: 'translateY(0) scale(1, 1)' }
    ], { duration: 520, easing: 'ease-out' });
    if (skipped) return;

    // 3. três balançadas (como uma captura)
    for (let i = 0; i < 3; i++) {
      await wait(i === 0 ? 180 : 260);
      if (skipped) return;
      anim(btnGlow, [{ opacity: 0, transform: 'scale(.6)' }, { opacity: 1, transform: 'scale(1.3)' }, { opacity: 0, transform: 'scale(1.8)' }], { duration: 520, easing: 'ease-out' });
      const r = cube.getBoundingClientRect();
      sparkle(r.left + r.width * .73, r.top + r.height * .64, 8);
      const dir = i % 2 === 0 ? 1 : -1;
      await anim(cube, [
        { transform: 'rotate(0deg)' },
        { transform: `rotate(${-14 * dir}deg) translateX(${-6 * dir}px)` },
        { transform: `rotate(${10 * dir}deg) translateX(${4 * dir}px)` },
        { transform: `rotate(${-4 * dir}deg)` },
        { transform: 'rotate(0deg)' }
      ], { duration: 460, easing: 'ease-in-out' });
    }
    if (skipped) return;
    await wait(220);

    // 4. explosão de luz
    anim(cubeImg, [{ filter: 'brightness(1)' }, { filter: 'brightness(2.6) saturate(.4)' }], { duration: 260, easing: 'ease-in' });
    await anim(cube, [{ transform: 'scale(1)' }, { transform: 'scale(1.12)' }], { duration: 260, easing: 'ease-in' });
    if (skipped) return;
    const c1 = center();
    burst(c1.x, c1.y);
    anim(cube, [{ transform: 'scale(1.12)', opacity: 1 }, { transform: 'scale(.2)', opacity: 0 }], { duration: 240, easing: 'ease-in' });
    anim(shadow, [{ opacity: 1 }, { opacity: 0 }], { duration: 300 });
    anim(flash, [{ opacity: 0, transform: 'translate(-50%,-50%) scale(.2)' }, { opacity: 1, transform: 'translate(-50%,-50%) scale(1.4)', offset: .25 }, { opacity: 0, transform: 'translate(-50%,-50%) scale(3.2)' }], { duration: 900, easing: 'ease-out' });
    anim(rays, [{ opacity: 0, transform: 'translate(-50%,-50%) rotate(0deg) scale(.6)' }, { opacity: 1, transform: 'translate(-50%,-50%) rotate(40deg) scale(1)' }], { duration: 1600, easing: 'cubic-bezier(.2,.8,.2,1)' });
    anim(stage, [{ transform: 'translate(0,0)' }, { transform: 'translate(8px,-6px)' }, { transform: 'translate(-6px,5px)' }, { transform: 'translate(0,0)' }], { duration: 240, fill: 'none' });
    await wait(160);

    // 5. logo
    logo.style.opacity = 1;
    anim(logo, [
      { transform: 'translate(-50%,-50%) scale(.3) rotate(-6deg)', opacity: 0, filter: 'brightness(3) blur(8px)' },
      { transform: 'translate(-50%,-50%) scale(1.08) rotate(1deg)', opacity: 1, filter: 'brightness(1.3) blur(0)', offset: .6 },
      { transform: 'translate(-50%,-50%) scale(.98) rotate(0deg)', opacity: 1, filter: 'brightness(1)', offset: .82 },
      { transform: 'translate(-50%,-50%) scale(1)', opacity: 1, filter: 'brightness(1)' }
    ], { duration: 900, easing: 'cubic-bezier(.2,.8,.2,1)' });
    anim(caption, [{ opacity: 0, transform: 'translate(-50%, 12px)' }, { opacity: 1, transform: 'translate(-50%, 0)' }], { duration: 500, delay: 350, easing: 'ease-out' });
    await anim(bar, [{ width: '0%' }, { width: '100%' }], { duration: 1500, delay: 350, easing: 'cubic-bezier(.4,0,.2,1)' });
    if (skipped) return;
    finish();
  }

  let finishing = false;
  async function finish() {
    if (finishing) return;
    finishing = true;
    document.body.classList.add('ready');
    await anim(root, [{ opacity: 1, transform: 'scale(1)', filter: 'blur(0)' }, { opacity: 0, transform: 'scale(1.06)', filter: 'blur(6px)' }], { duration: 650, easing: 'cubic-bezier(.4,0,.2,1)' });
    alive = false;
    done();
  }

  root.addEventListener('click', () => { skipped = true; finish(); });
  run().catch(() => finish());
  // Rede de segurança: nunca deixa a abertura presa.
  setTimeout(() => finish(), 9000);
})();
