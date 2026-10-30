// Bibliothèque d'algos : ensembles par puzzle (clé « puzzle/ensemble ») et calcul de l'état de chaque cas.
import { NxNCube } from '../core/nxn.js';
import { parseAlg, invertMoves, formatAlg, formatMove } from '../core/notation.js';
import * as OLL from './333-oll.js?v=6';
import * as PLL from './333-pll.js?v=6';
import * as F2L from './333-f2l.js?v=28';

export const ALG_SETS = {
  '333/f2l': { ...F2L, view: 'f2l' },
  '333/oll': { ...OLL, view: 'oll' },
  '333/pll': { ...PLL, view: 'pll' },
};

const cube3 = new NxNCube(3);

const CENTERS = [4, 13, 22, 31, 40, 49];

// Renomme les couleurs d'après les centres (couleur du centre U -> 0, etc.), sans tourner le cube :
// l'algo reste exécuté dans le repère où on tient le cube, même s'il contient des rotations (y, x, r, M…).
export function relabel(state) {
  const map = [];
  CENTERS.forEach((idx, f) => { map[state[idx]] = f; });
  return state.map(c => (c < 6 ? map[c] : c)); // 6 = facette grise (masquée), inchangée
}

// État du cube quand le cas se présente : l'inverse de l'algo appliqué au cube résolu.
export function caseState(alg) {
  return relabel(cube3.apply(cube3.solved(), invertMoves(parseAlg(alg))));
}

const isOriented = s => s.slice(0, 9).every(c => c === s[4]);
const f2lSolved = s => {
  for (let i = 27; i < 36; i++) if (s[i] !== 3) return false;
  for (const f of [1, 2, 4, 5]) for (let i = 3; i < 9; i++) if (s[f * 9 + i] !== f) return false;
  return true;
};
const SOLVED_BY_VIEW = {
  oll: s => f2lSolved(s) && isOriented(s),
  pll: s => cube3.isSolved(s), // une rotation finale de U (AUF) est essayée par solvesCase
  f2l: s => f2lSolved(s),
};

const AUFS = ['', 'U', 'U2', "U'"];
const U = parseAlg('U');

// Vérifie qu'un algo (celui de l'utilisateur) résout le cas, sous n'importe quel angle de départ.
// Lève une erreur de syntaxe ; renvoie l'AUF à faire avant ('' si aucun), ou null si l'algo ne résout pas le cas.
export function solvesCase(set, c, alg) {
  const moves = parseAlg(alg);
  if (!moves.length) return null;
  const start = caseState(c.alg);
  for (const auf of AUFS) {
    let after = relabel(cube3.apply(start, [...parseAlg(auf), ...moves]));
    for (let k = 0; k < 4; k++, after = cube3.apply(after, U)) {
      if (SOLVED_BY_VIEW[set.view](after)) return auf;
    }
  }
  return null;
}

// ---------- Entraînement ----------

// Poids « réaliste » d'un cas : nombre d'états distincts qu'il recouvre (AUF avant et après),
// proportionnel à sa probabilité en solve. Ex. OLL : 4/216 la plupart, 1/216 pour l'OLL 20.
const weightCache = new Map();
export function caseWeights(set) {
  if (weightCache.has(set)) return weightCache.get(set);
  if (set.view === 'f2l') {
    const w = new Map(set.CASES.map(c => [c.id, 1]));
    weightCache.set(set, w);
    return w;
  }
  const LL = [0, 1, 2, 3, 5, 6, 7, 8, 9, 10, 11, 18, 19, 20, 36, 37, 38, 45, 46, 47];
  const key = s => (set.view === 'oll' ? LL.map(i => (s[i] === 0 ? 1 : 0)).join('') : Array.from(s).join(''));
  const w = new Map();
  for (const c of set.CASES) {
    const seen = new Set();
    const inv = invertMoves(parseAlg(c.alg));
    for (let b = 0; b < 4; b++) {
      let s = relabel(cube3.apply(cube3.apply(cube3.solved(), Array(b).fill(U[0])), inv));
      for (let a = 0; a < 4; a++, s = cube3.apply(s, U)) seen.add(key(s));
    }
    w.set(c.id, seen.size);
  }
  weightCache.set(set, w);
  return w;
}

export function pickWeighted(items, weightOf, rand = Math.random) {
  const total = items.reduce((acc, it) => acc + weightOf(it), 0);
  let r = rand() * total;
  for (const it of items) { r -= weightOf(it); if (r < 0) return it; }
  return items.at(-1);
}

const randomAuf = (rand = Math.random) => parseAlg(AUFS[Math.floor(rand() * 4)]);

// État aléatoire où le cas se présente. auf : AUF aléatoire avant (et après pour la PLL) ;
// sans AUF, le cas est exactement sous l'angle de l'algo. Pour l'OLL, la permutation est toujours aléatoire.
// setup : algo à défaire à la place de celui du cas (algo d'un autre slot F2L, variante…).
export function randomCaseState(set, c, rand = Math.random, { auf = true, setup = null } = {}) {
  let s = cube3.solved();
  if (set.view === 'oll') {
    const pll = ALG_SETS['333/pll'];
    const w = caseWeights(pll);
    const p = pickWeighted([...pll.CASES, null], x => (x ? w.get(x.id) : 4), rand); // null = PLL skip
    if (p) s = relabel(cube3.apply(s, invertMoves(parseAlg(p.alg))));
    s = cube3.apply(s, randomAuf(rand));
  } else if (set.view === 'f2l') {
    // Dernière couche quelconque : une OLL et une PLL au hasard (ou rien).
    for (const other of [ALG_SETS['333/oll'], ALG_SETS['333/pll']]) {
      const x = other.CASES[Math.floor(rand() * (other.CASES.length + 1))];
      if (x) s = relabel(cube3.apply(s, invertMoves(parseAlg(x.alg))));
      s = cube3.apply(s, randomAuf(rand));
    }
  } else if (auf) {
    s = cube3.apply(s, randomAuf(rand));
  }
  s = relabel(cube3.apply(s, invertMoves(parseAlg(setup || c.alg))));
  return auf ? cube3.apply(s, randomAuf(rand)) : s;
}

