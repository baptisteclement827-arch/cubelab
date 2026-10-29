// Rendu 2D du patron d'un cube NxN en SVG.
import { FACES } from './core/nxn.js';

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
// Mode « oll » : seules les facettes de la couleur du haut sont colorées (en jaune, convention des fiches OLL).
const TOP = '#ffd500';
const OFF = '#3a3f4a';

export function renderLL(state) {
  const color = i => (state[i] === 0 ? TOP : OFF);
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
  const m = t + 0.12;
  return `<svg class="ll" viewBox="${-m} ${-m} ${3 + 2 * m} ${3 + 2 * m}" role="img" aria-label="Vue de dessus de la dernière couche">${out}</svg>`;
}
