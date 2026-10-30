// Rendu 2D du patron d'un cube NxN en SVG.
import { FACES, NxNCube } from './core/nxn.js';

// Schéma de couleurs WCA, dans l'ordre U R F D L B (+ gris pour les facettes ignorées).
export const COLORS = ['#ffffff', '#d7191c', '#14a44d', '#ffd500', '#ff7f0e', '#1f5fd6', '#6b7280'];

const LAYOUT = { U: [1, 0], L: [0, 1], F: [1, 1], R: [2, 1], B: [3, 1], D: [1, 2] };

export function renderNet(state, n) {
  const gap = 0.25;
  const pad = 0.04;
  let out = '';
  FACES.forEach((face, fi) => {
    const [fx, fy] = LAYOUT[face];
    const ox = fx * (n + gap);
    const oy = fy * (n + gap);
    out += `<rect class="net-face" x="${ox}" y="${oy}" width="${n}" height="${n}" rx="0.15"/>`;
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        const color = COLORS[state[fi * n * n + r * n + c]];
        out += `<rect x="${ox + c + pad}" y="${oy + r + pad}" width="${1 - 2 * pad}" height="${1 - 2 * pad}" rx="0.12" fill="${color}"/>`;
      }
    }
  });
  const w = 4 * n + 3 * gap;
  const h = 3 * n + 2 * gap;
  return `<svg class="net" viewBox="-0.1 -0.1 ${w + 0.2} ${h + 0.2}" role="img" aria-label="Patron du cube">${out}</svg>`;
}

// Vue de dessus de la dernière couche (face U + bande du haut des 4 faces latérales), arrière en haut.
// view « oll » : seules les facettes de la couleur du haut sont colorées (en jaune, convention des fiches).
// view « pll » : couleurs complètes (jaune dessus, vert devant) + flèches des pièces à déplacer.
const TOP = '#ffd500';
const OFF = '#3a3f4a';
// Couleur affichée par face d'origine, jaune en haut : U jaune, R orange, F vert, L rouge, B bleu.
const PLL_COLORS = [TOP, '#ff7f0e', '#14a44d', OFF, '#d7191c', '#1f5fd6'];

// Pièces de la dernière couche : facette U (index 0-8) + facettes latérales qui l'identifient.
const LL_PIECES = [
  { u: 1, side: [46] }, { u: 3, side: [37] }, { u: 5, side: [10] }, { u: 7, side: [19] },
  { u: 0, side: [47, 36] }, { u: 2, side: [11, 45] }, { u: 6, side: [38, 18] }, { u: 8, side: [20, 9] },
];
const pieceKey = (state, p) => p.side.map(i => state[i]).sort().join();
const homeKey = p => p.side.map(i => Math.floor(i / 9)).sort().join();

// Flèches : de la position actuelle de chaque pièce vers sa place (les échanges ont une double pointe).
// Si l'algo finit par un AUF, on prend l'AUF final qui déplace le moins de pièces.
const TURN = [2, 5, 8, 1, 4, 7, 0, 3, 6]; // quart de tour de la face U, en vue de dessus

function arrows(state) {
  let target = null;
  for (let k = 0, rot = i => i; k < 4; k++, rot = (r => i => TURN[r(i)])(rot)) {
    const homes = new Map(LL_PIECES.map(p => [homeKey(p), rot(p.u)]));
    const t = new Map();
    for (const p of LL_PIECES) {
      const to = homes.get(pieceKey(state, p));
      if (to !== undefined && to !== p.u) t.set(p.u, to);
    }
    if (!target || t.size < target.size) target = t;
  }
  const center = i => [(i % 3) + 0.5, Math.floor(i / 3) + 0.5];
  let out = '';
  const done = new Set();
  for (const [from, to] of target) {
    if (done.has(from)) continue;
    const swap = target.get(to) === from;
    if (swap) done.add(to);
    const [x1, y1] = center(from), [x2, y2] = center(to);
    const len = Math.hypot(x2 - x1, y2 - y1), ux = (x2 - x1) / len, uy = (y2 - y1) / len;
    const cut = 0.22;
    const a = [x1 + ux * cut, y1 + uy * cut], b = [x2 - ux * cut, y2 - uy * cut];
    const head = ([x, y], dx, dy) => {
      const h = 0.26, w = 0.14;
      return `<polygon points="${x},${y} ${x - dx * h - dy * w},${y - dy * h + dx * w} ${x - dx * h + dy * w},${y - dy * h - dx * w}"/>`;
    };
    const shaft = (p, dx, dy, inset) => [p[0] - dx * inset, p[1] - dy * inset];
    const s1 = swap ? shaft(a, -ux, -uy, 0.2) : a, s2 = shaft(b, ux, uy, 0.2);
    out += `<line x1="${s1[0]}" y1="${s1[1]}" x2="${s2[0]}" y2="${s2[1]}"/>` + head(b, ux, uy) + (swap ? head(a, -ux, -uy) : '');
  }
  return out ? `<g class="ll-arrows">${out}</g>` : '';
}

