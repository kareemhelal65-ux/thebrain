const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
const MOBILE = matchMedia('(max-width: 900px)').matches;

/* ---------- preloader ---------- */
function initPreloader() {
  const pre = document.getElementById('preloader');
  if (!pre) return Promise.resolve();
  if (REDUCED || !window.gsap) { pre.remove(); return Promise.resolve(); }
  const count = document.getElementById('preloader-count');
  return new Promise((resolve) => {
    const t0 = performance.now(), DUR = 1200;
    (function tick(now) {
      const p = Math.min(1, (now - t0) / DUR);
      count.textContent = Math.round(p * 100);
      if (p < 1) return requestAnimationFrame(tick);
      gsap.to(pre, {
        yPercent: -100, duration: 0.8, ease: 'power3.inOut', delay: 0.15,
        onComplete: () => { pre.remove(); resolve(); }
      });
    })(t0);
  });
}

/* ---------- smooth scroll ---------- */
let lenis = null;
function initSmoothScroll() {
  if (REDUCED || !window.Lenis) return;
  lenis = new Lenis({ duration: 1.1 });
  lenis.on('scroll', ScrollTrigger.update);
  gsap.ticker.add((t) => lenis.raf(t * 1000));
  gsap.ticker.lagSmoothing(0);
  // route anchor links through lenis
  document.querySelectorAll('a[href^="#"]').forEach((a) =>
    a.addEventListener('click', (e) => {
      const target = document.querySelector(a.getAttribute('href'));
      if (!target) return;
      e.preventDefault();
      lenis.scrollTo(target, { offset: 0 });
    })
  );
}

/* ---------- nav hide/show ---------- */
function initNav() {
  const nav = document.getElementById('site-nav');
  let last = 0;
  const onScroll = (y) => {
    nav.classList.toggle('hidden', y > last && y > 120);
    last = y;
  };
  if (lenis) lenis.on('scroll', ({ scroll }) => onScroll(scroll));
  else addEventListener('scroll', () => onScroll(scrollY), { passive: true });
}

/* ---------- generic section reveals ---------- */
function initReveals() {
  if (REDUCED) return;
  gsap.utils.toArray('.mono-label, .mcp-copy h2, .mcp-copy p, .arch-col, .contact-link, .contact-sub').forEach((el) => {
    gsap.from(el, {
      y: 40, autoAlpha: 0, duration: 1, ease: 'power3.out',
      scrollTrigger: { trigger: el, start: 'top 88%' }
    });
  });
  // hero entrance (after preloader)
  gsap.from('.hero-copy > *', { y: 60, autoAlpha: 0, duration: 1.1, ease: 'power3.out', stagger: 0.09, delay: 0.1 });
}

/* ---------- hero constellation ---------- */
const LOGO_PATHS = [
  'M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z',
  'M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z'
];
const MERCURY = [[0xa0/255,0xe0/255,0xab/255],[0xff/255,0xac/255,0x2e/255],[0xa5/255,0x2d/255,0x25/255]];

function sampleLogoPoints(n) {
  // rasterize the logo strokes to an offscreen canvas, sample lit pixels
  const S = 480, off = document.createElement('canvas');
  off.width = off.height = S;
  const ctx = off.getContext('2d');
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.7; ctx.lineCap = ctx.lineJoin = 'round';
  ctx.setTransform(S / 24, 0, 0, S / 24, 0, 0);
  LOGO_PATHS.forEach((d) => ctx.stroke(new Path2D(d)));
  const img = ctx.getImageData(0, 0, S, S).data;
  const pts = [];
  while (pts.length / 3 < n) {
    const x = (Math.random() * S) | 0, y = (Math.random() * S) | 0;
    if (img[(y * S + x) * 4 + 3] > 128) {
      pts.push((x / S - 0.5) * 2.0, -(y / S - 0.5) * 2.0, (Math.random() - 0.5) * 0.35);
    }
  }
  return new Float32Array(pts);
}

function mercuryColor(t) {
  // t in [0,1] across the gradient; piecewise lerp between the 3 stops
  const seg = t < 0.5 ? [MERCURY[0], MERCURY[1], t * 2] : [MERCURY[1], MERCURY[2], (t - 0.5) * 2];
  return seg[0].map((c, i) => c + (seg[1][i] - c) * seg[2]);
}

