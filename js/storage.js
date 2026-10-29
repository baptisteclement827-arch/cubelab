// Persistance locale (localStorage) + export/import JSON.
const KEY = 'cubelab:v1';

export const DEFAULT_SETTINGS = {
  scrambleType: 'random-state', // random-state | random-move
  inspection: true,
  voice: true,
  holdMs: 300,
  precision: 2,
  runningDisplay: 'full', // full | seconds | hidden
};

const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

export function newSession(puzzle, name) {
  return { id: uid(), name, puzzle, solves: [] };
}

function normalize(data) {
  if (!data || data.version !== 1 || !Array.isArray(data.sessions)) {
    data = { version: 1, settings: {}, sessions: [], current: {}, puzzle: null };
  }
  data.settings = { ...DEFAULT_SETTINGS, ...data.settings };
  data.current ||= {};
  data.algs ||= {}; // { 'puzzle/ensemble': { idCas: { alg, status } } }
  return data;
}

export function load() {
  try {
    return normalize(JSON.parse(localStorage.getItem(KEY)));
  } catch {
    return normalize(null);
  }
}

export function save(data) {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch (e) {
    console.warn('Sauvegarde impossible', e);
  }
}

export function exportJSON(data) {
  return JSON.stringify(data, null, 2);
}

export function importJSON(text) {
  const parsed = JSON.parse(text);
  if (parsed?.version !== 1 || !Array.isArray(parsed.sessions)) throw new Error('Fichier non reconnu');
  return normalize(parsed);
}
