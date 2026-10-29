// Solveur de Kociemba en deux phases.
// Phase 1 : amener le cube dans le sous-groupe <U, D, R2, L2, F2, B2> (orientations + slice E).
// Phase 2 : le résoudre avec ces seuls mouvements.
import { CubieCube, MOVE_CUBES, MOVE_NAMES } from '../core/cubie.js';

const N_TWIST = 2187, N_FLIP = 2048, N_SLICE = 495, N_PERM8 = 40320, N_SPERM = 24;
const P2_MOVES = [0, 1, 2, 4, 7, 9, 10, 11, 13, 16]; // U U2 U' R2 F2 D D2 D' L2 B2
const N_P2 = P2_MOVES.length;
const IS_P2 = new Array(18).fill(false);
P2_MOVES.forEach(m => { IS_P2[m] = true; });

let T = null;

function moveTable(n, nMoves, set, get, moveIds) {
  const table = new Uint16Array(n * nMoves);
  const c = new CubieCube();
  for (let i = 0; i < n; i++) {
    set(c, i);
    for (let k = 0; k < nMoves; k++) table[i * nMoves + k] = get(c.multiply(MOVE_CUBES[moveIds[k]]));
  }
  return table;
}

// Table de distance (BFS) sur le produit de deux coordonnées.
function pruneTable(nA, nB, moveA, moveB, colsA, colsB, moveIdsA, nMoves) {
  const size = nA * nB;
  const t = new Int8Array(size).fill(-1);
  t[0] = 0;
  let filled = 1, depth = 0;
  while (filled < size) {
    let added = 0;
    for (let i = 0; i < size; i++) {
      if (t[i] !== depth) continue;
      const a = (i / nB) | 0, b = i % nB;
      for (let k = 0; k < nMoves; k++) {
        const j = moveA[a * colsA + moveIdsA[k]] * nB + moveB[b * colsB + k];
        if (t[j] === -1) { t[j] = depth + 1; added++; }
      }
    }
    if (!added) break;
    filled += added;
    depth++;
  }
  return t;
}

export function initTables() {
  if (T) return T;
  const all = Array.from({ length: 18 }, (_, i) => i);
  const twistMove = moveTable(N_TWIST, 18, (c, i) => c.setTwist(i), c => c.getTwist(), all);
  const flipMove = moveTable(N_FLIP, 18, (c, i) => c.setFlip(i), c => c.getFlip(), all);
  const sliceMove = moveTable(N_SLICE, 18, (c, i) => c.setSlice(i), c => c.getSlice(), all);
  const cornerMove = moveTable(N_PERM8, 18, (c, i) => c.setCornerPerm(i), c => c.getCornerPerm(), all);
  const edge8Move = moveTable(N_PERM8, N_P2, (c, i) => c.setEdge8(i), c => c.getEdge8(), P2_MOVES);
  const slicePermMove = moveTable(N_SPERM, N_P2, (c, i) => c.setSlicePerm(i), c => c.getSlicePerm(), P2_MOVES);

  T = {
    twistMove, flipMove, sliceMove, cornerMove, edge8Move, slicePermMove,
    // Phase 1 : index = slice * N + twist/flip
    sliceTwist: pruneTable(N_SLICE, N_TWIST, sliceMove, twistMove, 18, 18, all, 18),
    sliceFlip: pruneTable(N_SLICE, N_FLIP, sliceMove, flipMove, 18, 18, all, 18),
    // Phase 2 : index = perm8 * 24 + slicePerm
    cornerSlice: pruneTable(N_PERM8, N_SPERM, cornerMove, slicePermMove, 18, N_P2, P2_MOVES, N_P2),
    edgeSlice: pruneTable(N_PERM8, N_SPERM, edge8Move, slicePermMove, N_P2, N_P2, all.slice(0, N_P2), N_P2),
  };
  return T;
}

