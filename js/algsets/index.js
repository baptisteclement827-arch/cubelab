// Bibliothèque d'algos : ensembles par puzzle (clé « puzzle/ensemble ») et calcul de l'état de chaque cas.
import { NxNCube } from '../core/nxn.js';
import { parseAlg, invertMoves } from '../core/notation.js';
import * as OLL from './333-oll.js?v=6';
import * as PLL from './333-pll.js?v=6';

export const ALG_SETS = {
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
  return state.map(c => map[c]);
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

// État aléatoire où le cas se présente (AUF aléatoire ; pour l'OLL, permutation aléatoire de la dernière couche).
export function randomCaseState(set, c, rand = Math.random) {
  let s = cube3.solved();
  if (set.view === 'oll') {
    const pll = ALG_SETS['333/pll'];
    const w = caseWeights(pll);
    const p = pickWeighted([...pll.CASES, null], x => (x ? w.get(x.id) : 4), rand); // null = PLL skip
    if (p) s = relabel(cube3.apply(s, invertMoves(parseAlg(p.alg))));
  }
  s = cube3.apply(s, randomAuf(rand));
  s = relabel(cube3.apply(s, invertMoves(parseAlg(c.alg))));
  return cube3.apply(s, randomAuf(rand));
}
