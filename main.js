const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
const MOBILE = matchMedia('(max-width: 900px)').matches;
const FINE = matchMedia('(pointer: fine)').matches;

/* ---------- preloader ---------- */
function initPreloader() {
  const pre = document.getElementById('preloader');
  if (!pre) return Promise.resolve();
  if (REDUCED || !window.gsap) { pre.remove(); return Promise.resolve(); }
  const count = document.getElementById('preloader-count');
  return new Promise((resolve) => {
    const t0 = performance.now(), DUR = 1100;
    (function tick(now) {
      const p = Math.min(1, (now - t0) / DUR);
      count.textContent = Math.round(p * 100);
      if (p < 1) return requestAnimationFrame(tick);
      gsap.to(pre, {
        yPercent: -100, duration: 0.8, ease: 'power3.inOut', delay: 0.1,
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
  const hud = document.getElementById('hud');
  const forgetEl = document.getElementById('ch-forget');
  const askEl = document.getElementById('ask');
  // HUD reads as commentary on the graph's story: it appears once "01 · The problem"
  // starts (not over the hero) and fades out again once the Ask chapter ends.
  let hudLow, hudHigh;
  const computeHudBounds = () => {
    hudLow = forgetEl ? forgetEl.offsetTop - innerHeight * 0.3 : 0;
    hudHigh = askEl ? askEl.offsetTop + askEl.offsetHeight : Infinity;
  };
  computeHudBounds();
  addEventListener('resize', computeHudBounds);
  let last = 0;
  const onScroll = (y) => {
    nav.classList.toggle('hidden', y > last && y > 120);
    if (hud) hud.classList.toggle('hidden', y < hudLow || y > hudHigh);
    last = y;
  };
  if (lenis) lenis.on('scroll', ({ scroll }) => onScroll(scroll));
  else addEventListener('scroll', () => onScroll(scrollY), { passive: true });
  onScroll(scrollY);
}

/* ---------- mobile-only: nav "Get in touch" scrolls to the contact section ---------- */
function initNavGetInTouch() {
  if (!MOBILE) return;                  // desktop keeps the direct mailto
  const link = document.getElementById('nav-get-in-touch');
  const contact = document.getElementById('contact');
  if (!link || !contact) return;
  link.addEventListener('click', (e) => {
    e.preventDefault();
    if (lenis) lenis.scrollTo(contact, { offset: 0 });
    else contact.scrollIntoView({ behavior: 'smooth' });
  });
}

/* ---------- the 3D brain ---------- */
let brain = null;
async function initScene() {
  try {
    const { initBrain } = await import('./brain3d.js');
    brain = await initBrain();
  } catch { brain = null; }
  if (!brain) { document.documentElement.classList.add('no3d'); return; }

  document.getElementById('hud-nodes').textContent = brain.counts.nodes;
  document.getElementById('hud-edges').textContent = brain.counts.edges;
  const hudState = document.getElementById('hud-state');
  brain.onState = (name) => { hudState.textContent = name; };

  /* scroll drives the scene through the story */
  if (window.gsap && window.ScrollTrigger) {
    ScrollTrigger.create({
      trigger: '#story',
      start: 'top 55%',
      end: 'bottom 85%',
      scrub: true,
      onUpdate: (st) => brain.setScroll(st.progress),
    });
  }

  /* hover picking only while a graph-live section is on screen */
  let hoverOn = false;
  const liveSections = new Set();
  const io = new IntersectionObserver((entries) => {
    entries.forEach((e) => e.isIntersecting ? liveSections.add(e.target) : liveSections.delete(e.target));
    hoverOn = liveSections.size > 0;
    if (!hoverOn) brain.clearHover();
  }, { threshold: 0.25 });
  document.querySelectorAll('.graph-live').forEach((s) => io.observe(s));

  if (FINE) {
    addEventListener('pointermove', (e) => {
      if (hoverOn && !dragging) brain.hover(e.clientX, e.clientY);
    }, { passive: true });
  }

  /* drag-to-rotate on hero + ask */
  let dragging = false;
  document.querySelectorAll('[data-drag]').forEach((sec) => {
    sec.addEventListener('pointerdown', (e) => {
      if (e.target.closest('a, button, input')) return;
      e.preventDefault();               // stop native drag-to-select over the copy
      dragging = true;
      document.documentElement.classList.add('dragging');
      brain.clearHover();
      let lx = e.clientX, ly = e.clientY;
      const move = (ev) => { brain.drag(ev.clientX - lx, ev.clientY - ly); lx = ev.clientX; ly = ev.clientY; };
      const up = () => {
        dragging = false;
        document.documentElement.classList.remove('dragging');
        removeEventListener('pointermove', move);
        removeEventListener('pointerup', up);
      };
      addEventListener('pointermove', move);
      addEventListener('pointerup', up);
    });
  });
}

/* ---------- scroll reveals ---------- */
function initReveals() {
  if (REDUCED || !window.gsap) return;
  gsap.from('.hero-copy > *', { y: 60, autoAlpha: 0, duration: 1.1, ease: 'power3.out', stagger: 0.09, delay: 0.1 });
  gsap.utils.toArray('.product-head, .tour-block, .mcp-copy, .terminal, .pricing-head, .price-panel, #architecture .mono-label, .arch-col, .contact-link, .contact-sub').forEach((el) => {
    gsap.from(el, {
      y: 44, autoAlpha: 0, duration: 1, ease: 'power3.out',
      scrollTrigger: { trigger: el, start: 'top 88%' }
    });
  });
  /* chapter beats: staggered reveals while the chapter is stuck */
  document.querySelectorAll('.chapter').forEach((chapter) => {
    const beats = chapter.querySelectorAll('.mono-label, .beat');
    beats.forEach((beat, i) => {
      gsap.fromTo(beat, { autoAlpha: 0, y: 46 }, {
        autoAlpha: 1, y: 0, ease: 'none',
        scrollTrigger: {
          trigger: chapter,
          start: ['top 70%', 'top 25%', 'top -12%', 'top -32%'][Math.min(i, 3)],
          end: '+=28%',
          scrub: true,
        }
      });
    });
  });
  gsap.fromTo('.cairo-line', { scale: 0.9, autoAlpha: 0.25 }, {
    scale: 1, autoAlpha: 1, ease: 'none',
    scrollTrigger: { trigger: '#cairo', start: 'top 85%', end: 'center center', scrub: true }
  });
}

/* ---------- Ask the Brain ---------- */
const PRESETS = {
  recall: {
    q: 'What did we decide about the battery recall?',
    path: ['Dr. Aris Thorne', 'Board meeting · 06/22', 'Battery recall', 'ElectroCells switch'],
    a: 'The board resolved to replace the recalled packs with certified units from ElectroCells. The switch away from CustomPCB was recorded as a formal decision: their inconsistent internal resistance caused the recall. Unit cost rises $1.20; without it, the product fails the final UL Labs audit.',
    cites: ['exec_board_meeting_2026_06_22.md', 'battery pack supplier switch'],
  },
  cyberdyne: {
    q: 'Why is the Cyberdyne deal stalled?',
    path: ['Cyberdyne Systems deal', 'Battery recall', 'Arthur Pendelton'],
    a: 'The $550k contract is waiting on legal sign-off created by the April recall. The corrective-action filing sits with Arthur Pendelton; expediting the CPSC submission unblocks it. The recall entity influences 24 downstream nodes, including the Q2 sales report.',
    cites: ['sales_pipeline_q1_q2_2026.csv', 'legal review thread'],
  },
  wayne: {
    q: 'What if we lose the Wayne Enterprises deal?',
    path: ['Wayne Enterprises deal', 'Q3 pipeline', 'Rebecca Chen'],
    a: 'Q3 pipeline drops 12%, from 6.85M to 6.03M. Finance should re-forecast Q3–Q4 revenue without the $820k, and the Final Launch Sprint needs its resources reallocated. Confidence: high.',
    cites: ['what-if projection', 'q3 pipeline report'],
  },
  thermal: {
    q: 'Who knows the thermal issue best?',
    path: ['Thermal insight', 'Dr. Aris Thorne', 'Aether'],
    a: 'Dr. Aris Thorne: author of the thermal insight memo, present in 8 related meetings, owner of 5 open tasks on the Aether project. Rebecca Chen holds secondary context from the pipeline reviews.',
    cites: ['person graph', 'meeting attendance'],
  },
};

function typewriter(el, text, ms) {
  if (REDUCED) { el.textContent = text; return Promise.resolve(); }
  el.textContent = '';
  return new Promise((resolve) => {
    let c = 0;
    (function step() {
      c = Math.min(text.length, c + 1 + (ms < 10 ? 1 : 0));
      el.textContent = text.slice(0, c);
      if (c < text.length) setTimeout(step, ms);
      else resolve();
    })();
  });
}

function initAsk() {
  const qEl = document.getElementById('ask-qtext');
  const aEl = document.getElementById('ask-atext');
  const cEl = document.getElementById('ask-cites');
  const chips = [...document.querySelectorAll('.ask-chips .chip')];
  if (!qEl) return;
  let busy = false;
  chips.forEach((chip) => chip.addEventListener('click', async () => {
    if (busy) return;
    const preset = PRESETS[chip.dataset.q];
    if (!preset) return;
    busy = true;
    chips.forEach((c) => { c.disabled = true; c.classList.toggle('active', c === chip); });
    aEl.textContent = '';
    cEl.innerHTML = '';
    await typewriter(qEl, preset.q, 24);
    if (brain) brain.pulsePath(preset.path, 2);
    await new Promise((r) => setTimeout(r, REDUCED ? 0 : 450));
    await typewriter(aEl, preset.a, 7);
    cEl.innerHTML = preset.cites.map((c) => `<span class="cite">${c}</span>`).join('');
    chips.forEach((c) => { c.disabled = false; });
    busy = false;
  }));
}

/* ---------- chat mode tabs ---------- */
function initModeTabs() {
  const tabs = document.querySelectorAll('.mode-tab');
  const shots = document.querySelectorAll('.mode-shots .shot-frame');
  tabs.forEach((tab) =>
    tab.addEventListener('click', () => {
      tabs.forEach((t) => { t.classList.toggle('active', t === tab); t.setAttribute('aria-selected', t === tab); });
      shots.forEach((s) => s.classList.toggle('active', s.dataset.shot === tab.dataset.shot));
    })
  );
}

/* ---------- screenshot tilt ---------- */
function initTilt() {
  if (REDUCED || MOBILE || !FINE || !window.gsap) return;
  document.querySelectorAll('[data-tilt]').forEach((frame) => {
    frame.addEventListener('pointermove', (e) => {
      const r = frame.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width - 0.5;
      const py = (e.clientY - r.top) / r.height - 0.5;
      gsap.to(frame, { rotateY: px * 7, rotateX: -py * 5, duration: 0.5, ease: 'power2.out', transformPerspective: 1200 });
    });
    frame.addEventListener('pointerleave', () =>
      gsap.to(frame, { rotateY: 0, rotateX: 0, duration: 0.7, ease: 'power3.out' })
    );
  });
}

/* ---------- lightbox: click a product shot to enlarge ---------- */
function initLightbox() {
  const lb = document.getElementById('lightbox');
  const lbImg = document.getElementById('lightbox-img');
  if (!lb) return;
  const open = (img) => {
    lbImg.src = img.currentSrc || img.src;
    lbImg.alt = img.alt || '';
    lb.hidden = false;
    document.documentElement.classList.add('lightbox-open');
    if (lenis) lenis.stop();
  };
  const close = () => {
    lb.hidden = true;
    document.documentElement.classList.remove('lightbox-open');
    if (lenis) lenis.start();
  };
  document.querySelectorAll('.shot-frame img').forEach((img) =>
    img.addEventListener('click', () => open(img))
  );
  lb.addEventListener('click', (e) => {
    if (e.target === lb || e.target.closest('.lightbox-close')) close();
  });
  addEventListener('keydown', (e) => { if (e.key === 'Escape' && !lb.hidden) close(); });
}

/* ---------- terminal ---------- */
const TERM_SCRIPT = [
  { cmd: 'kg ask "what did we decide on pricing?"',
    out: '→ Tiered per-seat, approved 2026-06-28 · sources: board-sync transcript, #pricing thread' },
  { cmd: 'kg mcp status',
    out: '→ 4 agents connected · scopes: read/write · keys: member-scoped' },
  { cmd: 'kg audit --contradictions',
    out: '→ 2 conflicts found: Q3 headcount (HR doc vs. finance memo)' },
];

function initTerminal() {
  const cmdEl = document.getElementById('term-cmd');
  const outEl = document.getElementById('term-out');
  if (!cmdEl || REDUCED) return;
  let i = 0;
  const cycle = () => {
    const { cmd, out } = TERM_SCRIPT[i % TERM_SCRIPT.length]; i++;
    outEl.textContent = '';
    typewriter(cmdEl, cmd, 30).then(() => {
      setTimeout(() => {
        outEl.textContent = out;
        setTimeout(cycle, 3800);
      }, 500);
    });
  };
  new IntersectionObserver(([e], obs) => {
    if (e.isIntersecting) { cycle(); obs.disconnect(); }
  }, { threshold: 0.4 }).observe(cmdEl.closest('.terminal'));
}

/* ---------- pricing slider ---------- */
function initPricing() {
  const range = document.getElementById('price-range');
  if (!range) return;
  const seatsEl = document.getElementById('price-seats');
  const monthEl = document.getElementById('price-month');
  const seatEl = document.getElementById('price-seat');
  const tiers = [...document.querySelectorAll('.price-tier')];
  /* graduated bands, tax-bracket style: [seats in band, $/seat/mo] */
  const BANDS = [[10, 95], [20, 65], [20, 50], [Infinity, 35]];
  const priceFor = (n) => {
    let left = n, total = 0;
    for (const [size, rate] of BANDS) {
      const take = Math.min(left, size);
      total += take * rate;
      left -= take;
      if (left <= 0) break;
    }
    return total;
  };
  const fmt = (n) => '$' + n.toLocaleString('en-US');
  const update = () => {
    const n = +range.value;
    const price = priceFor(n);
    seatsEl.textContent = n >= +range.max ? range.max + '+' : n;
    monthEl.textContent = fmt(price);
    seatEl.textContent = fmt(Math.round(price / n));
    tiers.forEach((t) => t.classList.toggle('active', +t.dataset.start <= n));
    range.style.setProperty('--fill', ((n - range.min) / (range.max - range.min)) * 100 + '%');
  };
  range.addEventListener('input', update);
  update();
}

/* ---------- cursor + magnetic ---------- */
function initCursor() {
  if (REDUCED || MOBILE || !FINE) return;
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
  if (!window.gsap) return;
  document.querySelectorAll('.pill, .pill-outline').forEach((el) => {
    el.addEventListener('pointermove', (e) => {
      const r = el.getBoundingClientRect();
      gsap.to(el, { x: (e.clientX - r.left - r.width / 2) * 0.25, y: (e.clientY - r.top - r.height / 2) * 0.35, duration: 0.4 });
    });
    el.addEventListener('pointerleave', () => gsap.to(el, { x: 0, y: 0, duration: 0.5, ease: 'elastic.out(1, 0.4)' }));
  });
}

/* ---------- boot ---------- */
async function boot() {
  initModeTabs();
  initAsk();
  initLightbox();
  initNavGetInTouch();
  initPricing();
  if (!window.gsap || !window.ScrollTrigger) {
    document.getElementById('preloader')?.remove();
    initScene();       // graph still lives, just not scroll-driven
    initTerminal();
    return;
  }
  gsap.registerPlugin(ScrollTrigger);
  initSmoothScroll();
  initNav();
  initScene();
  await initPreloader();
  initReveals();
  initTilt();
  initTerminal();
  initCursor();
}
boot();
