// Modèle « cubies » du 3x3 (conventions Kociemba) : permutation/orientation des coins et arêtes.
// Coins : URF UFL ULB UBR DFR DLF DBL DRB. Arêtes : UR UF UL UB DR DF DL DB FR FL BL BR.
import { NxNCube } from './nxn.js';

const U = 0, R = 1, F = 2, D = 3, L = 4, B = 5;

export const CORNER_FACELET = [
  [8, 9, 20], [6, 18, 38], [0, 36, 47], [2, 45, 11],
  [29, 26, 15], [27, 44, 24], [33, 53, 42], [35, 17, 51],
];
export const CORNER_COLOR = [
  [U, R, F], [U, F, L], [U, L, B], [U, B, R],
  [D, F, R], [D, L, F], [D, B, L], [D, R, B],
];
export const EDGE_FACELET = [
  [5, 10], [7, 19], [3, 37], [1, 46], [32, 16], [28, 25],
  [30, 43], [34, 52], [23, 12], [21, 41], [50, 39], [48, 14],
];
export const EDGE_COLOR = [
  [U, R], [U, F], [U, L], [U, B], [D, R], [D, F],
  [D, L], [D, B], [F, R], [F, L], [B, L], [B, R],
];

export function binom(n, k) {
  if (k < 0 || k > n) return 0;
  let r = 1;
  for (let i = 0; i < k; i++) r = (r * (n - i)) / (i + 1);
  return r;
}

export function permToIndex(arr, offset = 0) {
  const n = arr.length;
  let idx = 0;
  for (let i = 0; i < n; i++) {
    let smaller = 0;
    for (let j = i + 1; j < n; j++) if (arr[j] < arr[i]) smaller++;
    idx = idx * (n - i) + smaller;
  }
  return idx;
}

export function indexToPerm(idx, n, offset = 0) {
  const digits = new Array(n);
  for (let i = n - 1; i >= 0; i--) {
    digits[i] = idx % (n - i);
    idx = Math.floor(idx / (n - i));
  }
  const avail = Array.from({ length: n }, (_, i) => i + offset);
  return digits.map(d => avail.splice(d, 1)[0]);
}

const parity = p => {
  let s = 0;
  for (let i = 0; i < p.length; i++) for (let j = i + 1; j < p.length; j++) if (p[j] < p[i]) s ^= 1;
  return s;
};

