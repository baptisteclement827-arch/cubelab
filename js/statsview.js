// Onglet Stats : chiffres clés, progression (singles + ao5 + ao12), répartition des temps, records.
// Graphiques en SVG maison, survol avec info-bulle.
import * as Stats from './stats.js?v=10';

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

// Pas « rond » pour les graduations (1, 2, 5 × 10^n).
function niceStep(range, target) {
  const raw = range / target;
  const mag = 10 ** Math.floor(Math.log10(raw));
  return [1, 2, 5, 10].map(m => m * mag).find(s => s >= raw) || 10 * mag;
}

// Meilleure moyenne de n et l'index (dernier solve) où elle a été faite.
function bestAvgWithIndex(vals, n, mean) {
  let best = null, at = -1;
  for (let i = n - 1; i < vals.length; i++) {
    const a = Stats.avgAt(vals, i, n, mean);
    if (a !== null && a !== Stats.DNF && (best === null || a < best)) { best = a; at = i; }
  }
  return { value: best, index: at };
}

export function renderStatsView(root, solves, { precision, smart }) {
  const vals = solves.map(Stats.value);
  const finished = vals.filter(v => v !== Stats.DNF);
  const f = (ms, avg = false) => Stats.fmt(ms, { precision, avg });
  if (!solves.length) {
    root.innerHTML = `<div class="placeholder"><h2>Pas encore de solves</h2><p>${smart ? 'Fais un solve avec le cube connecté' : 'Fais quelques solves dans le Timer'} pour voir tes stats ici.</p></div>`;
    return;
  }

  const ao5 = vals.map((_, i) => Stats.avgAt(vals, i, 5));
  const ao12 = vals.map((_, i) => Stats.avgAt(vals, i, 12));
  const best = finished.length ? Math.min(...finished) : null;
  const b5 = bestAvgWithIndex(vals, 5), b12 = bestAvgWithIndex(vals, 12);
  const mean = finished.length ? finished.reduce((a, b) => a + b, 0) / finished.length : null;
  const dnf = vals.length - finished.length;

  const tiles = [
    { label: 'Solves', value: String(solves.length), sub: dnf ? `${dnf} DNF` : 'aucun DNF' },
    { label: 'Meilleur single', value: f(best) },
    { label: 'Meilleure ao5', value: f(b5.value, true) },
    { label: 'Meilleure ao12', value: f(b12.value, true) },
    { label: 'Moyenne', value: f(mean, true), sub: 'hors DNF' },
  ];
  if (smart) {
    // Mouvements et TPS des solves au cube connecté (mouvements enregistrés).
    const withMoves = solves.filter(s => s.mv?.length && s.p !== 'DNF');
    if (withMoves.length) {
      const moves = withMoves.reduce((a, s) => a + s.mv.length, 0) / withMoves.length;
      const tps = withMoves.reduce((a, s) => a + s.mv.length / (s.t / 1000), 0) / withMoves.length;
      tiles.push({ label: 'Mouvements', value: moves.toFixed(1), sub: 'par solve, en moyenne' });
      tiles.push({ label: 'TPS', value: tps.toFixed(2), sub: 'mouvements / seconde' });
    }
  }

  // Records : meilleures moyennes, avec la date du solve qui les termine.
  const recordRows = [['Single', 1, false], ['mo3', 3, true], ['ao5', 5], ['ao12', 12], ['ao50', 50], ['ao100', 100]]
    .map(([label, n, m]) => {
      if (vals.length < n) return null;
      const r = n === 1 ? { value: best, index: vals.indexOf(best) } : bestAvgWithIndex(vals, n, m);
      if (r.value === null) return null;
      const d = new Date(solves[r.index].d).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
      return `<tr><td>${label}</td><td class="num">${f(r.value, n > 1)}</td><td class="num muted">${n > 1 ? `n° ${r.index - n + 2}–${r.index + 1}` : `n° ${r.index + 1}`}</td><td class="muted">${d}</td></tr>`;
    }).filter(Boolean).join('');

  root.innerHTML = `
    <div class="kpis">${tiles.map(t => `<div class="card kpi"><span class="kpi-label">${t.label}</span><strong class="kpi-value">${t.value}</strong>${t.sub ? `<span class="kpi-sub">${t.sub}</span>` : ''}</div>`).join('')}</div>
    <section class="card chart-card">
      <div class="chart-head">
        <h2>Progression</h2>
        <div class="legend">
          <span><i class="key dot"></i>Single</span>
          <span><i class="key line s1"></i>ao5</span>
          <span><i class="key line s2"></i>ao12</span>
        </div>
      </div>
      <div class="chart" id="chart-progress"></div>
    </section>
    <div class="stats-grid">
      <section class="card chart-card">
        <div class="chart-head"><h2>Répartition des temps</h2></div>
        <div class="chart" id="chart-hist"></div>
      </section>
      <section class="card chart-card records">
        <div class="chart-head"><h2>Records</h2></div>
        <table><thead><tr><th></th><th class="num">Temps</th><th class="num">Solves</th><th>Date</th></tr></thead><tbody>${recordRows}</tbody></table>
      </section>
    </div>`;

  drawProgress(root.querySelector('#chart-progress'), { vals, ao5, ao12, f });
  drawHistogram(root.querySelector('#chart-hist'), { finished, f });
}

