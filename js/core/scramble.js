// Mélanges à mouvements aléatoires (random-move).
// TODO : mélanges « random-state » (WCA) une fois le solveur en place.

const AXIS = { U: 0, D: 0, R: 1, L: 1, F: 2, B: 2 };
const SUFFIXES = ['', "'", '2'];

function randInt(max) {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0] % max;
}

// families : liste de bases de mouvements, ex. ['U','R','F','D','L','B'] ou avec 'Uw', '3Rw'...
export function randomMoveScramble({ families = ['U', 'R', 'F', 'D', 'L', 'B'], length = 25 } = {}) {
  const faceOf = base => base.replace(/\d|w/g, '');
  const moves = [];
  let prev = null, prev2 = null;
  while (moves.length < length) {
    const base = families[randInt(families.length)];
    // Jamais deux fois la même couche, ni trois mouvements de suite sur le même axe (R L R).
    if (prev && base === prev) continue;
    const axis = AXIS[faceOf(base)];
    if (prev && prev2 && AXIS[faceOf(prev)] === axis && AXIS[faceOf(prev2)] === axis) continue;
    if (prev && AXIS[faceOf(prev)] === axis && faceOf(prev) === faceOf(base)) continue;
    moves.push(base + SUFFIXES[randInt(3)]);
    prev2 = prev;
    prev = base;
  }
  return moves.join(' ');
}
