// Drills : exercices ciblés. BLD Cross + X : une phase d'analyse (sans limite), puis l'exécution chronométrée.
// Chrono : Espace (appui court) lance l'analyse ; maintenir puis relâcher lance l'exécution ; Espace l'arrête.
import { NxNCube } from './core/nxn.js';
import { parseAlg } from './core/notation.js';

// analysis : le drill commence par une phase d'analyse (sinon le chrono part comme dans le Timer).
export const DRILLS = [
  { id: 'bldcross', name: 'BLD Cross + X', puzzle: '333', analysis: true },
  { id: 'slow', name: 'Slow solves', puzzle: '333', analysis: false },
];

// États : idle -> analysis -> hold -> ready -> running -> done.
export class DrillTimer {
  constructor({ settings, onUpdate, onDone, analysis = () => true }) {
    this.settings = settings;
    this.hasAnalysis = analysis;
    this.onUpdate = onUpdate;
    this.onDone = onDone;
    this.state = 'idle';
    this.analysisStart = 0;
    this.analysisMs = 0;
    this.startTime = 0;
    this.pressed = false;
    this.holdTimer = null;
    this.raf = null;
  }

  get busy() { return ['analysis', 'hold', 'ready', 'running'].includes(this.state); }

  keyDown(code, repeat) {
    if (code === 'Escape') { if (this.busy) { this.cancel(); return true; } return false; }
    if (code !== 'Space') return false;
    if (!repeat) this.press();
    return true;
  }

  keyUp(code) {
    if (code !== 'Space') return false;
    this.release();
    return true;
  }

  pointerDown() { this.press(); }
  pointerUp() { this.release(); }

  press() {
    if (this.state === 'running') { this.stop(); return; }
    // Sans phase d'analyse : depuis le repos, on passe directement au maintien.
    if ((this.state === 'idle' || this.state === 'done') && !this.hasAnalysis()) {
      this.analysisStart = performance.now();
      this.state = 'analysis';
    }
    if (this.state === 'analysis') {
      // Maintien : on se prépare à l'exécution (vert après le délai de maintien).
      this.state = 'hold';
      this.emit();
      clearTimeout(this.holdTimer);
      this.holdTimer = setTimeout(() => { if (this.state === 'hold') { this.state = 'ready'; this.emit(); } }, this.settings().holdMs);
      return;
    }
    if (this.state === 'idle' || this.state === 'done') this.pressed = true;
  }

  release() {
    if (this.pressed) {
      // Appui court depuis le repos : début de l'analyse.
      this.pressed = false;
      this.state = 'analysis';
      this.analysisStart = performance.now();
      this.loop();
    } else if (this.state === 'hold') {
      clearTimeout(this.holdTimer);
      this.state = this.hasAnalysis() ? 'analysis' : 'idle';
      this.emit();
    } else if (this.state === 'ready') {
      this.start();
    }
  }

  start() {
    const now = performance.now();
    this.analysisMs = this.hasAnalysis() ? Math.floor(now - this.analysisStart) : 0;
    this.startTime = now;
    this.state = 'running';
    this.loop();
  }

  stop(ms) {
    const exec = ms ?? Math.floor(performance.now() - this.startTime);
    this.state = 'done';
    cancelAnimationFrame(this.raf);
    this.onUpdate({ state: 'done', ms: exec, analysis: this.analysisMs });
    this.onDone({ analysis: this.analysisMs, exec });
  }

  cancel() {
    clearTimeout(this.holdTimer);
    cancelAnimationFrame(this.raf);
    this.pressed = false;
    this.state = 'idle';
    this.emit();
  }

  // Timer GAN : mains posées pendant l'analyse = préparation ; départ et arrêt du tapis.
  device(evt) {
    if (evt.kind === 'hands-on' && this.state === 'analysis') { this.state = 'hold'; this.emit(); }
    else if (evt.kind === 'ready' && (this.state === 'hold' || this.state === 'analysis')) { this.state = 'ready'; this.emit(); }
    else if (evt.kind === 'hands-off' && (this.state === 'hold' || this.state === 'ready')) { this.state = 'analysis'; this.emit(); }
    else if (evt.kind === 'start' && this.state !== 'running' && this.state !== 'idle' && this.state !== 'done') this.start();
    else if (evt.kind === 'stop' && this.state === 'running') this.stop(evt.ms);
  }

  loop() {
    cancelAnimationFrame(this.raf);
    const tick = () => {
      this.emit();
      if (this.busy) this.raf = requestAnimationFrame(tick);
    };
    tick();
  }

  emit() {
    const now = performance.now();
    if (this.state === 'running') this.onUpdate({ state: 'running', ms: now - this.startTime });
    else if (['analysis', 'hold', 'ready'].includes(this.state)) this.onUpdate({ state: this.state, analysis: now - this.analysisStart });
    else this.onUpdate({ state: this.state });
  }
}

// Stats d'une liste d'essais : nombre, réussite, moyennes d'analyse et d'exécution (essais réussis).
export function drillStats(list) {
  if (!list.length) return null;
  const ok = list.filter(x => x.ok);
  const mean = arr => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null);
  return {
    count: list.length,
    success: ok.length / list.length,
    analysis: mean(ok.map(x => x.analysis)),
    exec: mean(ok.map(x => x.exec)),
    best: ok.length ? Math.min(...ok.map(x => x.exec)) : null,
  };
}

