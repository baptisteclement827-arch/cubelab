// Notation WCA : parsing, inversion, miroir, métriques.
// Supporte : R R' R2 Rw r 3Rw 2R M E S x y z, (A)n, [A, B] (commutateur), [A: B] (conjugué).

const TOKEN_RE = /\s+|\d*[URFDLB]w\d*'?|\d*[URFDLB]\d*'?|[urfdlbMESxyz]\d*'?|\)\d*'?|[(\[\],:]/y;
const MOVE_RE = /^(?:(\d*)([URFDLB])w|(\d*)([URFDLB])|([urfdlb])|([MESxyz]))(\d*)('?)$/;

function amountOf(digits, prime) {
  let a = (digits ? parseInt(digits, 10) : 1) % 4;
  if (prime) a = (4 - a) % 4;
  return a;
}

export function parseMove(tok) {
  const g = MOVE_RE.exec(tok);
  if (!g) throw new Error(`Mouvement inconnu : ${tok}`);
  const m = { face: '', wide: 1, slice: 0, lower: false, amount: amountOf(g[7], g[8]) };
  if (g[2]) { m.face = g[2]; m.wide = g[1] ? parseInt(g[1], 10) : 2; }
  else if (g[4]) { m.face = g[4]; if (g[3]) m.slice = parseInt(g[3], 10); }
  else if (g[5]) { m.face = g[5].toUpperCase(); m.wide = 2; m.lower = true; }
  else m.face = g[6];
  if (m.slice === 1) m.slice = 0;
  return m;
}

function tokenize(str) {
  const src = str.replace(/[’′´`‘]/g, "'");
  const tokens = [];
  TOKEN_RE.lastIndex = 0;
  while (TOKEN_RE.lastIndex < src.length) {
    const at = TOKEN_RE.lastIndex;
    const g = TOKEN_RE.exec(src);
    if (!g) throw new Error(`Caractère inattendu « ${src[at]} » (position ${at + 1})`);
    const v = g[0];
    if (/^\s+$/.test(v)) continue;
    if (v[0] === ')') {
      const r = /^\)(\d*)('?)$/.exec(v);
      tokens.push({ t: ')', times: r[1] ? parseInt(r[1], 10) : 1, inv: !!r[2] });
    } else if ('([],:'.includes(v)) tokens.push({ t: v });
    else tokens.push({ t: 'move', m: parseMove(v) });
  }
  return tokens;
}

export function invertMove(m) {
  return { ...m, amount: (4 - m.amount) % 4 || m.amount };
}

export function invertMoves(moves) {
  return moves.slice().reverse().map(invertMove);
}

// Parse une chaîne en liste plate de mouvements.
export function parseAlg(str) {
  const tokens = tokenize(str);
  let pos = 0;

  const seq = stops => {
    const out = [];
    while (pos < tokens.length && !stops.includes(tokens[pos].t)) out.push(...item());
    return out;
  };

  const expect = t => {
    if (tokens[pos]?.t !== t) throw new Error(`« ${t} » attendu`);
    return tokens[pos++];
  };

  const item = () => {
    const tok = tokens[pos];
    if (tok.t === 'move') { pos++; return tok.m.amount ? [tok.m] : []; }
    if (tok.t === '(') {
      pos++;
      const body = seq([')']);
      const close = expect(')');
      let out = [];
      for (let i = 0; i < close.times; i++) out = out.concat(body);
      return close.inv ? invertMoves(out) : out;
    }
    if (tok.t === '[') {
      pos++;
      const a = seq([',', ':', ']']);
      const sep = tokens[pos];
      if (!sep || (sep.t !== ',' && sep.t !== ':')) throw new Error('« , » ou « : » attendu dans les crochets');
      pos++;
      const b = seq([']']);
      expect(']');
      return sep.t === ','
        ? [...a, ...b, ...invertMoves(a), ...invertMoves(b)]
        : [...a, ...b, ...invertMoves(a)];
    }
    throw new Error(`« ${tok.t} » inattendu`);
  };

  const moves = seq([]);
  if (pos < tokens.length) throw new Error(`« ${tokens[pos].t} » inattendu`);
  return moves;
}

export function formatMove(m) {
  let base;
  if (m.lower) base = m.face.toLowerCase();
  else if (m.slice) base = `${m.slice}${m.face}`;
  else if (m.wide > 1) base = `${m.wide > 2 ? m.wide : ''}${m.face}w`;
  else base = m.face;
  return base + (m.amount === 2 ? '2' : m.amount === 3 ? "'" : '');
}

export function formatAlg(moves) {
  return moves.map(formatMove).join(' ');
}

const layerKey = m => `${m.face}|${m.wide}|${m.slice}`;

// Fusionne les mouvements consécutifs sur la même couche (R R -> R2, R R' -> rien).
export function simplify(moves) {
  const out = [];
  for (const m of moves) {
    const last = out[out.length - 1];
    if (last && layerKey(last) === layerKey(m)) {
      const amount = (last.amount + m.amount) % 4;
      if (amount) out[out.length - 1] = { ...last, amount };
      else out.pop();
    } else out.push({ ...m });
  }
  return out;
}

// Miroir gauche/droite (plan M) : R -> L', U -> U', M et x inchangés.
export function mirrorMoves(moves) {
  const swap = { R: 'L', L: 'R' };
  return moves.map(m => {
    const face = swap[m.face] || m.face;
    const keep = m.face === 'M' || m.face === 'x';
    return { ...m, face, amount: keep ? m.amount : (4 - m.amount) % 4 || m.amount };
  });
}

const isRotation = m => 'xyz'.includes(m.face);
const isSlice = m => 'MES'.includes(m.face) || m.slice > 0;

export function metrics(moves) {
  let htm = 0, stm = 0, qtm = 0;
  for (const m of moves) {
    if (isRotation(m)) continue;
    const q = m.amount === 2 ? 2 : 1;
    const cost = isSlice(m) ? 2 : 1;
    htm += cost;
    qtm += cost * q;
    stm += 1;
  }
  return { htm, stm, qtm };
}