export class CubieCube {
  constructor(cp, co, ep, eo) {
    this.cp = cp ? cp.slice() : [0, 1, 2, 3, 4, 5, 6, 7];
    this.co = co ? co.slice() : new Array(8).fill(0);
    this.ep = ep ? ep.slice() : [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
    this.eo = eo ? eo.slice() : new Array(12).fill(0);
  }

  clone() {
    return new CubieCube(this.cp, this.co, this.ep, this.eo);
  }

  // this * b : applique b après this.
  multiply(b) {
    const r = new CubieCube();
    for (let i = 0; i < 8; i++) {
      r.cp[i] = this.cp[b.cp[i]];
      r.co[i] = (this.co[b.cp[i]] + b.co[i]) % 3;
    }
    for (let i = 0; i < 12; i++) {
      r.ep[i] = this.ep[b.ep[i]];
      r.eo[i] = (this.eo[b.ep[i]] + b.eo[i]) % 2;
    }
    return r;
  }

  equals(o) {
    const same = (a, b) => a.every((v, i) => v === b[i]);
    return same(this.cp, o.cp) && same(this.co, o.co) && same(this.ep, o.ep) && same(this.eo, o.eo);
  }

  // Facettes (valeurs 0..5 = couleur de la face U R F D L B), centres en place.
  static fromFacelets(f) {
    const c = new CubieCube();
    for (let i = 0; i < 8; i++) {
      let ori = 0;
      while (ori < 3 && f[CORNER_FACELET[i][ori]] !== U && f[CORNER_FACELET[i][ori]] !== D) ori++;
      if (ori === 3) throw new Error('Coin invalide');
      const c1 = f[CORNER_FACELET[i][(ori + 1) % 3]];
      const c2 = f[CORNER_FACELET[i][(ori + 2) % 3]];
      const j = CORNER_COLOR.findIndex(col => col[1] === c1 && col[2] === c2);
      if (j < 0) throw new Error('Coin invalide');
      c.cp[i] = j;
      c.co[i] = ori;
    }
    for (let i = 0; i < 12; i++) {
      const a = f[EDGE_FACELET[i][0]], b = f[EDGE_FACELET[i][1]];
      const j = EDGE_COLOR.findIndex(col => (col[0] === a && col[1] === b) || (col[0] === b && col[1] === a));
      if (j < 0) throw new Error('Arête invalide');
      c.ep[i] = j;
      c.eo[i] = EDGE_COLOR[j][0] === a ? 0 : 1;
    }
    return c;
  }

  toFacelets() {
    const f = new Uint8Array(54);
    for (let face = 0; face < 6; face++) f[face * 9 + 4] = face;
    for (let i = 0; i < 8; i++) {
      for (let n = 0; n < 3; n++) f[CORNER_FACELET[i][(n + this.co[i]) % 3]] = CORNER_COLOR[this.cp[i]][n];
    }
    for (let i = 0; i < 12; i++) {
      for (let n = 0; n < 2; n++) f[EDGE_FACELET[i][(n + this.eo[i]) % 2]] = EDGE_COLOR[this.ep[i]][n];
    }
    return f;
  }

  // Vérifie qu'un état est atteignable (permutations, parité, orientations).
  validate() {
    if (new Set(this.cp).size !== 8 || new Set(this.ep).size !== 12) return 'Pièce en double ou manquante';
    if (this.co.reduce((a, b) => a + b, 0) % 3) return 'Un coin est vrillé';
    if (this.eo.reduce((a, b) => a + b, 0) % 2) return 'Une arête est retournée';
    if (parity(this.cp) !== parity(this.ep)) return 'Parité impossible (deux pièces échangées)';
    return null;
  }

  // --- Coordonnées ---
  getTwist() { let r = 0; for (let i = 0; i < 7; i++) r = r * 3 + this.co[i]; return r; }
  setTwist(t) {
    let s = 0;
    for (let i = 6; i >= 0; i--) { this.co[i] = t % 3; s += this.co[i]; t = Math.floor(t / 3); }
    this.co[7] = (3 - (s % 3)) % 3;
  }
  getFlip() { let r = 0; for (let i = 0; i < 11; i++) r = r * 2 + this.eo[i]; return r; }
  setFlip(v) {
    let s = 0;
    for (let i = 10; i >= 0; i--) { this.eo[i] = v % 2; s += this.eo[i]; v = Math.floor(v / 2); }
    this.eo[11] = s % 2;
  }
  // Position des 4 arêtes du slice E (FR FL BL BR), 0..494 ; 0 = en place.
  getSlice() {
    let a = 0, x = 0;
    for (let j = 11; j >= 0; j--) {
      if (this.ep[j] >= 8) { a += binom(11 - j, x + 1); x++; }
    }
    return a;
  }
  setSlice(idx) {
    const slice = [8, 9, 10, 11], other = [0, 1, 2, 3, 4, 5, 6, 7];
    this.ep.fill(-1);
    let a = idx, x = 4;
    for (let j = 0; j < 12; j++) {
      if (x > 0 && a - binom(11 - j, x) >= 0) {
        this.ep[j] = slice[4 - x];
        a -= binom(11 - j, x);
        x--;
      }
    }
    let k = 0;
    for (let j = 0; j < 12; j++) if (this.ep[j] === -1) this.ep[j] = other[k++];
  }
  getCornerPerm() { return permToIndex(this.cp); }
  setCornerPerm(i) { this.cp = indexToPerm(i, 8); }
  getEdge8() { return permToIndex(this.ep.slice(0, 8)); }
  setEdge8(i) { const p = indexToPerm(i, 8); for (let k = 0; k < 8; k++) this.ep[k] = p[k]; }
  getSlicePerm() { return permToIndex(this.ep.slice(8, 12)); }
  setSlicePerm(i) { const p = indexToPerm(i, 4, 8); for (let k = 0; k < 4; k++) this.ep[8 + k] = p[k]; }
}

// Les 18 mouvements (U U2 U' R R2 R' F ... B'), dérivés du moteur à facettes.
export const MOVE_NAMES = [];
export const MOVE_CUBES = [];
{
  const engine = new NxNCube(3);
  for (const face of ['U', 'R', 'F', 'D', 'L', 'B']) {
    for (const amount of [1, 2, 3]) {
      MOVE_NAMES.push(face + (amount === 2 ? '2' : amount === 3 ? "'" : ''));
      const f = engine.apply(engine.solved(), [{ face, wide: 1, slice: 0, lower: false, amount }]);
      MOVE_CUBES.push(CubieCube.fromFacelets(f));
    }
  }
}

function randInt(max) {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0] % max;
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = randInt(i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// État aléatoire uniforme parmi les 43 252 003 274 489 856 000 positions.
export function randomCubie() {
  const c = new CubieCube();
  c.cp = shuffle([0, 1, 2, 3, 4, 5, 6, 7]);
  c.ep = shuffle([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  if (parity(c.cp) !== parity(c.ep)) [c.ep[10], c.ep[11]] = [c.ep[11], c.ep[10]];
  c.setTwist(randInt(2187));
  c.setFlip(randInt(2048));
  return c;
}
