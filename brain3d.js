/* brain3d.js — the persistent 3D knowledge-graph scene behind the whole page.
   Exposes: initBrain() -> api | null (null = caller applies CSS fallback). */

const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
const MOBILE = matchMedia('(max-width: 900px)').matches;

/* deterministic RNG so the graph is identical every visit */
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const TYPE_COLOR = {
  person:   0xf0f0f0,
  meeting:  0xa0e0ab,
  doc:      0x5f8f68,
  decision: 0xffac2e,
  deal:     0xc0452f,
  project:  0xb07a2a,
};

/* named entities from the demo company — hoverable, used by Ask paths */
const NAMED = [
  { name: 'Dr. Aris Thorne',        type: 'person',   cluster: 0 },
  { name: 'Battery recall',         type: 'decision', cluster: 0 },
  { name: 'ElectroCells switch',    type: 'decision', cluster: 1 },
  { name: 'Board meeting · 06/22',  type: 'meeting',  cluster: 1 },
  { name: 'Cyberdyne Systems deal', type: 'deal',     cluster: 2 },
  { name: 'Wayne Enterprises deal', type: 'deal',     cluster: 3 },
  { name: 'Q3 pipeline',            type: 'doc',      cluster: 3 },
  { name: 'Arthur Pendelton',       type: 'person',   cluster: 2 },
  { name: 'Rebecca Chen',           type: 'person',   cluster: 3 },
  { name: 'UL Labs audit',          type: 'doc',      cluster: 4 },
  { name: 'Thermal insight',        type: 'doc',      cluster: 5 },
  { name: 'Aether',                 type: 'project',  cluster: 5 },
];

/* extra anonymous nodes per type */
const FILL = [
  ['person', 15], ['meeting', 19], ['doc', 19], ['decision', 12], ['deal', 6], ['project', 7],
];

const SILO_OF_TYPE = { meeting: 0, decision: 0, doc: 1, project: 1, person: 2, deal: 3 };
const SILO_POS = [[-3.3, 1.5, -1], [3.3, 1.5, -1], [-3.3, -1.5, -1], [3.3, -1.5, -1]];

