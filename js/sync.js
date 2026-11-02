// Synchronisation entre appareils via un Gist GitHub privé (le site n'a pas de serveur).
// La clé d'accès (token « gist ») reste dans ce navigateur : elle n'est jamais incluse dans les données exportées.
const SYNC_KEY = 'cubelab:sync';
const FILE = 'cubelab.json';
const DESCRIPTION = 'CubeLab — données synchronisées';
const API = 'https://api.github.com';

export function loadSyncConfig() {
  try { return JSON.parse(localStorage.getItem(SYNC_KEY)) || null; } catch { return null; }
}
export function saveSyncConfig(cfg) {
  try { cfg ? localStorage.setItem(SYNC_KEY, JSON.stringify(cfg)) : localStorage.removeItem(SYNC_KEY); } catch { /* stockage indisponible */ }
}

async function gh(token, path, options = {}) {
  const res = await fetch(`${API}${path}`, {
    ...options,
    headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, ...(options.body ? { 'Content-Type': 'application/json' } : {}) },
  });
  if (res.status === 401) throw new Error('Clé GitHub refusée (invalide ou expirée)');
  if (res.status === 403 || res.status === 404) throw new Error('Accès refusé : la clé doit avoir le droit « gist »');
  if (!res.ok) throw new Error(`GitHub a répondu ${res.status}`);
  return res.json();
}

// Retrouve le Gist CubeLab de l'utilisateur, ou le crée.
export async function findOrCreateGist(token, data) {
  for (let page = 1; page <= 5; page++) {
    const list = await gh(token, `/gists?per_page=100&page=${page}`);
    const g = list.find(x => x.description === DESCRIPTION && x.files?.[FILE]);
    if (g) return g.id;
    if (list.length < 100) break;
  }
  const created = await gh(token, '/gists', {
    method: 'POST',
    body: JSON.stringify({ description: DESCRIPTION, public: false, files: { [FILE]: { content: JSON.stringify(data) } } }),
  });
  return created.id;
}

export async function pullGist(token, gistId) {
  const g = await gh(token, `/gists/${gistId}`);
  const f = g.files?.[FILE];
  if (!f) return null;
  // Au-delà d'environ 1 Mo, l'API tronque le contenu : on le lit à son adresse brute.
  const text = f.truncated ? await (await fetch(f.raw_url)).text() : f.content;
  return JSON.parse(text);
}

export async function pushGist(token, gistId, data) {
  await gh(token, `/gists/${gistId}`, { method: 'PATCH', body: JSON.stringify({ files: { [FILE]: { content: JSON.stringify(data) } } }) });
}

// ---------- Fusion de deux versions modifiées chacune de leur côté ----------
// Le plus récent l'emporte pour les réglages ; les listes (solves, essais, objectifs, séances) sont réunies.
const byKey = (a = [], b = [], key) => {
  const map = new Map();
  for (const x of [...a, ...b]) map.set(key(x), x); // b (le plus récent) l'emporte à clé égale
  return [...map.values()];
};

export function mergeData(x, y) {
  const [older, newer] = (x.updatedAt || 0) <= (y.updatedAt || 0) ? [x, y] : [y, x];
  const out = structuredClone(newer);
  // Sessions : réunies par id, solves réunis par instant + temps.
  const sessions = new Map(older.sessions.map(s => [s.id, structuredClone(s)]));
  for (const s of newer.sessions) {
    const o = sessions.get(s.id);
    sessions.set(s.id, o ? { ...s, solves: byKey(o.solves, s.solves, v => `${v.d}|${v.t}`).sort((a, b) => a.d - b.d) } : structuredClone(s));
  }
  out.sessions = [...sessions.values()];
  // Progression des algos : par cas, la version la plus récente, en gardant la liste de temps la plus longue.
  out.algs = structuredClone(older.algs || {});
  for (const [set, cases] of Object.entries(newer.algs || {})) {
    out.algs[set] ||= {};
    for (const [id, p] of Object.entries(cases)) {
      const o = out.algs[set][id] || {};
      const merged = { ...o, ...p };
      for (const k of ['times', 'timesCheck']) if ((o[k]?.length || 0) > (p[k]?.length || 0)) merged[k] = o[k];
      out.algs[set][id] = merged;
    }
  }
  // Drills : essais réunis par instant.
  out.drills = {};
  for (const id of new Set([...Object.keys(older.drills || {}), ...Object.keys(newer.drills || {})])) {
    out.drills[id] = byKey(older.drills?.[id], newer.drills?.[id], v => v.d).sort((a, b) => a.d - b.d);
  }
  out.goals = byKey(older.goals, newer.goals, g => g.id);
  out.plan = {};
  for (const day of new Set([...Object.keys(older.plan || {}), ...Object.keys(newer.plan || {})])) {
    out.plan[day] = byKey(older.plan?.[day], newer.plan?.[day], p => p.id);
  }
  out.devices = { ...older.devices, ...newer.devices };
  out.updatedAt = Math.max(x.updatedAt || 0, y.updatedAt || 0);
  return out;
}
