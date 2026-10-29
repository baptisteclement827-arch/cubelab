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