export function renderLL(state, view = 'oll') {
  const color = view === 'pll' ? i => PLL_COLORS[state[i]] ?? OFF : i => (state[i] === 0 ? TOP : OFF);
  const cell = (x, y, w, h, i) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="0.1" fill="${color(i)}"/>`;
  const s = 0.94; // taille d'une facette du dessus (pas de 1)
  const t = 0.3;  // épaisseur des bandes latérales
  let out = '';
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) out += cell(c + 0.03, r + 0.03, s, s, r * 3 + c);
  for (let k = 0; k < 3; k++) {
    out += cell(k + 0.03, 3.08, s, t, 18 + k);       // F : de gauche à droite
    out += cell(3.08, 2 - k + 0.03, t, s, 9 + k);    // R : de l'avant vers l'arrière
    out += cell(2 - k + 0.03, -0.08 - t, s, t, 45 + k); // B : de droite à gauche
    out += cell(-0.08 - t, k + 0.03, t, s, 36 + k);  // L : de l'arrière vers l'avant
  }
  if (view === 'pll') out += arrows(state);
  const m = t + 0.12;
  return `<svg class="ll" viewBox="${-m} ${-m} ${3 + 2 * m} ${3 + 2 * m}" role="img" aria-label="Vue de dessus de la dernière couche">${out}</svg>`;
}

// Schéma F2L en cube 3D (dessus, avant, droite), dans le style des autres schémas : facettes arrondies et espacées,
// pièces sans importance en gris foncé. Couleurs jaune dessus, blanc dessous, vert devant ; 6 = gris.
const F2L_COLORS = [TOP, '#ff7f0e', '#14a44d', '#ffffff', '#d7191c', '#1f5fd6', OFF];
const cube3d = new NxNCube(3);
const iso = ([x, y, z]) => [(x - z) * 0.866, (x + z) * 0.5 - y];

// Quadrilatère aux coins arrondis (r : part de chaque côté utilisée pour l'arrondi).
function roundedQuad(pts, r = 0.18) {
  const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  const f = p => `${p[0].toFixed(3)},${p[1].toFixed(3)}`;
  let d = '';
  pts.forEach((p, i) => {
    const prev = pts[(i + 3) % 4], next = pts[(i + 1) % 4];
    const a = lerp(p, prev, r), b = lerp(p, next, r);
    d += `${i ? 'L' : 'M'}${f(a)}Q${f(p)} ${f(b)}`;
  });
  return `${d}Z`;
}

export function renderF2L(state) {
  // Faces : dessus (U), avant (F, un peu plus sombre), droite (R, plus sombre) pour donner du relief.
  const faces = [[0, 1], [2, 0.88], [1, 0.76]];
  let out = '';
  for (const [f, light] of faces) {
    let g = '';
    for (let k = 0; k < 9; k++) {
      const i = f * 9 + k;
      const p = cube3d.points[i];
      const axis = p.findIndex(v => Math.abs(v) === 3);
      const [a, b] = [0, 1, 2].filter(d => d !== axis);
      const corner = (da, db) => { const q = p.slice(); q[a] += da * 0.86; q[b] += db * 0.86; return iso(q); };
      const d = roundedQuad([corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)]);
      g += `<path d="${d}" fill="${F2L_COLORS[state[i]] ?? OFF}"${state[i] === 3 ? ' class="white-sticker"' : ''}/>`;
    }
    out += `<g style="filter:brightness(${light})">${g}</g>`;
  }
  return `<svg class="ll f2l" viewBox="-5.4 -6.2 10.8 12.4" role="img" aria-label="Schéma du cas F2L">${out}</svg>`;
}
