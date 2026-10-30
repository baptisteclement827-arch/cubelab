// Objectifs : objectifs à long terme (reliés si possible à une stat de l'app) et calendrier de séances.
import * as Stats from './stats.js?v=10';
import { splitsOf } from './splits.js?v=33';
import { drillStats, difficultyOf } from './drills.js?v=40';

// ---------- Dates (jours locaux, au format AAAA-MM-JJ) ----------
export const dayKey = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const parseDay = k => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
export const todayKey = () => dayKey(new Date());
export const daysBetween = (a, b) => Math.round((parseDay(b) - parseDay(a)) / 864e5);
export const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
export const WEEKDAYS = ['L', 'M', 'M', 'J', 'V', 'S', 'D']; // lundi en premier
export const weekdayIndex = d => (d.getDay() + 6) % 7;

// ---------- Mesures suivies automatiquement ----------
// kind : avg (moyenne actuelle de n), bestavg (meilleure moyenne de n), single (meilleur single), split (moyenne des
// 12 derniers splits d'une étape), learned (cas appris d'un ensemble), drill (réussite des 20 derniers essais BLD), manual.
export const METRICS = [
  { kind: 'avg', name: 'Moyenne actuelle', needs: ['session', 'n'], lower: true },
  { kind: 'bestavg', name: 'Meilleure moyenne', needs: ['session', 'n'], lower: true },
  { kind: 'single', name: 'Meilleur single', needs: ['session'], lower: true },
  { kind: 'split', name: 'Split CFOP moyen (12 derniers)', needs: ['session', 'phase'], lower: true },
  { kind: 'learned', name: 'Cas appris', needs: ['set'], lower: false },
  { kind: 'drill', name: 'Réussite BLD Cross + X (20 derniers)', needs: ['pairs'], lower: false },
  { kind: 'manual', name: 'Objectif libre', needs: [], lower: false },
];
export const AVG_SIZES = [5, 12, 50, 100];
export const PHASE_NAMES = { cross: 'Croix', f2l: 'F2L', oll: 'OLL', pll: 'PLL' };

const fmtTime = ms => Stats.fmt(ms, { precision: 2, avg: true });

// Valeur actuelle d'un objectif : { value, text } (value null si pas encore de donnée).
export function currentValue(goal, data, { ALG_SETS }) {
  const m = goal.metric;
  const session = data.sessions.find(s => s.id === m.session);
  const vals = session ? session.solves.map(Stats.value) : [];
  let value = null, text = '–';
  if (m.kind === 'avg' && vals.length >= m.n) value = Stats.avgAt(vals, vals.length - 1, m.n);
  else if (m.kind === 'bestavg') value = Stats.bestAvg(vals, m.n);
  else if (m.kind === 'single') { const fin = vals.filter(v => v !== Stats.DNF); value = fin.length ? Math.min(...fin) : null; }
  else if (m.kind === 'split' && session) {
    const sp = session.solves.map(splitsOf).filter(Boolean).slice(-12);
    if (sp.length) value = sp.reduce((a, x) => a + x.times[m.phase], 0) / sp.length;
  } else if (m.kind === 'learned') {
    const progress = data.algs?.[m.set] || {};
    value = Object.values(progress).filter(p => p.status === 'learned').length;
    text = `${value}/${ALG_SETS[m.set]?.CASES.length ?? '?'}`;
    return { value, text };
  } else if (m.kind === 'drill') {
    const list = (data.drills?.bldcross || []).filter(x => (x.n || 0) === m.pairs && difficultyOf(x) === 'any').slice(-20);
    const st = drillStats(list);
    if (st) { value = st.success * 100; text = `${Math.round(value)} %`; }
    return { value, text };
  } else if (m.kind === 'manual') {
    value = goal.current ?? null;
    text = value == null ? '–' : String(value);
    return { value, text };
  }
  if (value === Stats.DNF) return { value: null, text: 'DNF' };
  if (value != null) text = fmtTime(value);
  return { value, text };
}

// Valeur cible affichée et comparaison (« plus bas est mieux » pour les temps).
export const isLower = goal => METRICS.find(x => x.kind === goal.metric.kind)?.lower;
export function targetText(goal) {
  const k = goal.metric.kind;
  if (k === 'learned' || k === 'manual') return String(goal.target);
  if (k === 'drill') return `${goal.target} %`;
  return fmtTime(goal.target);
}
export function reached(goal, value) {
  if (value == null) return false;
  return isLower(goal) ? value <= goal.target : value >= goal.target;
}
// Avancement de 0 à 1 entre la valeur de départ et la cible.
export function progressOf(goal, value) {
  if (value == null || goal.start == null || goal.start === goal.target) return reached(goal, value) ? 1 : 0;
  const p = (goal.start - value) / (goal.start - goal.target);
  return Math.max(0, Math.min(1, p));
}

// Intitulé par défaut d'un objectif d'après sa mesure.
export function defaultTitle(metric, { sessions, ALG_SETS, setName }) {
  const s = sessions.find(x => x.id === metric.session)?.name;
  switch (metric.kind) {
    case 'avg': return `ao${metric.n} actuelle${s ? ` · ${s}` : ''}`;
    case 'bestavg': return `Meilleure ao${metric.n}${s ? ` · ${s}` : ''}`;
    case 'single': return `Meilleur single${s ? ` · ${s}` : ''}`;
    case 'split': return `${PHASE_NAMES[metric.phase]} moyen${s ? ` · ${s}` : ''}`;
    case 'learned': return `Cas ${setName(metric.set)} appris`;
    case 'drill': return `BLD Cross${metric.pairs ? ` + ${metric.pairs}` : ''} réussie`;
    default: return 'Objectif';
  }
}

// Activité réelle d'un jour : solves (toutes sessions) et essais de drills.
export function activityByDay(data) {
  const out = new Map();
  const add = (d, key) => {
    const k = dayKey(new Date(d));
    if (!out.has(k)) out.set(k, { solves: 0, drills: 0 });
    out.get(k)[key]++;
  };
  for (const s of data.sessions) for (const x of s.solves) if (x.d) add(x.d, 'solves');
  for (const list of Object.values(data.drills || {})) for (const x of list) if (x.d) add(x.d, 'drills');
  return out;
}

// Ajoute une séance à un jour, ou à plusieurs (répétition sur certains jours de la semaine jusqu'à une date).
export function addPlanned(plan, { text, goal, from, until, weekdays }) {
  const make = () => ({ id: Math.random().toString(36).slice(2, 10), text, ...(goal ? { goal } : {}), done: false });
  const days = [];
  if (!weekdays?.length || !until) days.push(from);
  else {
    for (let d = parseDay(from); dayKey(d) <= until && days.length < 400; d.setDate(d.getDate() + 1)) {
      if (weekdays.includes(weekdayIndex(d))) days.push(dayKey(d));
    }
  }
  for (const k of days) (plan[k] ||= []).push(make());
  return days.length;
}
