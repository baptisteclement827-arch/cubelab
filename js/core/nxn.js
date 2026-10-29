// Moteur générique NxN (modèle à facettes). Fonctionne pour N >= 2.
// Ordre des faces et des facettes compatible avec la notation Kociemba (U R F D L B).
import { parseAlg, formatMove } from './notation.js';

export const FACES = ['U', 'R', 'F', 'D', 'L', 'B'];

// face -> [axe (0=x, 1=y, 2=z), côté (+1/-1)]
const FACE_AXIS = { R: [0, 1], L: [0, -1], U: [1, 1], D: [1, -1], F: [2, 1], B: [2, -1] };

// Rotation de q quarts de tour (+90° main droite) autour d'un axe.
function rotate(p, axis, q) {
  let [x, y, z] = p;
  const turns = ((q % 4) + 4) % 4;
  for (let i = 0; i < turns; i++) {
    if (axis === 0) [y, z] = [-z, y];
    else if (axis === 1) [x, z] = [z, -x];
    else [x, y] = [-y, x];
  }
  return [x, y, z];
}

const gcd = (a, b) => (b ? gcd(b, a % b) : a);

export class NxNCube {
  constructor(n) {
    this.n = n;
    this.size = 6 * n * n;
    this.points = [];
    this.index = new Map();
    this.cache = new Map();
    const k = i => -(n - 1) + 2 * i;
    for (const face of FACES) {
      for (let r = 0; r < n; r++) {
        for (let c = 0; c < n; c++) {
          let p;
          switch (face) {
            case 'U': p = [k(c), n, k(r)]; break;
            case 'R': p = [n, -k(r), -k(c)]; break;
            case 'F': p = [k(c), -k(r), n]; break;
            case 'D': p = [k(c), -n, -k(r)]; break;
            case 'L': p = [-n, -k(r), k(c)]; break;
            case 'B': p = [-k(c), -k(r), -n]; break;
          }
          this.index.set(p.join(','), this.points.length);
          this.points.push(p);
        }
      }
    }
  }

  solved() {
    const s = new Uint8Array(this.size);
    const nn = this.n * this.n;
    for (let i = 0; i < this.size; i++) s[i] = Math.floor(i / nn);
    return s;
  }

  isSolved(state) {
    const nn = this.n * this.n;
    for (let f = 0; f < 6; f++) {
      const ref = state[f * nn];
      for (let i = 1; i < nn; i++) if (state[f * nn + i] !== ref) return false;
    }
    return true;
  }

  layerCoord(face, i) {
    const side = FACE_AXIS[face][1];
    return side * (this.n - 1 - 2 * (i - 1));
  }

  // Traduit un mouvement en {axe, sens, couches concernées}.
  spec(m) {
    const n = this.n;
    let face, from, to;
    switch (m.face) {
      case 'M': face = 'L'; from = 2; to = n - 1; break;
      case 'E': face = 'D'; from = 2; to = n - 1; break;
      case 'S': face = 'F'; from = 2; to = n - 1; break;
      case 'x': face = 'R'; from = 1; to = n; break;
      case 'y': face = 'U'; from = 1; to = n; break;
      case 'z': face = 'F'; from = 1; to = n; break;
      default:
        face = m.face;
        if (m.slice) from = to = m.slice;
        else { from = 1; to = m.wide; }
    }
    if (from < 1 || to > n || from > to) {
      throw new Error(`Le mouvement ${formatMove(m)} n'existe pas sur un ${n}x${n}`);
    }
    const [axis, side] = FACE_AXIS[face];
    const layers = new Set();
    for (let i = from; i <= to; i++) layers.add(this.layerCoord(face, i));
    return { axis, q: -side, layers };
  }

  // to[i] = position d'arrivée de la facette i.
  perm(m) {
    const key = formatMove(m);
    let to = this.cache.get(key);
    if (to) return to;
    const { axis, q, layers } = this.spec(m);
    const n = this.n;
    to = new Uint16Array(this.size);
    for (let i = 0; i < this.size; i++) {
      const p = this.points[i];
      const v = p[axis];
      const layer = Math.abs(v) === n ? Math.sign(v) * (n - 1) : v;
      to[i] = layers.has(layer) ? this.index.get(rotate(p, axis, q * m.amount).join(',')) : i;
    }
    this.cache.set(key, to);
    return to;
  }

  apply(state, moves) {
    let s = state;
    for (const m of moves) {
      const to = this.perm(m);
      const out = new s.constructor(this.size);
      for (let i = 0; i < this.size; i++) out[to[i]] = s[i];
      s = out;
    }
    return s;
  }

  applyAlg(state, alg) {
    return this.apply(state, parseAlg(alg));
  }

  // Ordre de la séquence : nombre de répétitions pour revenir à l'état de départ.
  order(moves) {
    const id = Uint16Array.from({ length: this.size }, (_, i) => i);
    const p = this.apply(id, moves);
    const seen = new Uint8Array(this.size);
    let result = 1;
    for (let i = 0; i < this.size; i++) {
      if (seen[i]) continue;
      let len = 0;
      for (let j = i; !seen[j]; j = p[j]) { seen[j] = 1; len++; }
      result = (result * len) / gcd(result, len);
    }
    return result;
  }

  toFaceletString(state) {
    return Array.from(state, c => FACES[c]).join('');
  }
}
