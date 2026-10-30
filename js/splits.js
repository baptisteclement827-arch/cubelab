// Découpage CFOP d'un solve au cube connecté : croix, F2L, OLL, PLL.
// On rejoue les mouvements depuis l'état mélangé et on note quand chaque étape est terminée.
import { NxNCube } from './core/nxn.js';
import { parseAlg } from './core/notation.js';

const cube = new NxNCube(3);
export const PHASES = [
  { id: 'cross', name: 'Croix' },
  { id: 'f2l', name: 'F2L' },
  { id: 'oll', name: 'OLL' },
  { id: 'pll', name: 'PLL' },
];

// Pièces : facettes regroupées par position (coordonnée ±3 d'une face ramenée à ±2).
const PIECES = (() => {
  const map = new Map();
  cube.points.forEach((p, i) => {
    const key = p.map(v => Math.sign(v) * Math.min(Math.abs(v), 2)).join(',');
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(i);
  });
  return [...map.values()];
})();
const faceOf = i => Math.floor(i / 9);
const opposite = f => (f + 3) % 6; // U-D, R-L, F-B
const solvedPiece = (s, piece) => piece.every(i => s[i] === s[faceOf(i) * 9 + 4]);

// Croix de la face x : les 4 arêtes qui ont une facette sur x sont en place.
const CROSS = [0, 1, 2, 3, 4, 5].map(x => PIECES.filter(p => p.length === 2 && p.some(i => faceOf(i) === x)));
// F2L (croix sur x) : toutes les pièces sans facette sur la face opposée sont en place.
const F2L = [0, 1, 2, 3, 4, 5].map(x => PIECES.filter(p => p.length > 1 && !p.some(i => faceOf(i) === opposite(x))));

const crossDone = (s, x) => CROSS[x].every(p => solvedPiece(s, p));
const f2lDone = (s, x) => F2L[x].every(p => solvedPiece(s, p));
const ollDone = (s, x) => { const y = opposite(x); for (let k = 0; k < 9; k++) if (s[y * 9 + k] !== s[y * 9 + 4]) return false; return true; };

// scramble : texte du mélange ; mv : [[mouvement, ms depuis le départ], …] ; total : temps du solve (ms).
// Renvoie { face, times: {cross, f2l, oll, pll}, moves: {…} } (durées de chaque étape), ou null.
export function cfopSplits(scramble, mv, total) {
  if (!mv?.length) return null;
  const states = [cube.applyAlg(cube.solved(), scramble)];
  for (const [m] of mv) states.push(cube.apply(states.at(-1), parseAlg(m)));
  if (!cube.isSolved(states.at(-1))) return null;
  // Face de la croix : celle dont la F2L est terminée le plus tôt.
  let face = -1, f2lAt = Infinity;
  for (let x = 0; x < 6; x++) {
    const at = states.findIndex(s => f2lDone(s, x));
    if (at >= 0 && at < f2lAt) { f2lAt = at; face = x; }
  }
  if (face < 0) return null;
  const crossAt = states.findIndex((s, i) => i <= f2lAt && crossDone(s, face));
  const ollAt = states.findIndex((s, i) => i >= f2lAt && ollDone(s, face));
  const at = [crossAt, f2lAt, ollAt, states.length - 1];
  const timeAt = i => (i <= 0 ? 0 : mv[i - 1][1]);
  const ends = at.map(timeAt);
  ends[3] = Math.max(total ?? ends[3], ends[2]); // la PLL finit avec le chrono
  const times = {}, moves = {};
  PHASES.forEach((ph, k) => {
    times[ph.id] = ends[k] - (k ? ends[k - 1] : 0);
    moves[ph.id] = at[k] - (k ? at[k - 1] : 0);
  });
  return { face, times, moves };
}

// Découpage d'un solve enregistré (mémorisé : on ne rejoue chaque solve qu'une fois).
const memo = new WeakMap();
export function splitsOf(solve) {
  if (!solve?.mv?.length || solve.p === 'DNF') return null;
  if (!memo.has(solve)) memo.set(solve, cfopSplits(solve.s, solve.mv, solve.t));
  return memo.get(solve);
}
