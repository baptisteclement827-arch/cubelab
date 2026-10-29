import { NxNCube } from './core/nxn.js';
import { parseAlg, formatAlg, invertMoves, mirrorMoves, simplify, metrics } from './core/notation.js';
// ?v=… : GitHub Pages laisse le navigateur garder les fichiers 10 min ; changer le numéro force le rechargement.
import { PUZZLES, DEFAULT_PUZZLE } from './puzzles/registry.js?v=3';
import * as Store from './storage.js';
import * as Stats from './stats.js';
import { Timer } from './timer.js';
import { renderNet } from './render2d.js';
import { solver, runGenerator } from './solver/client.js';
import { caseState, maskedSolved, MOVE_BASES } from './solver/generator.js';
import { normalizeOrientation } from './core/orientation.js';

const $ = sel => document.querySelector(sel);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

let data = Store.load();
let puzzleId = PUZZLES[data.puzzle]?.available ? data.puzzle : DEFAULT_PUZZLE;
let scramble = '';
let activeTab = 'timer';
let openSolveIndex = null;

const cubes = {};
const cube = () => (cubes[puzzleId] ||= new NxNCube(PUZZLES[puzzleId].n));
const settings = () => data.settings;
const precision = () => Number(settings().precision);
const persist = () => Store.save(data);

function session() {
  let s = data.sessions.find(x => x.id === data.current[puzzleId] && x.puzzle === puzzleId);
  if (!s) {
    s = data.sessions.find(x => x.puzzle === puzzleId);
    if (!s) {
      s = Store.newSession(puzzleId, 'Session 1');
      data.sessions.push(s);
    }
    data.current[puzzleId] = s.id;
    persist();
  }
  return s;
}

/* ---------- Sélecteurs ---------- */
function renderSelectors() {
  $('#puzzle').innerHTML = Object.values(PUZZLES)
    .map(p => `<option value="${p.id}" ${p.id === puzzleId ? 'selected' : ''} ${p.available ? '' : 'disabled'}>${p.name}${p.available ? '' : ' (bientôt)'}</option>`)
    .join('');
  const current = session();
  $('#session').innerHTML = data.sessions
    .filter(s => s.puzzle === puzzleId)
    .map(s => `<option value="${s.id}" ${s.id === current.id ? 'selected' : ''}>${esc(s.name)} (${s.solves.length})</option>`)
    .join('');
}

/* ---------- Mélange ---------- */
// Le mélange suivant est préparé à l'avance pour qu'il soit prêt dès la fin du solve.
let scrambleToken = 0;
let prefetched = null;
const fetchScramble = () => PUZZLES[puzzleId].scramble({ type: settings().scrambleType });

async function newScramble() {
  const token = ++scrambleToken;
  const pending = prefetched || fetchScramble();
  prefetched = fetchScramble();
  const slow = setTimeout(() => { if (token === scrambleToken) $('#scramble').textContent = 'Génération du mélange…'; }, 80);
  const s = await pending;
  clearTimeout(slow);
  if (token !== scrambleToken) return;
  scramble = s;
  $('#scramble').textContent = scramble;
  $('#preview').innerHTML = renderNet(cube().applyAlg(cube().solved(), scramble), cube().n);
}

function resetScrambles() {
  prefetched = null;
  newScramble();
}