// Setup « reverse » : l'inverse de l'algo, encadré d'AUF aléatoires si demandé.
export function reverseSetup(alg, rand = Math.random, { auf = true } = {}) {
  const inv = invertMoves(parseAlg(alg));
  return auf ? [...randomAuf(rand), ...inv, ...randomAuf(rand)] : inv;
}

// État du cube après un setup (couleurs renommées d'après les centres).
export const stateAfter = moves => relabel(cube3.apply(cube3.solved(), moves));

// ---------- F2L : 4 slots, variantes avec des slots libres ----------
export const GRAY = 6;
export const SLOTS = [
  { id: 'FR', name: 'FR', faces: [2, 1], rot: '' },     // avant droit (slot des algos de base)
  { id: 'FL', name: 'FL', faces: [2, 4], rot: "y'" },   // avant gauche
  { id: 'BR', name: 'BR', faces: [5, 1], rot: 'y' },    // arrière droit
  { id: 'BL', name: 'BL', faces: [5, 4], rot: 'y2' },   // arrière gauche
];

// Pièces : facettes regroupées par position (face ±3 ramenée à ±2).
const PIECES = (() => {
  const map = new Map();
  cube3.points.forEach((p, i) => {
    const key = p.map(v => Math.sign(v) * Math.min(Math.abs(v), 2)).join(',');
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(i);
  });
  return [...map.values()].filter(p => p.length > 1);
})();
const faceOf = i => Math.floor(i / 9);
const llPieces = PIECES.filter(p => p.some(i => faceOf(i) === 0));
const slotPieces = slot => PIECES.filter(p => {
  const f = p.map(faceOf);
  return !f.includes(0) && slot.faces.every(x => f.includes(x));
});

// Cube résolu où les pièces de la dernière couche et des slots libres sont grises (sans importance).
function maskedF2L(empty = []) {
  const s = cube3.solved();
  const gray = [...llPieces, ...SLOTS.filter(sl => empty.includes(sl.id)).flatMap(slotPieces)];
  for (const p of gray) for (const i of p) s[i] = GRAY;
  return s;
}

// Traduit un algo dans un autre repère : rot A rot⁻¹, réécrit sans rotation autour (R -> B, etc.).
const moveCache = new Map();
const ID = Uint16Array.from({ length: 54 }, (_, i) => i);
const permKey = moves => cube3.apply(ID, moves).join();
const CANDIDATES = (() => {
  const out = [];
  for (const base of ['U', 'R', 'F', 'D', 'L', 'B', 'u', 'r', 'f', 'd', 'l', 'b', 'M', 'E', 'S', 'x', 'y', 'z']) {
    for (const suffix of ['', '2', "'"]) out.push(parseAlg(base + suffix)[0]);
  }
  return out;
})();
function translateMove(m, rot) {
  const key = `${formatMove(m)}|${rot}`;
  if (!moveCache.has(key)) {
    const r = parseAlg(rot);
    const target = permKey([...r, m, ...invertMoves(r)]);
    moveCache.set(key, CANDIDATES.find(c => permKey([c]) === target) || m);
  }
  return moveCache.get(key);
}
export function translateAlg(alg, rot) {
  if (!rot) return alg;
  return formatAlg(parseAlg(alg).map(m => translateMove(m, rot)));
}

const slotOf = id => SLOTS.find(s => s.id === id);
// Algo par défaut pour un slot : celui du FR, traduit pour ce slot.
export const slotAlg = (c, slotId) => translateAlg(c.alg, slotOf(slotId).rot);

// État masqué du cas pour un slot donné (pièces de la dernière couche et des slots libres en gris).
export function f2lCaseState(c, slotId = 'FR', empty = []) {
  return relabel(cube3.apply(maskedF2L(empty), invertMoves(parseAlg(slotAlg(c, slotId)))));
}

// L'algo résout-il le cas pour ce slot, les slots « empty » étant libres ? Renvoie l'AUF avant, ou null.
export function solvesF2L(c, slotId, alg, empty = []) {
  const moves = parseAlg(alg);
  if (!moves.length) return null;
  const start = f2lCaseState(c, slotId, empty);
  for (const auf of AUFS) {
    const s = relabel(cube3.apply(start, [...parseAlg(auf), ...moves]));
    if (s.every((v, i) => v === GRAY || v === faceOf(i))) return auf;
  }
  return null;
}

// Vue d'un cas F2L d'un autre slot depuis l'avant droit : on tourne le cube pour amener ce slot en FR.
export function slotView(state, slotId = 'FR') {
  const rot = slotOf(slotId)?.rot;
  return rot ? relabel(cube3.apply(state, parseAlg(rot))) : state;
}

// Grise les pièces de la dernière couche (celles qui portent une facette de la couleur du dessus).
export function maskLL(state) {
  const s = Uint8Array.from(state);
  for (const p of PIECES) if (p.some(i => state[i] === 0)) for (const i of p) s[i] = GRAY;
  return s;
}
