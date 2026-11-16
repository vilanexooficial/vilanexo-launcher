// Abertura animada do launcher VilaNexo (3.0 — "pixel").
// 1. o céu roxo do banner aparece do escuro; 2. a logo da coroa se monta em pixels
// (blocos grandes que vão afinando até ficar nítida); 3. brilho roxo + estrelinhas em pixel
// saem da coroa; 4. a barra de carregamento enche e a tela abre.
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
  const safety = setTimeout(done, 9000);
  let fechando = false;
  const fechar = () => {
    if (fechando) return; fechando = true;
    root.classList.add('saindo');
    setTimeout(() => { clearTimeout(safety); done(); }, 520);
  };
  try {
    if (new URLSearchParams(location.search).get('back')) { done(); return; }
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) { done(); return; }

    const canvas = root.querySelector('#introFx');
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('canvas 2d indisponível');
    const bar = root.querySelector('.intro-caption em');
    const off = document.createElement('canvas'), octx = off.getContext('2d');

    let W = 0, H = 0, dpr = 1;
    function resize() {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      W = root.clientWidth; H = root.clientHeight;
      canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    resize();
    window.addEventListener('resize', resize);

    const load = (src) => new Promise(res => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = src; });
    const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
    const ease = t => 1 - Math.pow(1 - clamp(t, 0, 1), 3);

    // estrelinhas em pixel (cruz de 4 pontas, como as do banner)
    const stars = [];
    function star(x, y, burst) {
      const a = Math.random() * Math.PI * 2, v = burst ? 1.5 + Math.random() * 5 : 0;
      stars.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - (burst ? 1 : 0), s: burst ? 2 + (Math.random() * 3 | 0) : 1 + (Math.random() * 2 | 0),
        life: burst ? 50 + Math.random() * 50 : 9999, age: 0, t: Math.random() * 6, c: Math.random() < .3 ? '#ffffff' : (Math.random() < .5 ? '#e05cff' : '#c99bff') });
    }
    for (let i = 0; i < 70; i++) star(Math.random(), Math.random() * .75, false);
    function drawStar(p, x, y, a) {
      const s = Math.max(1, Math.round(p.s));
      ctx.globalAlpha = a; ctx.fillStyle = p.c;
      ctx.fillRect(Math.round(x - s / 2), Math.round(y - s * 1.5), s, s * 3);
      ctx.fillRect(Math.round(x - s * 1.5), Math.round(y - s / 2), s * 3, s);
      ctx.globalAlpha = 1;
    }

    Promise.all([load('../assets/intro-fundo.jpg'), load('../assets/logo-vilanexo.png')]).then(([bg, logo]) => {
      if (!logo) { fechar(); return; }
      const t0 = performance.now();
      const T_FUNDO = 700, T_PIXEL0 = 350, T_PIXEL1 = 1750, T_BRILHO = 1850, T_FIM = 3300;
      let explodiu = false;
      root.classList.add('legenda');
      function frame(now) {
        if (!document.getElementById('intro')) return;
        const t = now - t0;
        ctx.clearRect(0, 0, W, H);
        ctx.imageSmoothingEnabled = true;
        // fundo: banner bem escuro, sem a logo do meio (ela vem por cima em pixels)
        if (bg) {
          const k = ease(t / T_FUNDO);
          const sc = Math.max(W / bg.width, H / bg.height) * (1.08 - .04 * ease(t / T_FIM));
          const bw = bg.width * sc, bh = bg.height * sc;
          ctx.globalAlpha = .55 * k;
          ctx.filter = 'blur(6px) saturate(1.15)';
          ctx.drawImage(bg, (W - bw) / 2, (H - bh) / 2, bw, bh);
          ctx.filter = 'none'; ctx.globalAlpha = 1;
        }
        const vg = ctx.createRadialGradient(W / 2, H * .45, Math.min(W, H) * .15, W / 2, H * .5, Math.max(W, H) * .75);
        vg.addColorStop(0, 'rgba(20,6,40,.25)'); vg.addColorStop(1, 'rgba(5,2,10,.95)');
        ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);
        // céu: estrelinhas piscando
        for (const p of stars) {
          if (p.life < 9999) continue;
          const a = (.35 + .65 * Math.abs(Math.sin(t / 700 + p.t))) * ease(t / T_FUNDO);
          drawStar(p, p.x * W, p.y * H, a * .8);
        }
        // logo
        const lw = Math.min(W * .62, H * 1.05, 900), lh = lw * logo.height / logo.width;
        const lx = (W - lw) / 2, ly = H * .43 - lh / 2;
        if (t > T_PIXEL0) {
          const u = clamp((t - T_PIXEL0) / (T_PIXEL1 - T_PIXEL0), 0, 1);
          // tamanho do bloco: 40px -> 1px em degraus
          const passos = [40, 28, 20, 14, 10, 7, 5, 3, 2, 1];
          const bs = passos[Math.min(passos.length - 1, Math.floor(u * passos.length))];
          const sw = Math.max(1, Math.round(lw / bs)), sh = Math.max(1, Math.round(lh / bs));
          off.width = sw; off.height = sh;
          octx.imageSmoothingEnabled = true; octx.clearRect(0, 0, sw, sh); octx.drawImage(logo, 0, 0, sw, sh);
          const sobe = (1 - ease(u)) * 18;
          ctx.globalAlpha = clamp(u * 2.2, 0, 1);
          if (t > T_BRILHO) { const g = Math.max(0, 1 - (t - T_BRILHO) / 900); ctx.shadowColor = `rgba(224,92,255,${.9 * g + .25})`; ctx.shadowBlur = 40 * g + 18; }
          ctx.imageSmoothingEnabled = bs <= 1;
          ctx.drawImage(bs <= 1 ? logo : off, lx, ly + sobe, lw, lh);
          ctx.shadowBlur = 0; ctx.globalAlpha = 1;
        }
        // clarão + estrelinhas saindo da coroa
        if (t > T_BRILHO && !explodiu) {
          explodiu = true;
          const cx = lx + lw * .52, cy = ly + lh * .12;
          for (let i = 0; i < 46; i++) star(cx, cy, true);
          for (let i = 0; i < 24; i++) star(lx + lw * (.1 + Math.random() * .8), ly + lh * (.3 + Math.random() * .5), true);
        }
        if (t > T_BRILHO && t < T_BRILHO + 450) {
          const k = 1 - (t - T_BRILHO) / 450;
          ctx.globalCompositeOperation = 'lighter';
          const fg = ctx.createRadialGradient(W / 2, H * .43, 0, W / 2, H * .43, Math.max(W, H) * .6);
          fg.addColorStop(0, `rgba(255,220,255,${.5 * k})`); fg.addColorStop(.3, `rgba(224,92,255,${.28 * k})`); fg.addColorStop(1, 'rgba(0,0,0,0)');
          ctx.fillStyle = fg; ctx.fillRect(0, 0, W, H);
          ctx.globalCompositeOperation = 'source-over';
        }
        for (const p of stars) {
          if (p.life === 9999) continue;
          p.age++; p.vx *= .96; p.vy = p.vy * .96 + .03; p.x += p.vx; p.y += p.vy;
          const k = 1 - p.age / p.life; if (k <= 0) continue;
          drawStar(p, p.x, p.y, k);
        }
        for (let i = stars.length - 1; i >= 0; i--) if (stars[i].life !== 9999 && stars[i].age >= stars[i].life) stars.splice(i, 1);
        // barras de cinema em pixel (abrem no começo)
        const barra = Math.round((1 - ease(t / 900)) * H * .5);
        if (barra > 0) { ctx.fillStyle = '#07030f'; ctx.fillRect(0, 0, W, barra); ctx.fillRect(0, H - barra, W, barra); }
        if (bar) bar.style.width = Math.round(clamp(t / T_FIM, 0, 1) * 100) + '%';
        if (t >= T_FIM) fechar();
        requestAnimationFrame(frame);
      }
      requestAnimationFrame(frame);
    });

    root.addEventListener('click', fechar);
  } catch (e) {
    console.error('[intro]', e);
    clearTimeout(safety); done();
  }
})();
