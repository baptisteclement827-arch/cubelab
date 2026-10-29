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
