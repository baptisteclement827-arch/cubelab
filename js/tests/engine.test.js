// Tests du moteur : ouvrir tests.html via le serveur local.
import { NxNCube } from '../core/nxn.js';
import { parseAlg, formatAlg, invertMoves, mirrorMoves, simplify, metrics } from '../core/notation.js';
import { randomMoveScramble } from '../core/scramble.js';
import { average, trimFor, fmt, DNF } from '../stats.js';
import { ScrambleGuide } from '../scramble-guide.js';

const results = [];
const test = (name, fn) => {
  try { fn(); results.push({ name, ok: true }); }
  catch (e) { results.push({ name, ok: false, msg: e.message }); }
};
const eq = (a, b, msg = '') => { if (a !== b) throw new Error(`${msg} attendu ${JSON.stringify(b)}, obtenu ${JSON.stringify(a)}`); };
const ok = (v, msg) => { if (!v) throw new Error(msg); };

const c3 = new NxNCube(3);
const S = c3.solved();
const run = alg => c3.applyAlg(S, alg);
const same = (a, b) => c3.toFaceletString(run(a)) === c3.toFaceletString(run(b));

test('Facettes de R (format Kociemba)', () =>
  eq(c3.toFaceletString(run('R')), 'UUFUUFUUFRRRRRRRRRFFDFFDFFDDDBDDBDDBLLLLLLLLLUBBUBBUBB'));
test('Facettes de U', () =>
  eq(c3.toFaceletString(run('U')), ['UUUUUUUUU', 'BBBRRRRRR', 'RRRFFFFFF', 'DDDDDDDDD', 'FFFLLLLLL', 'LLLBBBBBB'].join('')));
test('Facettes de F', () =>
  eq(c3.toFaceletString(run('F')), 'UUUUUULLLURRURRURRFFFFFFFFFRRRDDDDDDLLDLLDLLDBBBBBBBBB'));