// ---------- Longueur de la cross blanche ----------
// Distance exacte (en mouvements de face) pour résoudre la cross blanche, via une table construite une fois :
// l'état est la position (facette blanche) des 4 arêtes de la cross parmi 24 emplacements.
const cube = new NxNCube(3);
const faceOf = i => Math.floor(i / 9);
const EDGE_SLOTS = (() => {
  const byPiece = new Map();
  cube.points.forEach((p, i) => {
    if (p.filter(v => Math.abs(v) === 2).length !== 1) return; // facette d'arête : une seule coordonnée à ±2
    const key = p.map(v => Math.sign(v) * Math.min(Math.abs(v), 2)).join(',');
    if (!byPiece.has(key)) byPiece.set(key, []);
    byPiece.get(key).push(i);
  });
  const slots = [], partner = new Map();
  for (const [a, b] of byPiece.values()) { slots.push(a, b); partner.set(a, b); partner.set(b, a); }
  return { slots, partner, index: new Map(slots.map((v, k) => [v, k])) };
})();
const FACE_MOVES = ['U', 'R', 'F', 'D', 'L', 'B'].flatMap(f => [f, `${f}2`, `${f}'`]).map(m => parseAlg(m)[0]);
const MOVE_MAPS = FACE_MOVES.map(m => {
  const to = cube.perm(m);
  return EDGE_SLOTS.slots.map(i => EDGE_SLOTS.index.get(to[i]));
});
// Arêtes de la cross blanche (U blanc dans l'orientation du mélange) : facette blanche + couleur de l'autre facette.
const CROSS_EDGES = [1, 3, 5, 7].map(i => ({ white: i, other: faceOf(EDGE_SLOTS.partner.get(i)) }));
const encode = ks => ((ks[0] * 24 + ks[1]) * 24 + ks[2]) * 24 + ks[3];
let table = null;
function buildTable() {
  table = new Int8Array(24 ** 4).fill(-1);
  let frontier = [CROSS_EDGES.map(e => EDGE_SLOTS.index.get(e.white))];
  table[encode(frontier[0])] = 0;
  for (let d = 0; frontier.length; d++) {
    const next = [];
    for (const ks of frontier) {
      for (const map of MOVE_MAPS) {
        const nk = ks.map(k => map[k]);
        const code = encode(nk);
        if (table[code] === -1) { table[code] = d + 1; next.push(nk); }
      }
    }
    frontier = next;
  }
}

// Nombre minimal de mouvements pour faire la cross blanche sur un état (couleurs 0..5, U = blanc).
export function whiteCrossLength(state) {
  if (!table) buildTable();
  const ks = CROSS_EDGES.map(e => {
    const k = EDGE_SLOTS.slots.findIndex(i => state[i] === 0 && state[EDGE_SLOTS.partner.get(i)] === e.other);
    return k;
  });
  return table[encode(ks)];
}

// Deux réglages indépendants : le nombre de paires à prévoir, et la difficulté de la cross (longueur de la cross blanche).
export const PAIRS = [
  { n: 0, name: 'Cross' },
  { n: 1, name: '+1' },
  { n: 2, name: '+2' },
];
export const DIFFICULTIES = [
  { id: 'easy', name: 'Facile', short: 'F', title: 'Cross en 4 mouvements ou moins', min: 0, max: 4 },
  { id: 'medium', name: 'Moyenne', short: 'M', title: 'Cross en 5 ou 6 mouvements', min: 5, max: 6 },
  { id: 'hard', name: 'Difficile', short: 'D', title: 'Cross en 7 mouvements ou plus', min: 7, max: 99 },
  { id: 'any', name: 'Normale', short: '', title: 'Mélange quelconque' },
];
// Difficulté d'un essai enregistré (anciennes versions : niveaux c1/c2/c3, ou rien = normale).
export const difficultyOf = x => x.diff || { c1: 'easy', c2: 'medium', c3: 'hard' }[x.level] || 'any';

// ---------- Slow solves ----------
export const PACES = [
  { tps: 0, name: 'Sans' },
  { tps: 1, name: '1' },
  { tps: 1.5, name: '1,5' },
  { tps: 2, name: '2' },
  { tps: 3, name: '3' },
];
// Pause : un écart entre deux mouvements d'au moins 1 s (ou 2 battements si le métronome est plus lent).
export const pauseThreshold = tps => Math.max(1000, tps ? 2000 / tps : 0);

// Analyse d'un solve au cube connecté : t = instants des mouvements (ms depuis le départ), total = temps du solve.
export function slowMetrics(t, total, tps = 0) {
  if (!t?.length) return null;
  const gaps = t.map((x, i) => x - (i ? t[i - 1] : 0));
  gaps.push(Math.max(0, total - t.at(-1)));
  const limit = pauseThreshold(tps);
  const pauses = gaps.filter(g => g >= limit);
  return {
    moves: t.length,
    tps: t.length / (total / 1000),
    pauses: pauses.length,
    longest: Math.max(...gaps),
    pauseTime: pauses.reduce((a, b) => a + b, 0),
    gaps,
    limit,
  };
}

// Métronome : un clic court à chaque battement (Web Audio).
export class Metronome {
  constructor() { this.ctx = null; this.timer = null; }
  start(tps) {
    this.stop();
    if (!tps) return;
    this.ctx ||= new (window.AudioContext || window.webkitAudioContext)();
    const beat = () => {
      const o = this.ctx.createOscillator(), g = this.ctx.createGain(), now = this.ctx.currentTime;
      o.frequency.value = 1200;
      g.gain.setValueAtTime(0.25, now);
      g.gain.exponentialRampToValueAtTime(0.001, now + 0.05);
      o.connect(g).connect(this.ctx.destination);
      o.start(now);
      o.stop(now + 0.06);
    };
    beat();
    this.timer = setInterval(beat, 1000 / tps);
  }
  stop() { clearInterval(this.timer); this.timer = null; }
}
