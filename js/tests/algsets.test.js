// Tests de la bibliothèque d'algos : chaque algo résout bien son cas, et les cas couvrent tout l'ensemble.
import { NxNCube } from '../core/nxn.js';
import { parseAlg } from '../core/notation.js';
import { ALG_SETS, caseState, solvesCase } from '../algsets/index.js';

const results = [];
const test = (name, fn) => {
  try { fn(); results.push({ name, ok: true }); }
  catch (e) { results.push({ name, ok: false, msg: e.message }); }
};
const ok = (v, msg) => { if (!v) throw new Error(msg); };

const c3 = new NxNCube(3);
const U = parseAlg('U');
const TOP = [0, 1, 2, 3, 4, 5, 6, 7, 8];
const SIDES = [9, 18, 36, 45].flatMap(f => [f, f + 1, f + 2]);
const EDGES = [1, 3, 5, 7];
const CORNERS = [0, 2, 6, 8];

// F2L résolue : face D et les deux rangées du bas des faces latérales à la couleur de leur centre.
const f2lSolved = s => {
  for (let i = 27; i < 36; i++) if (s[i] !== 3) return false;
  for (const f of [1, 2, 4, 5]) for (let i = 3; i < 9; i++) if (s[f * 9 + i] !== f) return false;
  return true;
};
// Motif d'orientation (facettes de la couleur du haut), indépendant de l'AUF.
const pattern = s => {
  const keys = [];
  for (let k = 0; k < 4; k++) {
    keys.push([...TOP, ...SIDES].map(i => (s[i] === 0 ? 1 : 0)).join(''));
    s = c3.apply(s, U);
  }
  return keys.sort()[0];
};
const count = (s, idx) => idx.filter(i => s[i] === 0).length;

const oll = ALG_SETS['333/oll'];
const states = oll.CASES.map(c => caseState(c.alg));

test('OLL : 57 cas, chacun dans un sous-ensemble connu', () => {
  ok(oll.CASES.length === 57, `${oll.CASES.length} cas`);
  const ids = new Set(oll.SUBSETS.map(s => s.id));
  for (const c of oll.CASES) ok(ids.has(c.subset), `${c.name} : sous-ensemble ${c.subset} inconnu`);
});
test('OLL : chaque algo garde la F2L', () => {
  oll.CASES.forEach((c, i) => ok(f2lSolved(states[i]), `${c.name} casse la F2L`));
});
test('OLL : chaque algo oriente la dernière couche', () => {
  oll.CASES.forEach((c, i) => {
    const after = c3.apply(states[i], parseAlg(c.alg));
    ok(TOP.every(j => after[j] === after[4]), `${c.name} n'oriente pas la dernière couche`);
  });
});
test('OLL : 57 motifs distincts (tous les cas couverts)', () => {
  const seen = new Map();
  oll.CASES.forEach((c, i) => {
    const p = pattern(states[i]);
    ok(!seen.has(p), `${c.name} et ${seen.get(p)} sont le même cas`);
    ok(count(states[i], TOP) < 9, `${c.name} est déjà orienté`);
    seen.set(p, c.name);
  });
});
test('OLL : arêtes et coins cohérents avec le sous-ensemble', () => {
  oll.CASES.forEach((c, i) => {
    const e = count(states[i], EDGES), k = count(states[i], CORNERS);
    const want = c.subset === 'dot' ? 0 : c.subset === 'ocll' ? 4 : 2;
    ok(e === want, `${c.name} : ${e} arêtes orientées, ${want} attendues`);
    if (c.subset === 'co') ok(k === 4, `${c.name} : coins non orientés`);
    if (c.subset === 'ocll') ok(k < 4, `${c.name} : coins déjà orientés`);
  });
});

test('OLL : vérification de l\'algo de l\'utilisateur', () => {
  const sune = oll.CASES.find(c => c.id === 'oll27');
  ok(solvesCase(oll, sune, "R U R' U R U2 R'") === '', 'Sune doit résoudre OLL 27');
  ok(solvesCase(oll, sune, "U R U R' U R U2 R'") !== null, 'Sune sous un autre angle doit être accepté');
  ok(solvesCase(oll, sune, "y R U R' U R U2 R'") !== null, 'Sune avec rotation y doit être accepté');
  const antisune = oll.CASES.find(c => c.id === 'oll26');
  ok(solvesCase(oll, antisune, "L' U' L U' L' U2 L") !== null, 'Sune gaucher (miroir) doit résoudre OLL 26');
  ok(solvesCase(oll, sune, "R U2 R' U' R U' R'") === null, 'Antisune ne résout pas OLL 27');
  let threw = false;
  try { solvesCase(oll, sune, 'R U ('); } catch { threw = true; }
  ok(threw, 'Une erreur de syntaxe doit être signalée');
});

export default results;
