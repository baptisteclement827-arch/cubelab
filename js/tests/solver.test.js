// Tests du modèle cubies, du solveur deux phases et du générateur.
import { NxNCube } from '../core/nxn.js';
import { parseAlg } from '../core/notation.js';
import { CubieCube, MOVE_CUBES, randomCubie, permToIndex, indexToPerm } from '../core/cubie.js';
import { initTables, solve, movesToString, invertMoveIds } from '../solver/twophase.js';
import { generate } from '../solver/generator.js';
import { randomMoveScramble } from '../core/scramble.js';

const results = [];
const test = (name, fn) => {
  const t0 = performance.now();
  try { fn(); results.push({ name, ok: true, ms: Math.round(performance.now() - t0) }); }
  catch (e) { results.push({ name, ok: false, msg: e.message }); }
};
const eq = (a, b, msg = '') => { if (a !== b) throw new Error(`${msg} attendu ${JSON.stringify(b)}, obtenu ${JSON.stringify(a)}`); };
const ok = (v, msg) => { if (!v) throw new Error(msg); };

const c3 = new NxNCube(3);
const S = c3.solved();
const str = s => c3.toFaceletString(s);

test('Cubies : aller-retour facettes', () => {
  for (let k = 0; k < 50; k++) {
    const f = c3.applyAlg(S, randomMoveScramble({ length: 25 }));
    eq(str(CubieCube.fromFacelets(f).toFacelets()), str(f));
  }
});
test('Cubies : produit des mouvements = moteur à facettes', () => {
  const alg = randomMoveScramble({ length: 30 });
  let c = new CubieCube();
  const names = ['U', 'U2', "U'", 'R', 'R2', "R'", 'F', 'F2', "F'", 'D', 'D2', "D'", 'L', 'L2', "L'", 'B', 'B2', "B'"];
  for (const m of alg.split(' ')) c = c.multiply(MOVE_CUBES[names.indexOf(m)]);
  eq(str(c.toFacelets()), str(c3.applyAlg(S, alg)));
});
test('Coordonnées : aller-retour', () => {
  const c = new CubieCube();
  for (const i of [0, 1, 200, 494]) { c.setSlice(i); eq(c.getSlice(), i, 'slice'); }
  for (const i of [0, 5, 2186]) { c.setTwist(i); eq(c.getTwist(), i, 'twist'); }
  for (const i of [0, 7, 2047]) { c.setFlip(i); eq(c.getFlip(), i, 'flip'); }
  for (const i of [0, 1, 12345, 40319]) eq(permToIndex(indexToPerm(i, 8)), i, 'perm');
  eq(new CubieCube().getSlice(), 0, 'slice résolu');
});
test('Validation : état impossible détecté', () => {
  const c = new CubieCube();
  c.co[0] = 1;
  ok(c.validate(), 'coin vrillé non détecté');
});

let initMs = 0;
test('Tables du solveur', () => { const t0 = performance.now(); initTables(); initMs = Math.round(performance.now() - t0); });

// ~99 % des solutions font ≤ 21 coups ; de rares états passent par le second passage (≤ 24).
test('Résolution de 30 états aléatoires (≤ 24 coups, vérifiés)', () => {
  let maxLen = 0, total = 0;
  const t0 = performance.now();
  for (let k = 0; k < 30; k++) {
    const c = randomCubie();
    const moves = solve(c);
    maxLen = Math.max(maxLen, moves.length);
    total += moves.length;
    const after = c3.applyAlg(c.toFacelets(), movesToString(moves));
    ok(c3.isSolved(after), `solution fausse : ${movesToString(moves)}`);
  }
  ok(maxLen <= 24, `trop long : ${maxLen}`);
  results.push({ name: `  → longueur moyenne ${(total / 30).toFixed(1)}, max ${maxLen}, ${Math.round((performance.now() - t0) / 30)} ms/état, tables ${initMs} ms`, ok: true });
});
test('Mélange random-state reproduit l\'état', () => {
  const c = randomCubie();
  const scr = movesToString(invertMoveIds(solve(c)));
  eq(str(c3.applyAlg(S, scr)), str(c.toFacelets()));
});
test('Superflip résolu', () => {
  const f = c3.applyAlg(S, "U R2 F B R B2 R U2 L B2 R U' D' R2 F R' L B2 U2 F2");
  const sol = movesToString(solve(CubieCube.fromFacelets(f)));
  ok(c3.isSolved(c3.applyAlg(f, sol)), 'non résolu');
});

const gen = (opts) => { const sols = []; const r = generate(opts, { onSolution: s => sols.push(s) }); return { sols, ...r }; };

test('Générateur : T-perm en <R,U,F> trouve la T-perm', () => {
  const t = "R U R' U' R' F R2 U' R' U' R U R' F'";
  const { sols } = gen({ alg: t, mode: 'alg', mask: 'full', bases: ['R', 'U', 'F'], maxLen: 14, preAuf: false, postAuf: false });
  ok(sols.length > 0, 'aucune solution');
  ok(sols.some(s => s.alg === t), `T-perm absente : ${sols.slice(0, 5).map(s => s.alg).join(' | ')}`);
  for (const s of sols) ok(s.stm <= 14, 'trop long');
});
test('Générateur : chaque solution résout vraiment le cas', () => {
  const setup = "R U R' U R U2 R'"; // cas d'antisune
  const { sols } = gen({ alg: setup, mode: 'alg', mask: 'oll', bases: ['R', 'U', 'F'], maxLen: 9, preAuf: true, postAuf: true });
  ok(sols.length > 0, 'aucune solution');
  for (const s of sols) {
    const alg = s.alg.replace(/[()]/g, '');
    const after = c3.applyAlg(c3.applyAlg(S, "R U2 R' U' R U' R'"), alg);
    // OLL : la face U doit être unie et les deux premières couches résolues.
    for (let i = 0; i < 9; i++) eq(after[i], 0, `U non orientée par ${s.alg}`);
    for (const f of [1, 2, 4, 5]) for (let i = 3; i < 9; i++) eq(after[f * 9 + i], f, `F2L cassé par ${s.alg}`);
  }
  results.push({ name: `  → ${sols.length} solutions OLL, la plus courte : ${sols[0].alg}`, ok: true });
});
test('Générateur : toutes les T-perms avec AUF résolvent le cube', () => {
  const t = "R U R' U' R' F R2 U' R' U' R U R' F'";
  const { sols } = gen({ alg: t, mode: 'alg', mask: 'full', bases: ['R', 'U', 'F'], maxLen: 14, preAuf: true, postAuf: true });
  const caseS = c3.applyAlg(S, "F R U' R' U R U R2 F' R U R U' R'");
  ok(sols.length >= 10, `seulement ${sols.length} solutions`);
  for (const s of sols) ok(c3.isSolved(c3.applyAlg(caseS, s.alg)), `ne résout pas : ${s.alg}`);
});
test('Générateur : Sexy move F2L en <R,U>', () => {
  const { sols } = gen({ alg: "R U R' U'", mode: 'setup', mask: 'f2l', bases: ['R', 'U'], maxLen: 4, preAuf: false, postAuf: false });
  ok(sols.some(s => s.alg === "U R U' R'"), `attendu U R U' R' : ${sols.map(s => s.alg).join(' | ')}`);
});
test('Générateur : M et r acceptés (H-perm en <M,U>)', () => {
  const { sols } = gen({ alg: "M2 U M2 U2 M2 U M2", mode: 'alg', mask: 'full', bases: ['M', 'U'], maxLen: 7, preAuf: false, postAuf: false });
  ok(sols.length > 0, 'aucune solution');
});

export default results;
