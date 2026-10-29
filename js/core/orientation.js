// Remet les centres d'un 3x3 en place (après un algo contenant x, y, M, r...) via une rotation du cube.
import { parseAlg } from './notation.js';

const CENTERS = [4, 13, 22, 31, 40, 49];

export const ROTATIONS = [];
for (const a of ['', 'y', 'y2', "y'"]) {
  for (const b of ['', 'x', 'x2', "x'", 'z', "z'"]) ROTATIONS.push(`${b} ${a}`.trim());
}

export function centersSolved(state) {
  return CENTERS.every((idx, f) => state[idx] === f);
}

// Renvoie { state, rotation } avec les centres en place.
export function normalizeOrientation(cube, state) {
  for (const rot of ROTATIONS) {
    const s = rot ? cube.apply(state, parseAlg(rot)) : state;
    if (centersSolved(s)) return { state: s, rotation: rot };
  }
  throw new Error('Centres incohérents');
}