/* ---------- Stats et liste ---------- */
function renderStats() {
  const solves = session().solves;
  const vals = solves.map(Stats.value);
  const sum = Stats.summary(vals);
  const p = precision();

  if (!sum.count) {
    $('#stats').innerHTML = '<p class="empty">Les stats apparaîtront après ton premier solve.</p>';
  } else {
    $('#stats').innerHTML = `
      <table>
        <thead><tr><th></th><th>Actuel</th><th>Meilleur</th></tr></thead>
        <tbody>${sum.rows.map(r => `<tr><td>${r.label}</td><td>${Stats.fmt(r.current, { precision: p, avg: r.avg })}</td><td>${Stats.fmt(r.best, { precision: p, avg: r.avg })}</td></tr>`).join('')}</tbody>
      </table>
      <div class="meta"><span>Solves : ${sum.finished}/${sum.count}</span><span>Moyenne : ${Stats.fmt(sum.mean, { precision: p, avg: true })}</span></div>`;
  }

  const best = vals.length ? Math.min(...vals) : null;
  const rows = [];
  for (let i = solves.length - 1; i >= 0; i--) {
    const isBest = vals[i] === best && best !== Stats.DNF;
    rows.push(`<tr data-i="${i}">
      <td>${i + 1}</td>
      <td class="${isBest ? 'best' : ''}">${Stats.fmtSolve(solves[i], p)}${solves[i].c ? ' *' : ''}</td>
      <td>${Stats.fmt(Stats.avgAt(vals, i, 5), { precision: p, avg: true })}</td>
      <td>${Stats.fmt(Stats.avgAt(vals, i, 12), { precision: p, avg: true })}</td>
    </tr>`);
  }
  $('#solves-body').innerHTML = rows.join('');
  $('#solves-empty').hidden = solves.length > 0;
  renderSelectors();
}

function setPenalty(i, pen) {
  const s = session().solves[i];
  if (!s) return;
  s.p = pen;
  persist();
  renderStats();
  if (i === session().solves.length - 1) showLastTime();
}

function deleteSolve(i) {
  if (!session().solves[i]) return;
  if (!confirm('Supprimer ce solve ?')) return;
  session().solves.splice(i, 1);
  persist();
  renderStats();
  $('#last-actions').hidden = true;
  $('#timer').textContent = Stats.fmt(0, { precision: precision() });
}

function showLastTime() {
  const last = session().solves.at(-1);
  if (last) $('#timer').textContent = Stats.fmtSolve(last, precision());
}

/* ---------- Timer ---------- */
const HINTS = {
  idle: () => (settings().inspection ? 'Espace (ou appui) pour lancer l\'inspection' : 'Maintiens Espace puis relâche pour démarrer'),
  inspect: () => 'Maintiens Espace puis relâche pour démarrer · Échap pour annuler',
  hold: () => 'Attends le vert…',
  ready: () => 'Relâche pour démarrer',
  running: () => '',
  stopped: () => HINTS.idle(),
};

function runningText(ms) {
  const mode = settings().runningDisplay;
  if (mode === 'hidden') return 'solve';
  if (mode === 'seconds') return String(Math.floor(ms / 1000));
  return Stats.fmt(ms, { precision: precision() });
}

function inspectionText(elapsed) {
  if (elapsed < 15000) return String(15 - Math.floor(elapsed / 1000));
  return elapsed < 17000 ? '+2' : 'DNF';
}

const timer = new Timer({
  settings,
  onUpdate(v) {
    const el = $('#timer');
    el.className = 'timer';
    if (v.inspection !== undefined) {
      el.textContent = inspectionText(v.inspection);
      el.classList.add(v.state === 'inspect' ? 'inspect' : v.state);
    } else if (v.state === 'running') {
      el.textContent = runningText(v.ms);
    } else if (v.state === 'hold' || v.state === 'ready') {
      el.classList.add(v.state);
      if (v.state === 'ready') el.textContent = Stats.fmt(0, { precision: precision() });
    }
    document.body.classList.toggle('solving', v.state === 'running');
    document.body.classList.toggle('inspecting', v.inspection !== undefined);
    $('#timer-hint').textContent = HINTS[v.state === 'inspect' || v.inspection !== undefined ? 'inspect' : v.state]?.() ?? '';
    if (v.state === 'ready' && v.inspection !== undefined) $('#timer-hint').textContent = HINTS.ready();
  },
  onSolve({ ms, penalty }) {
    session().solves.push({ t: ms, p: penalty, s: scramble, d: Date.now() });
    persist();
    renderStats();
    showLastTime();
    $('#last-actions').hidden = false;
    $('#timer-hint').textContent = HINTS.idle();
    newScramble();
  },
});

const typing = e => e.target.closest?.('input, textarea, select, [contenteditable]');
const timerActive = () => activeTab === 'timer' && !document.querySelector('dialog[open]');

