// Générateur d'algos : trouve TOUTES les séquences jusqu'à une longueur donnée qui résolvent un cas,
// avec un jeu de mouvements restreint (<R,U,F>...), un masque (cube entier, OLL, F2L) et l'AUF.
// Méthode : IDA* + table de distances exactes construite depuis l'état résolu (BFS bornée en mémoire).
import { NxNCube } from '../core/nxn.js';
import { parseAlg, invertMoves, formatMove, metrics } from '../core/notation.js';
import { normalizeOrientation } from '../core/orientation.js';

export const GRAY = 6;
const cube = new NxNCube(3);
const SIZE = 54;

// Facettes de la dernière couche (U) hors centre.
const LL_TOP = [0, 1, 2, 3, 5, 6, 7, 8];
const LL_SIDES = [1, 2, 4, 5].flatMap(f => [f * 9, f * 9 + 1, f * 9 + 2]);

export const MASKS = {
  full: { label: 'Cube entier (PLL, ZBLL, 1LLL…)', gray: [] },
  oll: { label: 'Orientation dernière couche (OLL)', gray: LL_SIDES },
  f2l: { label: 'Deux premières couches (F2L)', gray: [...LL_TOP, ...LL_SIDES] },
};

export const MOVE_BASES = ['U', 'D', 'R', 'L', 'F', 'B', 'r', 'M'];
const AXIS = { U: 1, D: 1, R: 0, L: 0, r: 0, M: 0, F: 2, B: 2 };
const ORDER = Object.fromEntries(MOVE_BASES.map((b, i) => [b, i]));
// Estimation grossière de l'ergonomie (plus bas = plus agréable).
const COST = { R: 1, U: 1, r: 1.1, M: 1.3, D: 1.4, F: 1.5, L: 1.6, B: 2.2 };

export function maskedSolved(maskId) {
  const s = cube.solved();
  for (const i of MASKS[maskId].gray) s[i] = GRAY;
  return s;
}

// État (masqué) du cas à résoudre.
export function caseState({ alg, mode, mask }) {
  const moves = parseAlg(alg);
  if (!moves.length) throw new Error('Entre un algo ou un setup');
  const s = cube.apply(maskedSolved(mask), mode === 'alg' ? invertMoves(moves) : moves);
  return normalizeOrientation(cube, s).state;
}

function scoreOf(moves) {
  return moves.reduce((acc, m) => acc + COST[m.base] + (m.amount === 2 ? 0.3 : 0), 0);
}

class StateTable {
  constructor(capacity) {
    let cap = 1;
    while (cap < capacity * 2) cap <<= 1;
    this.mask = cap - 1;
    this.k1 = new Int32Array(cap);
    this.k2 = new Int32Array(cap);
    this.d = new Uint8Array(cap).fill(255);
    this.count = 0;
  }
  static hash(s) {
    let h1 = 0x811c9dc5 | 0, h2 = 0x27d4eb2f | 0;
    for (let i = 0; i < SIZE; i++) {
      h1 = Math.imul(h1 ^ s[i], 16777619);
      h2 = Math.imul(h2 ^ (s[i] + 0x9e37), 0x5bd1e995);
      h2 ^= h2 >>> 13;
    }
    return [h1, h2];
  }
  get(s) {
    const [h1, h2] = StateTable.hash(s);
    for (let i = h1 & this.mask; ; i = (i + 1) & this.mask) {
      if (this.d[i] === 255) return -1;
      if (this.k1[i] === h1 && this.k2[i] === h2) return this.d[i];
    }
  }
  add(s, dist) {
    const [h1, h2] = StateTable.hash(s);
    for (let i = h1 & this.mask; ; i = (i + 1) & this.mask) {
      if (this.d[i] === 255) {
        this.k1[i] = h1; this.k2[i] = h2; this.d[i] = dist; this.count++;
        return true;
      }
      if (this.k1[i] === h1 && this.k2[i] === h2) return false;
    }
  }
}

function buildMoves(bases) {
  const moves = [];
  for (const base of bases) {
    for (const amount of [1, 2, 3]) {
      const m = base === 'r'
        ? { face: 'R', wide: 2, slice: 0, lower: true, amount }
        : { face: base, wide: 1, slice: 0, lower: false, amount };
      moves.push({ ...m, base, axis: AXIS[base], order: ORDER[base], perm: cube.perm(m), name: formatMove(m) });
    }
  }
  return moves;
}

function applyPerm(src, dst, perm) {
  for (let i = 0; i < SIZE; i++) dst[perm[i]] = src[i];
}

const tableCache = new Map();

