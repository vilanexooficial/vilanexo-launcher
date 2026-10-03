// Troca de servidor (Cobblemon <-> RPG) com animacao de portal.
// O cartao de baixo mostra o outro servidor; ao clicar, um circulo de runas abre a tela,
// o destaque troca para o novo servidor por baixo e o portal fecha revelando ele.
(() => {
  const $ = (id) => document.getElementById(id);
  const SERVERS = {
    cobblemon: {
      id: 'cobblemon', host: 'poke.vilanexo.com', port: 25566,
      tag: 'SERVIDOR PRINCIPAL', a: 'Sua aventura', b: 'começa aqui',
      sub: 'Capture, treine e evolua. Economia, eventos, cidades e aventura sem fim num mundo de 2 milhões de blocos.',
      ver: '1.21.1', loader: 'NeoForge', title: 'VILANEXO COBBLEMON', short: ['VilaNexo ', 'Cobblemon'],
      desc: 'Capture, treine e evolua. Minecraft 1.21.1 • NeoForge', img: '../assets/server-cobblemon.png',
      theme: null, fx: [[255, 40, 50], [255, 120, 80], [255, 230, 220]]
    },
    rpg: {
      id: 'rpg', host: 'jogar.vilanexo.com', port: 25565,
      tag: 'MUNDO DE FANTASIA', a: 'Crie sua', b: 'lenda',
      sub: 'Raças, magias, classes e chefes lendários. Explore masmorras, domine feitiços e escreva seu nome na história do VilaNexo.',
      ver: '1.20.1', loader: 'Forge', title: 'VILANEXO RPG', short: ['VilaNexo ', 'RPG'],
      desc: 'Classes, magias, chefes e PvP. Minecraft 1.20.1 • Forge', img: '../assets/server-rpg.png',
      theme: '#9b5cff', fx: [[170, 110, 255], [255, 200, 90], [240, 225, 255]]
    }
  };
  let atual = 'cobblemon';
  try { const s = localStorage.getItem('vilanexo-servidor'); if (SERVERS[s]) atual = s; } catch {}
  window.vnServidorAtual = () => SERVERS[atual];

  function temaPadrao() { let t = null; try { t = localStorage.getItem('vilanexo-theme-v2'); } catch {} return t || '#e3121d'; }

  async function contarModsRpg() {
    if (window.vnModsCount?.rpg) return window.vnModsCount.rpg;
    try {
      const r = await fetch('https://www.vilanexo.com/launcher/rpg/manifest.json?l=' + Date.now(), { cache: 'no-store' });
      const m = await r.json();
      const n = (m.files || []).filter(f => /^mods\//i.test(f.path || '')).length;
      window.vnModsCount = { ...(window.vnModsCount || {}), rpg: n };
      return n;
    } catch { return null; }
  }

  function aplicar(id) {
    const s = SERVERS[id], outro = SERVERS[id === 'rpg' ? 'cobblemon' : 'rpg'];
    atual = id;
    try { localStorage.setItem('vilanexo-servidor', id); } catch {}
    const hero = $('heroCard');
    hero.dataset.profile = id;
    hero.classList.toggle('is-rpg', id === 'rpg');
    document.body.classList.toggle('srv-rpg', id === 'rpg');
    $('heroTag').textContent = s.tag;
    $('heroTitleA').textContent = s.a;
    $('heroTitleB').textContent = s.b;
    $('heroSub').textContent = s.sub;
    $('heroVer').textContent = s.ver;
    $('heroLoader').textContent = s.loader;
    $('heroHost').textContent = s.host;
    const mods = window.vnModsCount?.[id];
    $('heroMods').textContent = mods || '–';
    if (id === 'rpg' && !mods) contarModsRpg().then(n => { if (n && atual === 'rpg') $('heroMods').textContent = n; });
    $('heroPlayers').textContent = '–';
    // cartao de troca mostra o outro servidor
    const card = $('switchCard');
    card.dataset.target = outro.id;
    card.classList.toggle('to-cobblemon', outro.id === 'cobblemon');
    $('switchImg').src = outro.img;
    $('switchName').innerHTML = outro.short[0] + '<em>' + outro.short[1] + '</em>';
    $('switchDesc').textContent = outro.desc;
    $('switchTag').querySelector('span').textContent = outro.id === 'rpg' ? 'ABERTO • NOVO' : 'SERVIDOR PRINCIPAL';
    if (typeof applyTheme === 'function') applyTheme(s.theme || temaPadrao(), false);
    if (typeof refreshServerStatus === 'function') refreshServerStatus();
  }

  // ------------------------------------------------------------ animacao
  const fx = $('swapFx'), canvas = $('swapCanvas'), ctx = canvas.getContext('2d');
  // runas em volta do circulo
  const runes = fx.querySelector('.runes');
  const glyphs = ['M-4 -6 L4 6 M4 -6 L-4 6', 'M0 -7 L0 7 M-5 -2 L5 -2', 'M-5 6 L0 -7 L5 6 M-3 1 L3 1', 'M-4 -6 L4 0 L-4 6', 'M0 -7 L5 0 L0 7 L-5 0 Z', 'M-5 -6 L5 -6 L-5 6 L5 6', 'M-4 7 L-4 -7 L4 -2 L-4 2', 'M0 -7 L0 7 M-5 -6 L5 6'];
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2, x = 100 + Math.cos(a) * 85, y = 100 + Math.sin(a) * 85;
    const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    p.setAttribute('d', glyphs[i % glyphs.length]);
    p.setAttribute('transform', `translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${(a * 180 / Math.PI + 90).toFixed(1)}) scale(.75)`);
    runes.appendChild(p);
  }
  let parts = [], vivo = false, W = 0, H = 0;
  function tamanho() { const d = Math.min(devicePixelRatio || 1, 2); W = innerWidth; H = innerHeight; canvas.width = W * d; canvas.height = H * d; ctx.setTransform(d, 0, 0, d, 0, 0); }
  function explodir(cx, cy, cores, n) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, v = 2 + Math.random() * 11;
      parts.push({ x: cx, y: cy, vx: Math.cos(a) * v, vy: Math.sin(a) * v, r: 1 + Math.random() * 3, c: cores[(Math.random() * cores.length) | 0], t: 0, vida: 40 + Math.random() * 50 });
    }
  }
  function orbitar(cx, cy, cores) {
    for (let i = 0; i < 3; i++) {
      const a = Math.random() * Math.PI * 2, r = 120 + Math.random() * 60;
      parts.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r, vx: -Math.sin(a) * 2.2, vy: Math.cos(a) * 2.2 - .6, r: 1 + Math.random() * 2, c: cores[(Math.random() * cores.length) | 0], t: 0, vida: 50 });
    }
  }
  function quadro() {
    if (!vivo) return;
    ctx.clearRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'lighter';
    for (const p of parts) {
      p.t++; p.vx *= .965; p.vy *= .965; p.x += p.vx; p.y += p.vy;
      const k = 1 - p.t / p.vida; if (k <= 0) continue;
      ctx.fillStyle = `rgba(${p.c[0]},${p.c[1]},${p.c[2]},${k})`;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r * (0.5 + k * .5), 0, Math.PI * 2); ctx.fill();
    }
    parts = parts.filter(p => p.t < p.vida);
    requestAnimationFrame(quadro);
  }
  const anim = (el, kf, o) => el.animate(kf, { fill: 'forwards', ...o }).finished.catch(() => {});
  const espera = (ms) => new Promise(r => setTimeout(r, ms));
  let trocando = false;

  async function trocar(id, ev) {
    if (trocando || id === atual) return;
    if (document.body.classList.contains('busy')) return;
    trocando = true;
    const s = SERVERS[id];
    const rect = ev?.currentTarget?.getBoundingClientRect?.();
    const ox = rect ? rect.left + rect.width / 2 : innerWidth / 2, oy = rect ? rect.top + rect.height / 2 : innerHeight / 2;
    const cx = innerWidth / 2, cy = innerHeight / 2;
    fx.classList.remove('hidden');
    fx.classList.toggle('fx-rpg', id === 'rpg');
    $('swapKicker').textContent = id === 'rpg' ? 'ATRAVESSANDO O PORTAL PARA' : 'VOLTANDO PARA';
    $('swapTitle').textContent = s.title;
    tamanho(); parts = []; vivo = true; requestAnimationFrame(quadro);
    const bg = fx.querySelector('.swap-bg'), sigil = fx.querySelector('.swap-sigil'), nome = fx.querySelector('.swap-name');
    try {
      // 1. o portal abre a partir do cartao clicado
      explodir(ox, oy, s.fx, 60);
      await anim(bg, [{ clipPath: `circle(0px at ${ox}px ${oy}px)` }, { clipPath: `circle(${Math.hypot(innerWidth, innerHeight)}px at ${ox}px ${oy}px)` }], { duration: 620, easing: 'cubic-bezier(.7,0,.2,1)' });
      // 2. circulo de runas se desenha e gira
      sigil.classList.add('draw');
      anim(sigil, [{ opacity: 0, transform: 'translate(-50%,-50%) scale(.6) rotate(-40deg)' }, { opacity: 1, transform: 'translate(-50%,-50%) scale(1) rotate(0deg)' }], { duration: 700, easing: 'cubic-bezier(.2,.8,.2,1)' });
      const orb = setInterval(() => orbitar(cx, cy, s.fx), 30);
      aplicar(id);                                   // troca por baixo enquanto a tela esta coberta
      await espera(300);
      anim(nome, [{ opacity: 0, letterSpacing: '1.1em', filter: 'blur(10px)' }, { opacity: 1, letterSpacing: '.32em', filter: 'blur(0)' }], { duration: 650, easing: 'cubic-bezier(.2,.8,.2,1)' });
      await espera(950);
      clearInterval(orb);
      // 3. clarao e o portal fecha revelando o novo servidor
      explodir(cx, cy, s.fx, 140);
      anim(sigil, [{ transform: 'translate(-50%,-50%) scale(1) rotate(0deg)', opacity: 1 }, { transform: 'translate(-50%,-50%) scale(2.4) rotate(70deg)', opacity: 0 }], { duration: 520, easing: 'cubic-bezier(.6,0,.4,1)' });
      anim(nome, [{ opacity: 1, transform: 'translate(-50%,-50%) scale(1)' }, { opacity: 0, transform: 'translate(-50%,-50%) scale(1.15)' }], { duration: 420, easing: 'ease-in' });
      await anim(bg, [{ clipPath: `circle(${Math.hypot(innerWidth, innerHeight)}px at ${cx}px ${cy}px)`, opacity: 1 }, { clipPath: `circle(0px at ${cx}px ${cy}px)`, opacity: .6 }], { duration: 600, delay: 120, easing: 'cubic-bezier(.7,0,.3,1)' });
      // 4. o destaque entra
      const hero = $('heroCard');
      anim(hero, [{ transform: 'scale(.97)', filter: 'brightness(1.8) saturate(1.3)' }, { transform: 'scale(1)', filter: 'brightness(1) saturate(1)' }], { duration: 700, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'none' });
      hero.querySelectorAll('.hero-title span, .hero-title em, .hero-sub, .hero-chips, .hero-actions').forEach((el, i) =>
        anim(el, [{ opacity: 0, transform: 'translateY(18px)' }, { opacity: 1, transform: 'translateY(0)' }], { duration: 520, delay: 60 * i, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'none' }));
      await espera(500);
    } finally {
      vivo = false; ctx.clearRect(0, 0, W, H);
      sigil.classList.remove('draw');
      fx.classList.add('hidden');
      [bg, sigil, nome].forEach(el => el.getAnimations().forEach(a => a.cancel()));
      trocando = false;
    }
  }

  $('switchBtn').addEventListener('click', (e) => trocar($('switchCard').dataset.target, e));
  $('switchCard').addEventListener('click', (e) => { if (e.target.closest('#switchBtn')) return; trocar($('switchCard').dataset.target, { currentTarget: $('switchBtn') }); });
  aplicar(atual);
})();