async function initConstellation() {
  const canvas = document.getElementById('constellation');
  const wrap = document.querySelector('.hero-visual');
  if (!canvas || REDUCED) return;
  let THREE;
  try {
    THREE = await import('https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js');
  } catch { wrap.classList.add('glow-fallback'); return; }
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  } catch { wrap.classList.add('glow-fallback'); return; }

  const N = MOBILE ? 2200 : 6500;
  const scene = new THREE.Scene();
  const cam = new THREE.PerspectiveCamera(50, 1, 0.1, 20);
  cam.position.z = 3.1;

  const home = sampleLogoPoints(N);
  const pos = new Float32Array(home);
  const col = new Float32Array(N * 3);
  const phase = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    // 135° gradient (top-left green → bottom-right red), steepened to reach both ends
    const t = ((home[i*3] - home[i*3+1] + 2) / 4 - 0.5) * 1.6 + 0.5;
    const c = mercuryColor(Math.min(1, Math.max(0, t)));
    col.set(c, i * 3);
    phase[i] = Math.random() * Math.PI * 2;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const mat = new THREE.PointsMaterial({ size: 0.022, vertexColors: true, transparent: true, opacity: 0.95, depthWrite: false });
  scene.add(new THREE.Points(geo, mat));

  // sparse ambient particles behind the brain
  const AN = MOBILE ? 80 : 220;
  const apos = new Float32Array(AN * 3), acol = new Float32Array(AN * 3);
  for (let i = 0; i < AN; i++) {
    apos.set([(Math.random()-0.5)*7, (Math.random()-0.5)*5, -1 - Math.random()*2], i*3);
    acol.set(mercuryColor(Math.random()), i*3);
  }
  const ageo = new THREE.BufferGeometry();
  ageo.setAttribute('position', new THREE.BufferAttribute(apos, 3));
  ageo.setAttribute('color', new THREE.BufferAttribute(acol, 3));
  scene.add(new THREE.Points(ageo, new THREE.PointsMaterial({ size: 0.02, vertexColors: true, transparent: true, opacity: 0.4, depthWrite: false })));

  const mouse = { x: 99, y: 99 };
  addEventListener('pointermove', (e) => {
    const r = canvas.getBoundingClientRect();
    mouse.x = ((e.clientX - r.left) / r.width - 0.5) * 3.2;
    mouse.y = -((e.clientY - r.top) / r.height - 0.5) * 3.2;
  });

  function resize() {
    const r = wrap.getBoundingClientRect();
    renderer.setSize(r.width, r.height, false);
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    cam.aspect = r.width / r.height;
    cam.updateProjectionMatrix();
  }
  resize();
  addEventListener('resize', resize);

  let visible = true;
  new IntersectionObserver(([e]) => (visible = e.isIntersecting)).observe(wrap);

  renderer.setAnimationLoop((t) => {
    if (!visible) return;
    for (let i = 0; i < N; i++) {
      const ix = i * 3;
      let tx = home[ix] + Math.sin(t / 1400 + phase[i]) * 0.018;
      let ty = home[ix+1] + Math.cos(t / 1700 + phase[i]) * 0.018;
      const dx = tx - mouse.x, dy = ty - mouse.y;
      const d2 = dx*dx + dy*dy;
      if (d2 < 0.25) { const f = (0.25 - d2) * 0.9; tx += dx * f; ty += dy * f; }
      pos[ix]   += (tx - pos[ix]) * 0.08;
      pos[ix+1] += (ty - pos[ix+1]) * 0.08;
    }
    geo.attributes.position.needsUpdate = true;
    scene.rotation.y = mouse.x === 99 ? 0 : mouse.x * 0.04;
    renderer.render(scene, cam);
  });
}

