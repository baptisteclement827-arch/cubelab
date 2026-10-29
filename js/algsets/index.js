// Bibliothèque d'algos : ensembles par puzzle (clé « puzzle/ensemble ») et calcul de l'état de chaque cas.
import { NxNCube } from '../core/nxn.js';
import { parseAlg, invertMoves } from '../core/notation.js';
import { normalizeOrientation } from '../core/orientation.js';
import * as OLL from './333-oll.js?v=5';

export const ALG_SETS = {
  '333/oll': { ...OLL, view: 'oll' },
};

const cube3 = new NxNCube(3);

// État du cube quand le cas se présente : l'inverse de l'algo appliqué au cube résolu, centres remis en place.
export function caseState(alg) {
  return normalizeOrientation(cube3, cube3.apply(cube3.solved(), invertMoves(parseAlg(alg)))).state;
}

const isOriented = s => s.slice(0, 9).every(c => c === s[4]);
const f2lSolved = s => {
  for (let i = 27; i < 36; i++) if (s[i] !== 3) return false;
  for (const f of [1, 2, 4, 5]) for (let i = 3; i < 9; i++) if (s[f * 9 + i] !== f) return false;
  return true;
};
const SOLVED_BY_VIEW = { oll: s => f2lSolved(s) && isOriented(s) };

const AUFS = ['', 'U', 'U2', "U'"];

// Vérifie qu'un algo (celui de l'utilisateur) résout le cas, sous n'importe quel angle de départ.
// Lève une erreur de syntaxe ; renvoie l'AUF à faire avant ('' si aucun), ou null si l'algo ne résout pas le cas.
export function solvesCase(set, c, alg) {
  const moves = parseAlg(alg);
  if (!moves.length) return null;
  const start = caseState(c.alg);
  for (const auf of AUFS) {
    const after = cube3.apply(start, [...parseAlg(auf), ...moves]);
    if (SOLVED_BY_VIEW[set.view](normalizeOrientation(cube3, after).state)) return auf;
  }
  return null;
}
