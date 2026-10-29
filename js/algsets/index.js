// Bibliothèque d'algos : ensembles par puzzle (clé « puzzle/ensemble ») et calcul de l'état de chaque cas.
import { NxNCube } from '../core/nxn.js';
import { parseAlg, invertMoves } from '../core/notation.js';
import { normalizeOrientation } from '../core/orientation.js';
import * as OLL from './333-oll.js';

export const ALG_SETS = {
  '333/oll': { ...OLL, view: 'oll' },
};

const cube3 = new NxNCube(3);

// État du cube quand le cas se présente : l'inverse de l'algo appliqué au cube résolu, centres remis en place.
export function caseState(alg) {
  return normalizeOrientation(cube3, cube3.apply(cube3.solved(), invertMoves(parseAlg(alg)))).state;
}
