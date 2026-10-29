// Worker du solveur : mélanges random-state et résolution d'états.
import { initTables, solve, movesToString, invertMoveIds } from '../solver/twophase.js';
import { CubieCube, randomCubie } from '../core/cubie.js';

self.onmessage = e => {
  const { id, type, payload } = e.data;
  try {
    let result;
    if (type === 'init') {
      const t0 = performance.now();
      initTables();
      result = Math.round(performance.now() - t0);
    } else if (type === 'scramble') {
      let moves;
      do moves = solve(randomCubie()); while (moves.length < 2);
      result = movesToString(invertMoveIds(moves));
    } else if (type === 'solve') {
      result = movesToString(solve(CubieCube.fromFacelets(payload.facelets)));
    } else {
      throw new Error(`Requête inconnue : ${type}`);
    }
    self.postMessage({ id, result });
  } catch (err) {
    self.postMessage({ id, error: err.message });
  }
};