// ---------- Progression ----------
function drawProgress(el, { vals, ao5, ao12, f }) {
  const W = Math.max(280, el.clientWidth), H = 260;
  const m = { l: 44, r: 12, t: 10, b: 26 };
  const pts = vals.map((v, i) => ({ i, v })).filter(p => p.v !== Stats.DNF);
  if (!pts.length) { el.innerHTML = '<p class="empty">Que des DNF pour l\'instant.</p>'; return; }
  // Échelle : on coupe les temps aberrants (au-delà de 2× la médiane) pour garder la courbe lisible.
  const sorted = pts.map(p => p.v).sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const yMax0 = Math.min(sorted.at(-1), median * 2);
  const step = niceStep(Math.max(yMax0 - sorted[0], 1000), 4);
  const yMin = Math.max(0, Math.floor(sorted[0] / step) * step), yMax = Math.ceil(yMax0 / step) * step || step;
  const n = vals.length;
  const x = i => m.l + (n === 1 ? (W - m.l - m.r) / 2 : (i / (n - 1)) * (W - m.l - m.r));
  const y = v => m.t + (1 - (Math.min(v, yMax) - yMin) / (yMax - yMin)) * (H - m.t - m.b);

  let grid = '';
  for (let v = yMin; v <= yMax + 1; v += step) {
    grid += `<line class="grid" x1="${m.l}" x2="${W - m.r}" y1="${y(v)}" y2="${y(v)}"/><text class="tick" x="${m.l - 6}" y="${y(v) + 4}" text-anchor="end">${(v / 1000).toFixed(step < 1000 ? 1 : 0)}</text>`;
  }
  const xStep = niceStep(Math.max(n - 1, 1), Math.min(6, Math.floor(W / 80)));
  for (let i = 0; i < n; i += xStep) grid += `<text class="tick" x="${x(i)}" y="${H - 6}" text-anchor="middle">${i + 1}</text>`;

  const path = arr => {
    let d = '', pen = false;
    arr.forEach((v, i) => {
      if (v === null || v === Stats.DNF) { pen = false; return; }
      d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
      pen = true;
    });
    return d;
  };
  const dots = pts.map(p => `<circle class="pt${p.v > yMax ? ' out' : ''}" cx="${x(p.i).toFixed(1)}" cy="${y(p.v).toFixed(1)}" r="${n > 200 ? 2 : 3}"/>`).join('');
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Progression des temps : singles, ao5 et ao12">
    ${grid}${dots}
    <path class="ln s2" d="${path(ao12)}"/><path class="ln s1" d="${path(ao5)}"/>
    <line class="cross" x1="0" x2="0" y1="${m.t}" y2="${H - m.b}" visibility="hidden"/>
    <rect class="hit" x="${m.l}" y="0" width="${W - m.l - m.r}" height="${H}"/>
  </svg><div class="tip" hidden></div>`;

  // Survol : ligne verticale + info-bulle du solve le plus proche.
  const svg = el.querySelector('svg'), tip = el.querySelector('.tip'), cross = el.querySelector('.cross');
  const show = e => {
    const r = svg.getBoundingClientRect();
    const px = (e.clientX - r.left) * (W / r.width);
    const i = Math.max(0, Math.min(n - 1, Math.round(((px - m.l) / (W - m.l - m.r)) * (n - 1))));
    cross.setAttribute('x1', x(i)); cross.setAttribute('x2', x(i)); cross.setAttribute('visibility', 'visible');
    tip.hidden = false;
    tip.innerHTML = `<strong>Solve n° ${i + 1}</strong><span>${f(vals[i])}</span>`
      + `<span><i class="key line s1"></i>ao5 ${f(ao5[i], true)}</span><span><i class="key line s2"></i>ao12 ${f(ao12[i], true)}</span>`;
    const left = (x(i) / W) * r.width;
    tip.style.left = `${Math.min(Math.max(left, 70), r.width - 70)}px`;
  };
  const hide = () => { tip.hidden = true; cross.setAttribute('visibility', 'hidden'); };
  const hit = el.querySelector('.hit');
  hit.addEventListener('pointermove', show);
  hit.addEventListener('pointerdown', show);
  hit.addEventListener('pointerleave', hide);
}

// ---------- Répartition ----------
function drawHistogram(el, { finished, f }) {
  const W = Math.max(260, el.clientWidth), H = 220;
  const m = { l: 34, r: 8, t: 10, b: 26 };
  if (!finished.length) { el.innerHTML = '<p class="empty">Que des DNF pour l\'instant.</p>'; return; }
  const sorted = [...finished].sort((a, b) => a - b);
  const lo0 = sorted[0], hi0 = sorted[Math.floor(sorted.length * 0.98)] ?? sorted.at(-1);
  const step = niceStep(Math.max(hi0 - lo0, 500), 16);
  const lo = Math.floor(lo0 / step) * step;
  const bins = Math.max(1, Math.ceil((hi0 - lo + 1) / step));
  const counts = new Array(bins).fill(0);
  for (const v of sorted) counts[Math.min(bins - 1, Math.floor((v - lo) / step))]++; // les plus lents dans la dernière barre
  const cMax = Math.max(...counts);
  const bw = (W - m.l - m.r) / bins;
  const barW = Math.min(24, bw - 2);
  const yC = c => m.t + (1 - c / cMax) * (H - m.t - m.b);
  const cStep = niceStep(cMax, 4);
  let grid = '';
  for (let c = 0; c <= cMax; c += cStep) grid += `<line class="grid" x1="${m.l}" x2="${W - m.r}" y1="${yC(c)}" y2="${yC(c)}"/><text class="tick" x="${m.l - 6}" y="${yC(c) + 4}" text-anchor="end">${c}</text>`;
  const labelEvery = Math.ceil(bins / Math.floor((W - m.l) / 46));
  const sec = v => (v / 1000).toFixed(step < 1000 ? 1 : 0);
  let bars = '';
  counts.forEach((c, k) => {
    const cx = m.l + k * bw + bw / 2;
    if (c) {
      const top = yC(c), h = H - m.b - top, r = Math.min(4, h);
      // Barre arrondie en haut (4 px), carrée sur la ligne de base.
      bars += `<path class="bar" d="M${cx - barW / 2},${H - m.b}V${top + r}q0,-${r} ${r},-${r}H${cx + barW / 2 - r}q${r},0 ${r},${r}V${H - m.b}Z"/>`;
    }
    bars += `<rect class="hit" data-k="${k}" x="${m.l + k * bw}" y="${m.t}" width="${bw}" height="${H - m.t - m.b}"/>`;
    if (k % labelEvery === 0) bars += `<text class="tick" x="${m.l + k * bw}" y="${H - 6}" text-anchor="middle">${sec(lo + k * step)}</text>`;
  });
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Répartition des temps">${grid}<line class="axis" x1="${m.l}" x2="${W - m.r}" y1="${H - m.b}" y2="${H - m.b}"/>${bars}</svg><div class="tip" hidden></div>`;
  const tip = el.querySelector('.tip'), svg = el.querySelector('svg');
  el.querySelectorAll('.hit').forEach(h => {
    const show = () => {
      const k = Number(h.dataset.k);
      const last = k === bins - 1;
      tip.hidden = false;
      tip.innerHTML = `<strong>${counts[k]} solve${counts[k] > 1 ? 's' : ''}</strong><span>${f(lo + k * step)} – ${last ? 'et plus' : f(lo + (k + 1) * step)}</span>`;
      const r = svg.getBoundingClientRect();
      tip.style.left = `${Math.min(Math.max(((m.l + k * bw + bw / 2) / W) * r.width, 70), r.width - 70)}px`;
    };
    h.addEventListener('pointerenter', show);
    h.addEventListener('pointerdown', show);
    h.addEventListener('pointerleave', () => { tip.hidden = true; });
  });
}