document.addEventListener('keydown', e => {
  if (!timerActive() || typing(e)) return;
  if (timer.keyDown(e.code, e.repeat)) e.preventDefault();
});
document.addEventListener('keyup', e => {
  if (!timerActive() || typing(e)) return;
  if (timer.keyUp(e.code)) e.preventDefault();
});
const zone = $('#timer-zone');
zone.addEventListener('pointerdown', e => { if (e.button === 0) { e.preventDefault(); timer.pointerDown(); } });
zone.addEventListener('pointerup', e => { if (e.button === 0) timer.pointerUp(); });
// Arrêt au toucher n'importe où pendant un solve (mobile).
document.addEventListener('pointerdown', e => {
  if (timer.state === 'running' && !zone.contains(e.target)) timer.pointerDown();
});

/* ---------- Boutons ---------- */
// Évite qu'Espace ne « clique » sur le dernier bouton focalisé.
document.addEventListener('click', e => { if (e.target.closest('button')) e.target.closest('button').blur(); });

$('#new-scramble').onclick = newScramble;
$('#copy-scramble').onclick = () => navigator.clipboard?.writeText(scramble);
$('#last-actions').addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b) return;
  const i = session().solves.length - 1;
  if (b.hasAttribute('data-del')) deleteSolve(i);
  else setPenalty(i, b.dataset.pen);
});

$('#solves-body').addEventListener('click', e => {
  const tr = e.target.closest('tr');
  if (tr) openSolve(Number(tr.dataset.i));
});

function openSolve(i) {
  const s = session().solves[i];
  if (!s) return;
  openSolveIndex = i;
  $('#solve-title').textContent = `Solve n°${i + 1} · ${Stats.fmtSolve(s, precision())}`;
  $('#solve-date').textContent = new Date(s.d).toLocaleString('fr-FR');
  $('#solve-scramble').textContent = s.s;
  $('#solve-comment').value = s.c || '';
  $('#solve-dialog').showModal();
}

$('#solve-dialog').addEventListener('click', e => {
  const b = e.target.closest('button[data-pen], button[data-del]');
  if (!b || openSolveIndex === null) return;
  if (b.hasAttribute('data-del')) {
    deleteSolve(openSolveIndex);
    $('#solve-dialog').close();
  } else {
    setPenalty(openSolveIndex, b.dataset.pen);
    openSolve(openSolveIndex);
  }
});
$('#solve-dialog').addEventListener('close', () => {
  const s = session().solves[openSolveIndex];
  if (s) {
    const c = $('#solve-comment').value.trim();
    if (c) s.c = c; else delete s.c;
    persist();
    renderStats();
  }
  openSolveIndex = null;
});

/* ---------- Puzzle et sessions ---------- */
$('#puzzle').onchange = e => {
  puzzleId = e.target.value;
  data.puzzle = puzzleId;
  persist();
  prefetched = null;
  refreshAll();
};
$('#session').onchange = e => {
  data.current[puzzleId] = e.target.value;
  persist();
  refreshAll();
};

/* ---------- Réglages ---------- */
const form = $('#settings-dialog form');
$('#settings-btn').onclick = () => {
  const s = settings();
  form.scrambleType.value = s.scrambleType;
  form.inspection.checked = s.inspection;
  form.voice.checked = s.voice;
  form.holdMs.value = String(s.holdMs);
  form.precision.value = String(s.precision);
  form.runningDisplay.value = s.runningDisplay;
  $('#settings-dialog').showModal();
};
form.addEventListener('change', () => {
  const scrambleChanged = form.scrambleType.value !== data.settings.scrambleType;
  Object.assign(data.settings, {
    scrambleType: form.scrambleType.value,
    inspection: form.inspection.checked,
    voice: form.voice.checked,
    holdMs: Number(form.holdMs.value),
    precision: Number(form.precision.value),
    runningDisplay: form.runningDisplay.value,
  });
  persist();
  timer.cancel();
  renderStats();
  showLastTime();
  if (scrambleChanged) resetScrambles();
});

