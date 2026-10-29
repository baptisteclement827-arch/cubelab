// Statistiques façon WCA : DNF = Infinity, moyennes tronquées (5 % de chaque côté, arrondi supérieur).
export const DNF = Infinity;

export function value(solve) {
  if (solve.p === 'DNF') return DNF;
  return solve.t + (solve.p === '+2' ? 2000 : 0);
}

export const trimFor = n => (n < 5 ? 0 : Math.ceil(n * 0.05));

export function average(vals, trim) {
  if (!vals.length) return null;
  const sorted = [...vals].sort((a, b) => (a === b ? 0 : a - b));
  const kept = sorted.slice(trim, sorted.length - trim);
  if (kept.some(v => v === DNF)) return DNF;
  return kept.reduce((a, b) => a + b, 0) / kept.length;
}

// Moyenne des n derniers temps se terminant à l'index i (null si pas assez de temps).
export function avgAt(vals, i, n, mean = false) {
  if (i + 1 < n) return null;
  return average(vals.slice(i - n + 1, i + 1), mean ? 0 : trimFor(n));
}

export function bestAvg(vals, n, mean = false) {
  let best = null;
  for (let i = n - 1; i < vals.length; i++) {
    const a = avgAt(vals, i, n, mean);
    if (best === null || a < best) best = a;
  }
  return best;
}

export function summary(vals) {
  const finished = vals.filter(v => v !== DNF);
  const rows = [];
  if (vals.length) {
    rows.push({ label: 'Single', current: vals[vals.length - 1], best: Math.min(...vals) });
  }
  for (const [label, n, mean] of [['mo3', 3, true], ['ao5', 5], ['ao12', 12], ['ao50', 50], ['ao100', 100]]) {
    if (vals.length < n) continue;
    rows.push({ label, current: avgAt(vals, vals.length - 1, n, mean), best: bestAvg(vals, n, mean), avg: true });
  }
  return {
    rows,
    count: vals.length,
    finished: finished.length,
    mean: finished.length ? finished.reduce((a, b) => a + b, 0) / finished.length : null,
  };
}

// Single : tronqué au centième (WCA). Moyenne : arrondie.
export function fmt(ms, { precision = 2, avg = false } = {}) {
  if (ms === null || ms === undefined) return '–';
  if (ms === DNF) return 'DNF';
  const unit = precision === 3 ? 1 : 10;
  const t = (avg ? Math.round(ms / unit) : Math.floor(ms / unit)) * unit;
  const totalSec = Math.floor(t / 1000);
  const frac = String(t % 1000).padStart(3, '0').slice(0, precision);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return min ? `${min}:${String(sec).padStart(2, '0')}.${frac}` : `${sec}.${frac}`;
}

export function fmtSolve(solve, precision) {
  if (solve.p === 'DNF') return 'DNF';
  return fmt(value(solve), { precision }) + (solve.p === '+2' ? '+' : '');
}

// Temps d'entraînement d'un algo : moyenne, médiane, meilleur et pire.
export function timeStats(times) {
  if (!times?.length) return null;
  const sorted = [...times].sort((a, b) => a - b);
  const n = sorted.length;
  return {
    count: n,
    mean: sorted.reduce((a, b) => a + b, 0) / n,
    median: n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2,
    best: sorted[0],
    worst: sorted[n - 1],
  };
}