export async function initBrain() {
  const canvas = document.getElementById('brain-canvas');
  if (!canvas || REDUCED) return null;
  let THREE;
  try {
    THREE = await import('https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js');
  } catch { return null; }
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  } catch { return null; }

  const rand = mulberry32(7);
  const gauss = () => (rand() + rand() + rand() - 1.5);

  /* ---------- nodes ---------- */
  const nodes = NAMED.map((n) => ({ ...n }));
  FILL.forEach(([type, count]) => {
    for (let i = 0; i < count; i++) nodes.push({ name: null, type, cluster: (rand() * 6) | 0 });
  });
  const N = nodes.length;

  /* cluster centers on a flattened sphere */
  const CC = [];
  for (let c = 0; c < 6; c++) {
    const a = (c / 6) * Math.PI * 2 + 0.4;
    CC.push([Math.cos(a) * 1.5, Math.sin(a * 2) * 0.9, Math.sin(a) * 1.4]);
  }

  /* three position states: connected / scattered / ingesting */
  const stConnected = new Float32Array(N * 3);
  const stScattered = new Float32Array(N * 3);
  const stIngest    = new Float32Array(N * 3);
  nodes.forEach((n, i) => {
    const cc = CC[n.cluster];
    stConnected.set([cc[0] + gauss() * 0.8, cc[1] + gauss() * 0.7, cc[2] + gauss() * 0.8], i * 3);
    const sp = SILO_POS[SILO_OF_TYPE[n.type]];
    const sx = sp[0] + gauss() * 0.6, sy = sp[1] + gauss() * 0.45, sz = sp[2] + gauss() * 0.5;
    stScattered.set([sx, sy, sz], i * 3);
    /* ingest: streaming from silo toward the center with a swirl */
    const k = 0.35 + rand() * 0.35;
    const tang = [-sy, sx];
    const tl = Math.hypot(tang[0], tang[1]) || 1;
    stIngest.set([
      sx * k + (tang[0] / tl) * (0.5 + rand() * 0.6),
      sy * k + (tang[1] / tl) * (0.5 + rand() * 0.6),
      rand() * 1.8 - 0.9,
    ], i * 3);
  });
  const STATES = [stConnected, stScattered, stIngest];

  /* ---------- edges ---------- */
  const nameIdx = Object.fromEntries(NAMED.map((n, i) => [n.name, i]));
  const edgeSet = new Set();
  const edges = [];
  const addEdge = (a, b) => {
    if (a === b) return;
    const k = a < b ? a + '_' + b : b + '_' + a;
    if (edgeSet.has(k)) return;
    edgeSet.add(k); edges.push([a, b]);
  };
  /* guarantee the Ask paths exist */
  [
    ['Dr. Aris Thorne', 'Board meeting · 06/22', 'Battery recall', 'ElectroCells switch'],
    ['Cyberdyne Systems deal', 'Battery recall', 'Arthur Pendelton'],
    ['Wayne Enterprises deal', 'Q3 pipeline', 'Rebecca Chen'],
    ['Thermal insight', 'Dr. Aris Thorne', 'Aether'],
    ['Battery recall', 'UL Labs audit'],
  ].forEach((path) => path.slice(1).forEach((n, i) => addEdge(nameIdx[path[i]], nameIdx[n])));
  /* intra-cluster links */
  const byCluster = [...Array(6)].map(() => []);
  nodes.forEach((n, i) => byCluster[n.cluster].push(i));
  nodes.forEach((n, i) => {
    const peers = byCluster[n.cluster];
    const links = 1 + (rand() * 2 | 0);
    for (let l = 0; l < links; l++) addEdge(i, peers[(rand() * peers.length) | 0]);
  });
  /* named nodes are hubs */
  NAMED.forEach((_, i) => {
    for (let l = 0; l < 3; l++) addEdge(i, (rand() * N) | 0);
  });
  const E = edges.length;

  /* ---------- three.js objects ---------- */
  const scene = new THREE.Scene();
  const cam = new THREE.PerspectiveCamera(50, 1, 0.1, 60);
  cam.position.z = 6;
  const group = new THREE.Group();
  scene.add(group);

  const pos = new Float32Array(stConnected);         // current blended positions
  const phase = new Float32Array(N);
  for (let i = 0; i < N; i++) phase[i] = rand() * Math.PI * 2;

  const colOf = (i) => new THREE.Color(TYPE_COLOR[nodes[i].type]);

  /* base + named node point clouds */
  const mkPoints = (idxList, size, opacity) => {
    const g = new THREE.BufferGeometry();
    const p = new Float32Array(idxList.length * 3);
    const c = new Float32Array(idxList.length * 3);
    idxList.forEach((ni, j) => colOf(ni).toArray(c, j * 3));
    g.setAttribute('position', new THREE.BufferAttribute(p, 3));
    g.setAttribute('color', new THREE.BufferAttribute(c, 3));
    const m = new THREE.PointsMaterial({
      size, vertexColors: true, transparent: true, opacity,
      depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true,
    });
    const pts = new THREE.Points(g, m);
    pts.userData.idx = idxList;
    group.add(pts);
    return pts;
  };
  const namedIdx = NAMED.map((_, i) => i);
  const restIdx = [];
  for (let i = NAMED.length; i < N; i++) restIdx.push(i);
  const ptsNamed = mkPoints(namedIdx, MOBILE ? 0.09 : 0.11, 1);
  const ptsRest = mkPoints(restIdx, MOBILE ? 0.045 : 0.055, 0.85);

  /* edges */
  const eGeo = new THREE.BufferGeometry();
  const ePos = new Float32Array(E * 6);
  const eCol = new Float32Array(E * 6);
  edges.forEach(([a, b], j) => { colOf(a).toArray(eCol, j * 6); colOf(b).toArray(eCol, j * 6 + 3); });
  eGeo.setAttribute('position', new THREE.BufferAttribute(ePos, 3));
  eGeo.setAttribute('color', new THREE.BufferAttribute(eCol, 3));
  const eMat = new THREE.LineBasicMaterial({
    vertexColors: true, transparent: true, opacity: 0.3,
    depthWrite: false, blending: THREE.AdditiveBlending,
  });
  group.add(new THREE.LineSegments(eGeo, eMat));

  /* highlight line (hover + pulse paths) */
  const HL_MAX = 24;
  const hGeo = new THREE.BufferGeometry();
  const hPos = new Float32Array(HL_MAX * 6);
  hGeo.setAttribute('position', new THREE.BufferAttribute(hPos, 3));
  hGeo.setDrawRange(0, 0);
  const hMat = new THREE.LineBasicMaterial({
    color: 0xffac2e, transparent: true, opacity: 0.9,
    depthWrite: false, blending: THREE.AdditiveBlending,
  });
  group.add(new THREE.LineSegments(hGeo, hMat));
  let hlEdges = [];           // [a,b] pairs currently highlighted

  /* pulse sprites travelling paths */
  const PULSE_MAX = 6;
  const pGeo = new THREE.BufferGeometry();
  const pPos = new Float32Array(PULSE_MAX * 3).fill(999);
  pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
  const pMat = new THREE.PointsMaterial({
    color: 0xffc866, size: MOBILE ? 0.14 : 0.17, transparent: true, opacity: 1,
    depthWrite: false, blending: THREE.AdditiveBlending,
  });
  group.add(new THREE.Points(pGeo, pMat));
  const pulses = [];          // {path:[idx], seg, t, speed}

  /* ambient dust */
  const DN = MOBILE ? 500 : 1300;
  const dGeo = new THREE.BufferGeometry();
  const dPos = new Float32Array(DN * 3);
  for (let i = 0; i < DN * 3; i++) dPos[i] = gauss() * 6;
  dGeo.setAttribute('position', new THREE.BufferAttribute(dPos, 3));
  scene.add(new THREE.Points(dGeo, new THREE.PointsMaterial({
    color: 0x9a9a9a, size: 0.018, transparent: true, opacity: 0.35,
    depthWrite: false, blending: THREE.AdditiveBlending,
  })));

  /* ---------- scroll → state blending ---------- */
  /* segments across the story: connected→scattered→ingest→connected */
  const SEGS = [
    { a: 0, b: 1, e0: 0.35, e1: 0.015, z0: 6.0, z1: 7.4 },
    { a: 1, b: 2, e0: 0.015, e1: 0.1, z0: 7.4, z1: 5.6 },
    { a: 2, b: 0, e0: 0.1, e1: 0.85, z0: 5.6, z1: 6.0 },
  ];
  let blend = { a: 0, b: 1, t: 0 };
  let scatterW = 0;           // drives silo label opacity
  let scrollRotY = 0, camZ = 6;
  let stateName = 'CONNECTED';
  const api = {};
  api.onState = null;

  api.setScroll = (p) => {
    const s = Math.min(2, (p * 3) | 0);
    const t = Math.min(1, Math.max(0, p * 3 - s));
    const seg = SEGS[s];
    blend = { a: seg.a, b: seg.b, t };
    eMat.opacity = seg.e0 + (seg.e1 - seg.e0) * t;
    camZ = seg.z0 + (seg.z1 - seg.z0) * t;
    scrollRotY = p * 1.6;
    scatterW = s === 0 ? t : s === 1 ? 1 - t : 0;
    const name = p < 0.12 ? 'CONNECTED' : p < 0.5 ? 'SCATTERED' : p < 0.82 ? 'INGESTING' : 'CONNECTED';
    if (name !== stateName) { stateName = name; api.onState && api.onState(name); }
  };

  /* ---------- drag + hover ---------- */
  const rot = { x: 0, y: 0, tx: 0, ty: 0 };
  api.drag = (dx, dy) => {
    rot.ty += dx * 0.005;
    rot.tx = Math.max(-0.7, Math.min(0.7, rot.tx + dy * 0.003));
  };

  const ray = new THREE.Raycaster();
  ray.params.Points.threshold = 0.14;
  const ndc = new THREE.Vector2();
  const tip = document.getElementById('node-tip');
  const tipType = tip && tip.querySelector('.tip-type');
  const tipName = tip && tip.querySelector('.tip-name');
  let hovered = -1;

  api.hover = (cx, cy) => {
    ndc.set((cx / innerWidth) * 2 - 1, -(cy / innerHeight) * 2 + 1);
    ray.setFromCamera(ndc, cam);
    const hits = ray.intersectObject(ptsNamed);
    const ni = hits.length ? namedIdx[hits[0].index] : -1;
    if (ni === hovered) { if (ni >= 0 && tip) { tip.style.left = cx + 'px'; tip.style.top = cy + 'px'; } return; }
    hovered = ni;
    if (ni < 0) { tip && (tip.hidden = true); if (!pulses.length) hlEdges = []; return; }
    if (tip) {
      tipType.textContent = nodes[ni].type;
      tipName.textContent = nodes[ni].name;
      tip.style.left = cx + 'px'; tip.style.top = cy + 'px';
      tip.hidden = false;
    }
    if (!pulses.length) hlEdges = edges.filter(([a, b]) => a === ni || b === ni).slice(0, HL_MAX);
  };
  api.clearHover = () => { hovered = -1; tip && (tip.hidden = true); if (!pulses.length) hlEdges = []; };

  /* ---------- pulses ---------- */
  api.pulsePath = (names, repeat = 2) => {
    const path = names.map((n) => nameIdx[n]).filter((i) => i !== undefined);
    if (path.length < 2) return;
    for (let r = 0; r < repeat; r++) {
      if (pulses.length >= PULSE_MAX) break;
      pulses.push({ path, seg: 0, t: -r * 0.55, speed: 0.02 });
    }
    hlEdges = path.slice(1).map((n, i) => [path[i], n]);
  };

  /* ambient pulses keep the graph alive when connected */
  let ambientTimer = 0;
  const spawnAmbient = () => {
    if (eMat.opacity < 0.25 || pulses.length >= PULSE_MAX - 2) return;
    let cur = (rand() * N) | 0;
    const path = [cur];
    for (let s = 0; s < 3; s++) {
      const nbrs = edges.filter(([a, b]) => a === cur || b === cur);
      if (!nbrs.length) break;
      const [a, b] = nbrs[(rand() * nbrs.length) | 0];
      cur = a === path[path.length - 1] ? b : a;
      path.push(cur);
    }
    if (path.length > 1) pulses.push({ path, seg: 0, t: 0, speed: 0.014, quiet: true });
  };

  /* ---------- silo labels ---------- */
  const siloEls = [...document.querySelectorAll('.silo-label')];
  const v3 = new THREE.Vector3();
  const projectSilos = () => {
    siloEls.forEach((el, i) => {
      const sp = SILO_POS[i];
      v3.set(sp[0], sp[1] + 1.15, sp[2]).applyMatrix4(group.matrixWorld).project(cam);
      const vis = scatterW > 0.45 && v3.z < 1;
      el.style.opacity = vis ? Math.min(1, (scatterW - 0.45) * 2.5).toFixed(2) : 0;
      if (vis) {
        el.style.left = ((v3.x + 1) / 2 * innerWidth) + 'px';
        el.style.top = ((-v3.y + 1) / 2 * innerHeight) + 'px';
      }
    });
  };

  /* ---------- resize / visibility ---------- */
  function resize() {
    renderer.setSize(innerWidth, innerHeight, false);
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    cam.aspect = innerWidth / innerHeight;
    cam.updateProjectionMatrix();
  }
  resize();
  addEventListener('resize', resize);

  /* ---------- frame loop ---------- */
  const lerpArr = (out, A, B, t) => { for (let i = 0; i < out.length; i++) out[i] = A[i] + (B[i] - A[i]) * t; };
  const tmpA = new THREE.Vector3(), tmpB = new THREE.Vector3();

  renderer.setAnimationLoop((time) => {
    /* blend node positions + gentle organic wobble */
    lerpArr(pos, STATES[blend.a], STATES[blend.b], blend.t);
    for (let i = 0; i < N; i++) {
      pos[i * 3]     += Math.sin(time / 1600 + phase[i]) * 0.03;
      pos[i * 3 + 1] += Math.cos(time / 1900 + phase[i]) * 0.03;
    }
    /* write into the two point clouds */
    const write = (pts) => {
      const arr = pts.geometry.attributes.position.array;
      pts.userData.idx.forEach((ni, j) => { arr[j * 3] = pos[ni * 3]; arr[j * 3 + 1] = pos[ni * 3 + 1]; arr[j * 3 + 2] = pos[ni * 3 + 2]; });
      pts.geometry.attributes.position.needsUpdate = true;
    };
    write(ptsNamed); write(ptsRest);
    /* edges follow nodes */
    edges.forEach(([a, b], j) => {
      ePos[j * 6] = pos[a * 3]; ePos[j * 6 + 1] = pos[a * 3 + 1]; ePos[j * 6 + 2] = pos[a * 3 + 2];
      ePos[j * 6 + 3] = pos[b * 3]; ePos[j * 6 + 4] = pos[b * 3 + 1]; ePos[j * 6 + 5] = pos[b * 3 + 2];
    });
    eGeo.attributes.position.needsUpdate = true;
    /* highlight edges */
    hlEdges.slice(0, HL_MAX).forEach(([a, b], j) => {
      hPos[j * 6] = pos[a * 3]; hPos[j * 6 + 1] = pos[a * 3 + 1]; hPos[j * 6 + 2] = pos[a * 3 + 2];
      hPos[j * 6 + 3] = pos[b * 3]; hPos[j * 6 + 4] = pos[b * 3 + 1]; hPos[j * 6 + 5] = pos[b * 3 + 2];
    });
    hGeo.setDrawRange(0, Math.min(hlEdges.length, HL_MAX) * 2);
    hGeo.attributes.position.needsUpdate = true;
    hMat.opacity = hlEdges.length ? 0.85 : 0;
    /* pulses */
    for (let i = pulses.length - 1; i >= 0; i--) {
      const p = pulses[i];
      p.t += p.speed;
      if (p.t < 0) { pPos.set([999, 999, 999], i * 3); continue; }
      if (p.t >= 1) { p.t = 0; p.seg++; }
      if (p.seg >= p.path.length - 1) {
        pulses.splice(i, 1);
        if (!pulses.some((q) => !q.quiet) && hovered < 0) hlEdges = [];
        continue;
      }
      const a = p.path[p.seg], b = p.path[p.seg + 1];
      tmpA.fromArray(pos, a * 3); tmpB.fromArray(pos, b * 3);
      tmpA.lerp(tmpB, p.t);
      pPos[i * 3] = tmpA.x; pPos[i * 3 + 1] = tmpA.y; pPos[i * 3 + 2] = tmpA.z;
    }
    for (let i = pulses.length; i < PULSE_MAX; i++) pPos.set([999, 999, 999], i * 3);
    pGeo.attributes.position.needsUpdate = true;
    if (time - ambientTimer > 2600) { ambientTimer = time; spawnAmbient(); }
    /* rotation + camera */
    rot.ty += 0.0006;
    rot.x += (rot.tx - rot.x) * 0.06;
    rot.y += (rot.ty - rot.y) * 0.06;
    group.rotation.set(rot.x, rot.y + scrollRotY, 0);
    cam.position.z += (camZ - cam.position.z) * 0.06;
    group.updateMatrixWorld();
    projectSilos();
    renderer.render(scene, cam);
  });

  api.counts = { nodes: N, edges: E };
  return api;
}