$('#session-new').onclick = () => {
  const count = data.sessions.filter(s => s.puzzle === puzzleId).length;
  const name = prompt('Nom de la nouvelle session', `Session ${count + 1}`);
  if (!name) return;
  const s = Store.newSession(puzzleId, name.trim());
  data.sessions.push(s);
  data.current[puzzleId] = s.id;
  persist();
  refreshAll();
};
$('#session-rename').onclick = () => {
  const s = session();
  const name = prompt('Nouveau nom', s.name);
  if (!name) return;
  s.name = name.trim();
  persist();
  renderSelectors();
};
$('#session-delete').onclick = () => {
  const s = session();
  if (!confirm(`Supprimer « ${s.name} » et ses ${s.solves.length} solves ?`)) return;
  data.sessions = data.sessions.filter(x => x.id !== s.id);
  delete data.current[puzzleId];
  persist();
  refreshAll();
};
$('#export-btn').onclick = () => {
  const blob = new Blob([Store.exportJSON(data)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `cubelab-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
};
$('#import-btn').onclick = () => $('#import-file').click();
$('#import-file').onchange = async e => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const imported = Store.importJSON(await file.text());
    if (!confirm(`Remplacer les données actuelles par ${imported.sessions.length} session(s) importée(s) ?`)) return;
    data = imported;
    persist();
    refreshAll();
  } catch (err) {
    alert(`Import impossible : ${err.message}`);
  } finally {
    e.target.value = '';
  }
};

/* ---------- Onglets ---------- */
// Le puzzle et la session ne concernent que le timer (et bientôt les stats).
const TABS_WITH_SESSION = ['timer', 'stats'];

document.querySelectorAll('.tab[data-tab]').forEach(tab => {
  tab.onclick = () => {
    activeTab = tab.dataset.tab;
    timer.cancel();
    document.querySelectorAll('.tab[data-tab]').forEach(t => {
      t.classList.toggle('active', t === tab);
      if (t === tab) t.setAttribute('aria-current', 'page'); else t.removeAttribute('aria-current');
    });
    document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.id === `view-${activeTab}`));
    $('#page-title').textContent = tab.dataset.title;
    $('.selectors').hidden = !TABS_WITH_SESSION.includes(activeTab);
    if (activeTab === 'lab') renderLab();
    if (activeTab === 'gen') renderGenCase();
  };
});

function showTab(name) {
  document.querySelector(`.tab[data-tab="${name}"]`).click();
}

/* ---------- Algos ---------- */
// Sélecteurs propres à la bibliothèque : cube (puzzles disponibles) puis ensemble d'algos de ce cube.
let algosPuzzle = DEFAULT_PUZZLE;
let algosSet = PUZZLES[DEFAULT_PUZZLE].algSets?.[0]?.id;

const radioChips = (name, items, current) => items
  .map(it => `<label class="chip"><input type="radio" name="${name}" value="${it.id}" ${it.id === current ? 'checked' : ''}><span>${esc(it.name)}</span></label>`)
  .join('');

function renderAlgos() {
  const sets = PUZZLES[algosPuzzle].algSets || [];
  if (!sets.some(s => s.id === algosSet)) algosSet = sets[0]?.id;
  $('#algos-puzzle').innerHTML = radioChips('algos-puzzle', Object.values(PUZZLES).filter(p => p.available), algosPuzzle);
  $('#algos-set').innerHTML = radioChips('algos-set', sets, algosSet);
}

$('#algos-puzzle').addEventListener('change', e => { algosPuzzle = e.target.value; renderAlgos(); });
$('#algos-set').addEventListener('change', e => { algosSet = e.target.value; renderAlgos(); });
renderAlgos();

/* ---------- Labo d'algos ---------- */
let labState = null;

function renderLab() {
  labState = null;
  $('#lab-solution').hidden = true;
  const input = $('#alg-input').value;
  const mode = document.querySelector('input[name="lab-mode"]:checked').value;
  const c = cube();
  const err = $('#lab-error');
  let moves;
  try {
    moves = parseAlg(input);
    err.hidden = true;
  } catch (e) {
    err.textContent = e.message;
    err.hidden = false;
    return;
  }
  let state;
  try {
    state = c.apply(c.solved(), mode === 'case' ? invertMoves(moves) : moves);
  } catch (e) {
    err.textContent = e.message;
    err.hidden = false;
    return;
  }
  $('#lab-net').innerHTML = renderNet(state, c.n);
  labState = state;

  if (!moves.length) {
    $('#lab-info').innerHTML = '<p class="muted">Tape un algo pour voir son effet, son inverse, son miroir et ses métriques.</p>';
    return;
  }
  const flat = simplify(moves);
  const m = metrics(flat);
  const solves = c.isSolved(c.apply(c.solved(), moves));
  const line = (label, value, copy = true) =>
    `<dt>${label}</dt><dd>${esc(value)}${copy ? ` <button class="btn ghost copy" data-copy="${esc(value)}">copier</button>` : ''}</dd>`;
  $('#lab-info').innerHTML = `<dl>
    ${line('Développé', formatAlg(flat))}
    ${line('Inverse', formatAlg(simplify(invertMoves(moves))))}
    ${line('Miroir (M)', formatAlg(mirrorMoves(flat)))}
    ${line('Longueur', `${m.htm} HTM · ${m.stm} STM · ${m.qtm} QTM`, false)}
    ${line('Ordre', `${c.order(moves)} (répétitions pour revenir à l'état initial)`, false)}
    <dt>Identité ?</dt><dd>${solves ? '<span class="yes">Oui, le cube revient résolu</span>' : 'Non'}</dd>
  </dl>`;
}

$('#alg-input').addEventListener('input', renderLab);
document.querySelectorAll('input[name="lab-mode"]').forEach(r => r.addEventListener('change', renderLab));
document.addEventListener('click', e => {
  const b = e.target.closest('[data-copy]');
  if (b) navigator.clipboard?.writeText(b.dataset.copy);
});

$('#lab-solve').onclick = async () => {
  const out = $('#lab-solution');
  out.hidden = false;
  if (!labState) { out.textContent = 'Entre d\'abord un algo valide.'; return; }
  const { state } = normalizeOrientation(cube(), labState);
  if (cube().isSolved(state)) { out.textContent = 'Le cube est déjà résolu.'; return; }
  out.textContent = 'Calcul…';
  try {
    const sol = await solver.solve(state);
    const n = sol.split(' ').length;
    out.innerHTML = `<span class="muted">Solution (${n} HTM, deux phases de Kociemba) :</span> <code>${esc(sol)}</code> <button class="btn ghost copy" data-copy="${esc(sol)}">copier</button>`;
  } catch (err) {
    out.textContent = `Impossible : ${err.message}`;
  }
};

$('#lab-to-gen').onclick = () => {
  const mode = document.querySelector('input[name="lab-mode"]:checked').value;
  $('#gen-input').value = $('#alg-input').value;
  document.querySelector(`input[name="gen-mode"][value="${mode === 'case' ? 'alg' : 'setup'}"]`).checked = true;
  showTab('gen');
};

/* ---------- Générateur ---------- */
const DEFAULT_BASES = ['R', 'U', 'F'];
$('#gen-bases').innerHTML = MOVE_BASES
  .map(b => `<label class="chip"><input type="checkbox" value="${b}" ${DEFAULT_BASES.includes(b) ? 'checked' : ''}><span>${b}</span></label>`)
  .join('');

let genRun = null;
let genResults = [];
let genStart = 0;
let genRenderQueued = false;

function genPayload() {
  return {
    alg: $('#gen-input').value,
    mode: document.querySelector('input[name="gen-mode"]:checked').value,
    mask: $('#gen-mask').value,
    bases: [...document.querySelectorAll('#gen-bases input:checked')].map(i => i.value),
    maxLen: Math.max(1, Math.min(20, Number($('#gen-max').value) || 14)),
    preAuf: $('#gen-preauf').checked,
    postAuf: $('#gen-postauf').checked,
  };
}

function renderGenCase() {
  const err = $('#gen-error');
  const p = genPayload();
  if (!p.alg.trim()) {
    err.hidden = true;
    $('#gen-net').innerHTML = renderNet(maskedSolved(p.mask), 3);
    return;
  }
  try {
    $('#gen-net').innerHTML = renderNet(caseState(p), 3);
    err.hidden = true;
  } catch (e) {
    err.textContent = e.message;
    err.hidden = false;
  }
}

function renderGenResults() {
  genRenderQueued = false;
  const sort = $('#gen-sort').value;
  const list = [...genResults].sort((a, b) =>
    sort === 'score' ? a.score - b.score || a.stm - b.stm : a.stm - b.stm || a.score - b.score);
  const shown = list.slice(0, 300);
  $('#gen-body').innerHTML = shown.map(s => `<tr>
      <td class="alg">${esc(s.alg)}</td><td>${s.stm}</td><td>${s.htm}</td><td>${s.score}</td>
      <td class="actions"><button class="btn ghost copy" data-copy="${esc(s.alg)}">copier</button><button class="btn ghost copy" data-lab="${esc(s.alg)}">labo</button></td>
    </tr>`).join('');
  $('#gen-empty').hidden = genResults.length > 0;
  $('#gen-count').textContent = genResults.length
    ? `${genResults.length} algo${genResults.length > 1 ? 's' : ''}${genResults.length > shown.length ? ` (300 affichés)` : ''}`
    : 'Résultats';
}
const queueGenRender = () => { if (!genRenderQueued) { genRenderQueued = true; requestAnimationFrame(renderGenResults); } };

function setGenRunning(running) {
  $('#gen-run').disabled = running;
  $('#gen-stop').disabled = !running;
}

const fmtCount = n => n.toLocaleString('fr-FR');
const elapsed = () => `${((performance.now() - genStart) / 1000).toFixed(1)} s`;

$('#gen-run').onclick = () => {
  const payload = genPayload();
  const err = $('#gen-error');
  try {
    caseState(payload);
    if (!payload.bases.length) throw new Error('Choisis au moins un mouvement');
    err.hidden = true;
  } catch (e) {
    err.textContent = e.message;
    err.hidden = false;
    return;
  }
  genRun?.stop();
  genResults = [];
  renderGenResults();
  genStart = performance.now();
  setGenRunning(true);
  $('#gen-status').textContent = 'Préparation des tables…';
  genRun = runGenerator(payload, {
    onSolutions(sols) { genResults.push(...sols); queueGenRender(); },
    onProgress(p) {
      $('#gen-status').textContent = `Longueur ${p.length} · ${fmtCount(p.nodes)} positions · ${elapsed()}`;
    },
    onDone(d) {
      setGenRunning(false);
      genRun = null;
      $('#gen-status').textContent = `Terminé en ${elapsed()} · ${fmtCount(d.nodes)} positions explorées`;
      renderGenResults();
    },
    onError(e) {
      setGenRunning(false);
      genRun = null;
      $('#gen-status').textContent = '';
      err.textContent = e.message;
      err.hidden = false;
    },
  });
};

$('#gen-stop').onclick = () => {
  genRun?.stop();
  genRun = null;
  setGenRunning(false);
  $('#gen-status').textContent = `Arrêté après ${elapsed()}`;
  renderGenResults();
};

$('#gen-sort').onchange = renderGenResults;
$('#gen-input').addEventListener('input', renderGenCase);
document.querySelectorAll('input[name="gen-mode"]').forEach(r => r.addEventListener('change', renderGenCase));
$('#gen-mask').addEventListener('change', () => {
  // Pour les F2L, l'AUF n'a pas de sens.
  const f2l = $('#gen-mask').value === 'f2l';
  $('#gen-postauf').checked = !f2l;
  renderGenCase();
});
$('#gen-body').addEventListener('click', e => {
  const b = e.target.closest('[data-lab]');
  if (!b) return;
  $('#alg-input').value = b.dataset.lab;
  document.querySelector('input[name="lab-mode"][value="case"]').checked = true;
  showTab('lab');
});

/* ---------- Démarrage ---------- */
function refreshAll() {
  if (!PUZZLES[puzzleId]?.available) puzzleId = DEFAULT_PUZZLE;
  renderSelectors();
  renderStats();
  newScramble();
  $('#last-actions').hidden = true;
  $('#timer').textContent = Stats.fmt(0, { precision: precision() });
  $('#timer-hint').textContent = HINTS.idle();
  if (activeTab === 'lab') renderLab();
}

refreshAll();