/* ---------- scroll scenes ---------- */
function initScenes() {
  if (REDUCED || !window.gsap) return;

  // manifesto: each beat scrubs in
  gsap.utils.toArray('#manifesto .beat').forEach((beat) => {
    gsap.fromTo(beat, { autoAlpha: 0.12, y: 60 }, {
      autoAlpha: 1, y: 0, ease: 'none',
      scrollTrigger: { trigger: beat, start: 'top 90%', end: 'top 45%', scrub: true }
    });
  });

  // capabilities: pinned scene (desktop only)
  if (!MOBILE) {
    document.documentElement.classList.add('pinned');
    const panels = gsap.utils.toArray('.cap-panel');
    const items = gsap.utils.toArray('.cap-index li');
    const setActive = (i) => {
      panels.forEach((p, j) => p.classList.toggle('active', i === j));
      items.forEach((el, j) => el.classList.toggle('active', i === j));
    };
    setActive(0);
    ScrollTrigger.create({
      trigger: '#capabilities',
      start: 'top top',
      end: '+=' + panels.length * 90 + '%',
      pin: '.cap-pin',
      scrub: true,
      onUpdate: (st) => setActive(Math.min(panels.length - 1, Math.floor(st.progress * panels.length)))
    });
  }

  // cairo: slow scale + settle
  gsap.fromTo('.cairo-line', { scale: 0.9, autoAlpha: 0.25 }, {
    scale: 1, autoAlpha: 1, ease: 'none',
    scrollTrigger: { trigger: '#cairo', start: 'top 85%', end: 'center center', scrub: true }
  });
}

/* ---------- terminal ---------- */
const TERM_SCRIPT = [
  { cmd: 'kg ask "what did we decide on pricing?"',
    out: '→ Tiered per-seat, approved 2026-06-28 · sources: board-sync transcript, #pricing thread' },
  { cmd: 'kg mcp status',
    out: '→ 4 agents connected · scopes: read/write · keys: member-scoped' },
  { cmd: 'kg audit --contradictions',
    out: '→ 2 conflicts found: Q3 headcount (HR doc vs. finance memo)' }
];

function initTerminal() {
  const cmdEl = document.getElementById('term-cmd');
  const outEl = document.getElementById('term-out');
  if (!cmdEl || REDUCED) return; // static command+answer already in DOM
  let i = 0;
  const type = (text, el, done) => {
    el.textContent = '';
    let c = 0;
    (function step() {
      el.textContent = text.slice(0, ++c);
      if (c < text.length) setTimeout(step, 26 + Math.random() * 40);
      else done();
    })();
  };
  const cycle = () => {
    const { cmd, out } = TERM_SCRIPT[i % TERM_SCRIPT.length]; i++;
    outEl.textContent = '';
    type(cmd, cmdEl, () => {
      setTimeout(() => {
        outEl.textContent = out;
        setTimeout(cycle, 3800);
      }, 500);
    });
  };
  // start only when visible
  new IntersectionObserver(([e], obs) => {
    if (e.isIntersecting) { cycle(); obs.disconnect(); }
  }, { threshold: 0.4 }).observe(cmdEl.closest('.terminal'));
}

/* ---------- cursor + magnetic ---------- */
function initCursor() {
  if (REDUCED || MOBILE || !matchMedia('(pointer: fine)').matches) return;
  const dot = document.querySelector('.cursor-dot');
  let x = 0, y = 0, tx = 0, ty = 0;
  addEventListener('pointermove', (e) => { tx = e.clientX; ty = e.clientY; dot.classList.add('on'); });
  (function raf() {
    x += (tx - x) * 0.2; y += (ty - y) * 0.2;
    dot.style.transform = `translate(${x - 5}px, ${y - 5}px)`;
    requestAnimationFrame(raf);
  })();
  document.querySelectorAll('a, button').forEach((el) => {
    el.addEventListener('pointerenter', () => dot.classList.add('grow'));
    el.addEventListener('pointerleave', () => dot.classList.remove('grow'));
  });
  // magnetic pills
  document.querySelectorAll('.pill').forEach((el) => {
    el.addEventListener('pointermove', (e) => {
      const r = el.getBoundingClientRect();
      gsap.to(el, { x: (e.clientX - r.left - r.width / 2) * 0.25, y: (e.clientY - r.top - r.height / 2) * 0.35, duration: 0.4 });
    });
    el.addEventListener('pointerleave', () => gsap.to(el, { x: 0, y: 0, duration: 0.5, ease: 'elastic.out(1, 0.4)' }));
  });
}

/* ---------- boot ---------- */
async function boot() {
  if (!window.gsap || !window.ScrollTrigger) {
    // CDN failed: static page stands on its own, just clear the curtain
    document.getElementById('preloader')?.remove();
    return;
  }
  gsap.registerPlugin(ScrollTrigger);
  initSmoothScroll();
  initNav();
  initConstellation();
  await initPreloader();
  initReveals();
  initScenes();
  initTerminal();
  initCursor();
}
boot();