for (const f of ['U', 'R', 'F', 'D', 'L', 'B', 'M', 'E', 'S', 'x', 'y', 'z', 'Rw', 'r']) {
  test(`${f} x4 = identité`, () => ok(c3.isSolved(run(`${f} ${f} ${f} ${f}`)), 'pas résolu'));
}
test("Sexy move (R U R' U') d'ordre 6", () => eq(c3.order(parseAlg("R U R' U'")), 6));
test('Sune d\'ordre 6', () => eq(c3.order(parseAlg("R U R' U R U2 R'")), 6));
test('T-perm x2 = résolu, x1 non', () => {
  const t = "R U R' U' R' F R2 U' R' U' R U R' F'";
  ok(!c3.isSolved(run(t)), 'T-perm ne doit pas résoudre');
  ok(c3.isSolved(run(`${t} ${t}`)), 'T-perm x2 doit résoudre');
});
test('Alg + inverse = résolu', () => {
  const scr = randomMoveScramble({ length: 30 });
  const m = parseAlg(scr);
  ok(c3.isSolved(c3.apply(c3.apply(S, m), invertMoves(m))), 'pas résolu');
});
test('M suit le sens de L', () => ok(same("M", "L' R x'"), 'M != L\' R x\''));
test('r = R M\'', () => ok(same('r', "R M'"), 'r != R M\''));
test('x suit le sens de R', () => ok(same('x', "R M' L'"), 'x != R M\' L\''));
test('E suit le sens de D', () => ok(same('E', "U D' y'"), 'E != U D\' y\''));
test('S suit le sens de F', () => ok(same('S', "F' B z"), 'S != F\' B z'));
test('Superflip', () => {
  const s = run("U R2 F B R B2 R U2 L B2 R U' D' R2 F R' L B2 U2 F2");
  for (let f = 0; f < 6; f++) {
    for (const i of [0, 2, 4, 6, 8]) eq(s[f * 9 + i], f, `face ${f} facette ${i}`);
    for (const i of [1, 3, 5, 7]) ok(s[f * 9 + i] !== f, `arête face ${f} facette ${i} non retournée`);
  }
});
test('Commutateur [R, U]', () => eq(formatAlg(parseAlg('[R, U]')), "R U R' U'"));
test('Conjugué [F: [R, U]]', () => eq(formatAlg(parseAlg('[F: [R, U]]')), "F R U R' U' F'"));
test('Répétition (R U R\' U\')3', () => eq(parseAlg("(R U R' U')3").length, 12));
test('Simplification', () => eq(formatAlg(simplify(parseAlg("R R U U' R"))), "R'"));
test('Miroir de R U R\'', () => eq(formatAlg(mirrorMoves(parseAlg("R U R'"))), "L' U' L"));
test('Miroir : même ordre (T-perm)', () => {
  const t = parseAlg("R U R' U' R' F R2 U' R' U' R U R' F'");
  eq(c3.order(mirrorMoves(t)), c3.order(t));
});
test('Métriques T-perm (14 HTM)', () => eq(metrics(parseAlg("R U R' U' R' F R2 U' R' U' R U R' F'")).htm, 14));
test('Mélange : 25 mouvements, pas de répétition de face', () => {
  for (let k = 0; k < 200; k++) {
    const m = randomMoveScramble({ length: 25 }).split(' ');
    eq(m.length, 25);
    for (let i = 1; i < m.length; i++) ok(m[i][0] !== m[i - 1][0], `répétition ${m[i - 1]} ${m[i]}`);
  }
});
test('Moteur 2x2, 4x4, 7x7', () => {
  for (const [n, alg] of [[2, "R U F' x y2"], [4, "R Uw 2R' F2 3Rw x"], [7, "3Rw U 4L' Fw2 y"]]) {
    const c = new NxNCube(n);
    const m = parseAlg(alg);
    ok(!c.isSolved(c.apply(c.solved(), m)), `${n}x${n} devrait être mélangé`);
    ok(c.isSolved(c.apply(c.apply(c.solved(), m), invertMoves(m))), `${n}x${n}`);
  }
});
test('Ordre de R U = 105', () => eq(c3.order(parseAlg('R U')), 105));
test('Ao5 tronquée', () => eq(average([10, 20, 30, 40, 50], trimFor(5)), 30));
test('Ao5 avec 1 DNF = valide', () => eq(average([10, 20, 30, 40, DNF], 1), 30));
test('Ao5 avec 2 DNF = DNF', () => eq(average([10, 20, 30, DNF, DNF], 1), DNF));
test('Format des temps', () => {
  eq(fmt(12345), '12.34');
  eq(fmt(62005), '1:02.00');
  eq(fmt(12345, { precision: 3 }), '12.345');
});

// ---------- Suivi du mélange (cube connecté) ----------
const guide = (scr, start = '') => new ScrambleGuide(c3, parseAlg(scr), parseAlg(start));
const play = (g, alg) => parseAlg(alg).forEach(m => g.move(m));
test('Suivi du mélange : mouvements corrects', () => {
  const g = guide("R U2 F'");
  play(g, 'R'); eq(g.k, 1, 'après R');
  play(g, 'U'); ok(g.partial && g.k === 1, 'U2 commencé');
  play(g, 'U'); eq(g.k, 2, 'U2 fini');
  play(g, "F'"); ok(g.done, 'mélange fini');
});
test('Suivi du mélange : U2 fait en U\' U\'', () => {
  const g = guide('R U2');
  play(g, "R U' U'"); ok(g.done, 'U\' U\' accepté pour U2');
});
test('Suivi du mélange : erreur et correction', () => {
  const g = guide("R U F");
  play(g, 'R L');
  eq(formatAlg(g.correction), "L'", 'correction');
  play(g, "L'"); ok(!g.correction && g.k === 1, 'retour sur le mélange');
  play(g, "U' B"); eq(formatAlg(g.correction), "B' U", 'deux erreurs');
});
test('Suivi du mélange : mouvements parallèles dans l\'autre ordre', () => {
  const g = guide('R L U');
  play(g, 'L R'); eq(g.k, 2, 'L puis R accepté');
});
test('Suivi du mélange : cube pas résolu au départ', () => {
  const g = guide('R U', "F'");
  eq(formatAlg(g.correction), 'F', 'il faut d\'abord annuler F\'');
  play(g, 'F R U'); ok(g.done, 'puis le mélange');
});

export default results;