// Distances exactes depuis les états « résolus » (avec AUF final éventuel), jusqu'à épuisement du budget.
// Les frontières sont stockées « à plat » (n états × 54 octets) pour limiter la mémoire.
function buildTable(goals, moves, budget) {
  const table = new StateTable(budget);
  let frontier = new Uint8Array(goals.length * SIZE);
  let count = 0;
  for (const g of goals) if (table.add(g, 0)) frontier.set(g, SIZE * count++);
  let depth = 0;
  const cur = new Uint8Array(SIZE), buf = new Uint8Array(SIZE);
  while (count) {
    let next = new Uint8Array(Math.min(count * moves.length, 4096) * SIZE);
    let nextCount = 0;
    let full = false;
    for (let k = 0; k < count && !full; k++) {
      cur.set(frontier.subarray(k * SIZE, (k + 1) * SIZE));
      for (const m of moves) {
        applyPerm(cur, buf, m.perm);
        if (!table.add(buf, depth + 1)) continue;
        if ((nextCount + 1) * SIZE > next.length) {
          const grown = new Uint8Array(next.length * 2);
          grown.set(next);
          next = grown;
        }
        next.set(buf, SIZE * nextCount++);
        if (table.count >= budget) { full = true; break; }
      }
    }
    // Niveau incomplet : seules les distances <= depth sont garanties, les autres sont > depth.
    if (full) return { table, depth };
    frontier = next;
    count = nextCount;
    depth++;
  }
  return { table, depth: 99 }; // espace entièrement exploré
}

const U_TURNS = [null, 'U', 'U2', "U'"];
const POST_AUF = [null, "U'", 'U2', 'U'];

/**
 * opts : { alg, mode: 'alg'|'setup', mask, bases: ['R','U',...], maxLen, preAuf, postAuf, maxResults }
 * cb : { onProgress({length, nodes}), onSolution(sol) } — sol = { alg, moves, stm, htm, score }
 */
export function generate(opts, cb = {}) {
  const { mask = 'full', bases = ['R', 'U', 'F'], maxLen = 14, preAuf = true, postAuf = true, maxResults = 500, budget = 1_200_000 } = opts;
  const start = caseState(opts);
  const moves = buildMoves(bases);
  const solvedM = maskedSolved(mask);
  const uMoves = U_TURNS.map(t => (t ? parseAlg(t) : []));

  const goals = (postAuf ? uMoves : [[]]).map(m => cube.apply(solvedM, m));
  const key = `${mask}|${bases.join('')}|${postAuf}`;
  let entry = tableCache.get(key);
  if (!entry) {
    entry = buildTable(goals, moves, budget);
    tableCache.set(key, entry);
  }
  const { table, depth: tableDepth } = entry;
  const h = s => { const d = table.get(s); return d < 0 ? tableDepth + 1 : d; };
  const goalIndex = s => goals.findIndex(g => g.every((v, i) => v === s[i]));

  const starts = (preAuf ? uMoves : [[]]).map((m, i) => ({ state: cube.apply(start, m), prefix: preAuf ? U_TURNS[i] : null }));
  if (starts.some(s => h(s.state) === 0)) throw new Error('Ce cas est déjà résolu');

  const stack = Array.from({ length: maxLen + 1 }, () => new Uint8Array(SIZE));
  const path = [];
  const seen = new Set();
  let nodes = 0, found = 0, stopped = false;

  const record = (prefix, final) => {
    const seq = path.map(i => moves[i]);
    const gi = goalIndex(final);
    const body = seq.map(m => m.name).join(' ');
    // L'état final vaut « résolu + U_TURNS[gi] » : il faut donc finir par l'inverse.
    const alg = [prefix ? `(${prefix})` : '', body, gi > 0 ? `(${POST_AUF[gi]})` : ''].filter(Boolean).join(' ');
    if (seen.has(alg)) return;
    seen.add(alg);
    found++;
    const m = metrics(seq);
    cb.onSolution?.({ alg, stm: m.stm, htm: m.htm, score: Math.round(scoreOf(seq) * 10) / 10 });
    if (found >= maxResults) stopped = true;
  };

  const dfs = (g, L, prev, prefix) => {
    if (stopped) return;
    if ((++nodes & 0xffff) === 0) cb.onProgress?.({ length: L, nodes, found });
    const s = stack[g];
    const dist = h(s);
    if (g + dist > L) return;
    if (g === L) { if (dist === 0) record(prefix, s); return; }
    if (g > 0 && dist === 0) return; // passe par l'état résolu : pas un vrai algo
    for (let i = 0; i < moves.length; i++) {
      const m = moves[i];
      // Un U en début/fin ferait doublon avec l'AUF.
      if (m.base === 'U' && ((g === 0 && preAuf) || (g === L - 1 && postAuf))) continue;
      if (prev) {
        if (m.base === prev.base) continue;
        if (m.axis === prev.axis && m.order < prev.order) continue; // mouvements qui commutent : ordre canonique
      }
      applyPerm(s, stack[g + 1], m.perm);
      path.push(i);
      dfs(g + 1, L, m, prefix);
      path.pop();
      if (stopped) return;
    }
  };

  const minLen = Math.max(1, Math.min(...starts.map(s => h(s.state))));
  for (let L = minLen; L <= maxLen && !stopped; L++) {
    cb.onProgress?.({ length: L, nodes, found });
    for (const st of starts) {
      stack[0].set(st.state);
      dfs(0, L, null, st.prefix);
      if (stopped) break;
    }
  }
  return { nodes, found, tableDepth, tableSize: table.count };
}
