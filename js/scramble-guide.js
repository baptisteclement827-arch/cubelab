// Suivi d'un mélange fait sur un cube connecté, mouvement par mouvement.
// On garde l'étape atteinte (k) et les mouvements faits depuis (écart) : si l'écart amène à une étape
// suivante, on avance ; sinon on propose de l'annuler (mouvements inverses).
import { simplify, invertMoves } from './core/notation.js';

const sameLayer = (a, b) => a.face === b.face && a.wide === b.wide && a.slice === b.slice && a.lower === b.lower;
const same = (a, b) => a.every((v, i) => v === b[i]);

export class ScrambleGuide {
  // cube : moteur NxN ; moves : mouvements du mélange ; start : mouvements faits depuis le cube résolu.
  constructor(cube, moves, start = []) {
    this.cube = cube;
    this.moves = moves;
    this.prefix = [cube.solved()];
    for (const m of moves) this.prefix.push(cube.apply(this.prefix.at(-1), [m]));
    this.k = 0;
    this.dev = [];
    this.apply(start);
  }

  apply(moves) {
    for (const m of moves) this.move(m);
  }

  move(m) {
    this.dev = simplify([...this.dev, m]);
    const state = this.cube.apply(this.prefix[this.k], this.dev);
    // Avance jusqu'à 3 étapes d'un coup (ex. « R L » fait dans l'autre ordre).
    for (let j = Math.min(this.moves.length, this.k + 3); j > this.k; j--) {
      if (same(state, this.prefix[j])) { this.k = j; this.dev = []; return; }
    }
  }

  get done() { return this.k === this.moves.length && !this.dev.length; }

  // Demi-tour commencé : un quart de tour de la bonne face sur un mouvement « X2 ».
  get partial() {
    const next = this.moves[this.k];
    return this.dev.length === 1 && !!next && next.amount === 2 && sameLayer(next, this.dev[0]) && this.dev[0].amount !== 2;
  }

  // Mouvements à faire pour revenir sur le mélange (null si on est dessus).
  get correction() {
    if (!this.dev.length || this.partial) return null;
    return invertMoves(this.dev);
  }
}
