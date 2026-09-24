// Partículas do fundo (leve: ~30 fps, pausa quando a janela não está visível).
(() => {
  const canvas = document.getElementById('fxCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  let w = 0, h = 0, dpr = 1, parts = [], last = 0, running = true;

  function accent() {
    const v = getComputedStyle(document.documentElement).getPropertyValue('--accent-rgb').trim() || '141,70,255';
    return v;
  }
  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    w = canvas.clientWidth; h = canvas.clientHeight;
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  function spawn(initial) {
    return {
      x: Math.random() * w,
      y: initial ? Math.random() * h : h + 10,
      r: Math.random() * 1.8 + .4,
      vy: Math.random() * .35 + .12,
      vx: (Math.random() - .5) * .15,
      a: Math.random() * .6 + .2,
      t: Math.random() * Math.PI * 2,
      white: Math.random() < .35
    };
  }
  function init() {
    resize();
    const count = Math.round(Math.min(70, (w * h) / 26000));
    parts = Array.from({ length: count }, () => spawn(true));
  }
  function frame(now) {
    if (!running) return;
    requestAnimationFrame(frame);
    if (now - last < 33) return;
    last = now;
    const rgb = accent();
    ctx.clearRect(0, 0, w, h);
    for (const p of parts) {
      p.t += .02; p.y -= p.vy; p.x += p.vx + Math.sin(p.t) * .12;
      if (p.y < -10) Object.assign(p, spawn(false));
      const tw = p.a * (.6 + .4 * Math.sin(p.t * 1.7));
      const color = p.white ? `rgba(255,255,255,${tw * .8})` : `rgba(${rgb},${tw})`;
      ctx.beginPath();
      ctx.fillStyle = color;
      ctx.shadowColor = color; ctx.shadowBlur = p.r * 6;
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  document.addEventListener('visibilitychange', () => {
    running = !document.hidden;
    if (running) requestAnimationFrame(frame);
  });
  window.addEventListener('resize', init);
  init();
  requestAnimationFrame(frame);
  setTimeout(() => document.body.classList.remove('booting'), 2200);
})();