const face = m => (m / 3) | 0;
// Évite R R et les doublons commutatifs (L R est gardé, R L non : on impose U<D, R<L, F<B).
const redundant = (m, last) => last >= 0 && (face(m) === face(last) || face(m) === face(last) - 3);

/**
 * Résout un état (CubieCube). Renvoie un tableau d'index de mouvements (0..17).
 * maxLength : longueur visée (21 par défaut, toujours atteignable en pratique très vite).
 */
export function solve(cube, { maxLength = 21, timeLimit = 10000 } = {}) {
  const err = cube.validate();
  if (err) throw new Error(err);
  const t = initTables();
  const deadline = performance.now() + timeLimit;
  const path = [];
  let result = null;
  let nodes = 0;

  const phase2 = (cp, e8, sp, depth, last) => {
    if (depth === 0) return cp === 0 && e8 === 0 && sp === 0;
    if (Math.max(t.cornerSlice[cp * N_SPERM + sp], t.edgeSlice[e8 * N_SPERM + sp]) > depth) return false;
    for (let k = 0; k < N_P2; k++) {
      const m = P2_MOVES[k];
      if (redundant(m, last)) continue;
      path.push(m);
      if (phase2(t.cornerMove[cp * 18 + m], t.edge8Move[e8 * N_P2 + k], t.slicePermMove[sp * N_P2 + k], depth - 1, m)) return true;
      path.pop();
    }
    return false;
  };

  const startPhase2 = total => {
    let c = cube;
    for (const m of path) c = c.multiply(MOVE_CUBES[m]);
    const cp = c.getCornerPerm(), e8 = c.getEdge8(), sp = c.getSlicePerm();
    const h = Math.max(t.cornerSlice[cp * N_SPERM + sp], t.edgeSlice[e8 * N_SPERM + sp]);
    const len1 = path.length;
    const last = len1 ? path[len1 - 1] : -1;
    // Phase 2 limitée à 12 coups (sauf en dernier recours) : explorer d'autres fins de phase 1 est plus rentable.
    const maxD2 = Math.min(total - len1, total >= 31 ? 18 : 12);
    for (let d = h; d <= maxD2; d++) {
      if (phase2(cp, e8, sp, d, last)) return true;
    }
    return false;
  };

  const phase1 = (tw, fl, sl, depth, last, total) => {
    if (++nodes % 4096 === 0 && performance.now() > deadline) throw new Error('Temps de calcul dépassé');
    const h = Math.max(t.sliceTwist[sl * N_TWIST + tw], t.sliceFlip[sl * N_FLIP + fl]);
    if (h > depth) return false;
    if (depth === 0) {
      // Une fin de phase 1 par un mouvement de phase 2 a déjà été trouvée plus court.
      if (last >= 0 && IS_P2[last]) return false;
      return startPhase2(total);
    }
    for (let m = 0; m < 18; m++) {
      if (redundant(m, last)) continue;
      path.push(m);
      if (phase1(t.twistMove[tw * 18 + m], t.flipMove[fl * 18 + m], t.sliceMove[sl * 18 + m], depth - 1, m, total)) return true;
      path.pop();
    }
    return false;
  };

  const tw = cube.getTwist(), fl = cube.getFlip(), sl = cube.getSlice();
  for (const total of [maxLength, maxLength + 3, 31]) {
    for (let d1 = 0; d1 <= Math.min(12, total); d1++) {
      path.length = 0;
      if (phase1(tw, fl, sl, d1, -1, total)) { result = path.slice(); break; }
    }
    if (result) break;
  }
  if (!result) throw new Error('Aucune solution trouvée');
  return result;
}

export const movesToString = moves => moves.map(m => MOVE_NAMES[m]).join(' ');
export const invertMoveIds = moves => moves.slice().reverse().map(m => m - (m % 3) + (2 - (m % 3)));

export function solveFacelets(facelets, opts) {
  return movesToString(solve(CubieCube.fromFacelets(facelets), opts));
}
