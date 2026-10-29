import { NxNCube } from './core/nxn.js';
import { parseAlg, formatAlg, invertMoves, mirrorMoves, simplify, metrics } from './core/notation.js';
// ?v=… : GitHub Pages laisse le navigateur garder les fichiers 10 min ; changer le numéro force le rechargement.
import { PUZZLES, DEFAULT_PUZZLE } from './puzzles/registry.js?v=6';
import * as Store from './storage.js?v=6';
import * as Stats from './stats.js?v=10';
import { Timer } from './timer.js?v=17';
import { connectGanTimer, bluetoothAvailable, STATES as GAN } from './devices/gan-timer.js?v=17';
import { picker } from './picker.js?v=16';
import { renderNet, renderLL } from './render2d.js?v=7';
import { ALG_SETS, caseState as algCaseState, solvesCase, caseWeights, pickWeighted, randomCaseState, reverseSetup, stateAfter } from './algsets/index.js?v=15';
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
// Mêmes menus déroulants que l'onglet Algos ; seuls les puzzles disponibles sont proposés.
const timerPuzzlePicker = picker($('#puzzle'), {
  label: 'Cube',
  onChange(id) {
    puzzleId = id;
    data.puzzle = puzzleId;
    persist();
    prefetched = null;
    refreshAll();
  },
});
const sessionPicker = picker($('#session'), {
  label: 'Session',
  onChange(id) {
    data.current[puzzleId] = id;
    persist();
    refreshAll();
  },
});

function renderSelectors() {
  timerPuzzlePicker.set(Object.values(PUZZLES).filter(p => p.available), puzzleId);
  const current = session();
  sessionPicker.set(data.sessions
    .filter(s => s.puzzle === puzzleId)
    .map(s => ({ id: s.id, name: `${s.name} (${s.solves.length})` })), current.id);
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
  idle: () => (settings().inspection ? 'Espace pour lancer l\'inspection' : 'Maintiens Espace puis relâche pour démarrer'),
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

const typing = e => e.target.closest?.('textarea, input[type="text"], input[type="number"], [contenteditable]');
// Timer qui reçoit le clavier : celui du Timer ou celui du Trainer, selon l'onglet.
const activeTimer = () => {
  if (document.querySelector('dialog[open]')) return null;
  if (activeTab === 'timer') return timer;
  if (activeTab === 'trainer' && training) return trainerTimer;
  return null;
};

// Espace pilote le chrono même si un bouton ou un menu a le focus : écoute en phase de capture,
// avant l'élément focalisé, qui ne reçoit donc pas la touche.
const timerKey = (e, handler) => {
  const t = activeTimer();
  if (!t || typing(e)) return;
  if (e.code === 'Space') document.activeElement?.blur?.();
  if (handler(t)) { e.preventDefault(); e.stopPropagation(); }
};
document.addEventListener('keydown', e => timerKey(e, t => t.keyDown(e.code, e.repeat)), true);
document.addEventListener('keyup', e => timerKey(e, t => t.keyUp(e.code)), true);
const zone = $('#timer-zone');
// Au clavier, seule la barre d'espace pilote le chrono (la souris ne fait rien).
// Sur écran tactile, sans barre d'espace, l'appui sur la zone du chrono la remplace.
const isTouch = e => e.pointerType === 'touch';
zone.addEventListener('pointerdown', e => { if (isTouch(e)) { e.preventDefault(); timer.pointerDown(); } });
zone.addEventListener('pointerup', e => { if (isTouch(e)) timer.pointerUp(); });
// Arrêt au toucher n'importe où pendant un solve (mobile).
document.addEventListener('pointerdown', e => {
  if (!isTouch(e)) return;
  if (timer.state === 'running' && !zone.contains(e.target)) timer.pointerDown();
  if (trainerTimer.state === 'running' && !$('#tr-timer-zone').contains(e.target)) trainerTimer.pointerDown();
});

/* ---------- Timer Bluetooth (GAN Smart Timer) ---------- */
// Les événements du tapis pilotent le chrono de l'onglet affiché (Timer ou Trainer).
let ganTimer = null;
const GAN_EVENTS = {
  [GAN.HANDS_ON]: 'hands-on',
  [GAN.GET_SET]: 'ready',
  [GAN.HANDS_OFF]: 'hands-off',
  [GAN.RUNNING]: 'start',
  [GAN.STOPPED]: 'stop',
};

function setDeviceStatus(status) {
  const btn = $('#device-btn');
  btn.dataset.status = status;
  $('#device-label').textContent = {
    connected: 'Timer GAN',
    connecting: 'Connexion…',
    disconnected: 'Connecter le timer',
  }[status];
  btn.title = status === 'connected' ? 'Cliquer pour déconnecter' : '';
}

$('#device-btn').onclick = async () => {
  if (ganTimer) {
    if (!confirm('Déconnecter le timer GAN ?')) return;
    ganTimer.disconnect();
    ganTimer = null;
    setDeviceStatus('disconnected');
    return;
  }
  if (!bluetoothAvailable()) {
    alert('Ce navigateur ne gère pas le Bluetooth. Utilise Chrome ou Edge (ordinateur ou Android).');
    return;
  }
  setDeviceStatus('connecting');
  try {
    ganTimer = await connectGanTimer({
      onEvent(evt) {
        const kind = GAN_EVENTS[evt.state];
        const t = activeTimer();
        if (kind && t) t.device({ kind, ms: evt.ms });
      },
      onStatus(status) { if (ganTimer || status === 'connected') setDeviceStatus(status); },
    });
    setDeviceStatus('connected');
  } catch (err) {
    ganTimer = null;
    setDeviceStatus('disconnected');
    if (err.name !== 'NotFoundError') alert(`Connexion impossible : ${err.message}`); // NotFoundError = fenêtre fermée
  }
};
setDeviceStatus('disconnected');

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
    trainerTimer.cancel();
    document.querySelectorAll('.tab[data-tab]').forEach(t => {
      t.classList.toggle('active', t === tab);
      if (t === tab) t.setAttribute('aria-current', 'page'); else t.removeAttribute('aria-current');
    });
    document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.id === `view-${activeTab}`));
    $('#page-title').textContent = tab.dataset.title;
    $('.selectors').hidden = !TABS_WITH_SESSION.includes(activeTab);
    $('#device-btn').hidden = !['timer', 'trainer'].includes(activeTab);
    if (activeTab === 'lab') renderLab();
    if (activeTab === 'gen') renderGenCase();
    if (activeTab === 'trainer') renderTrainer();
  };
});

function showTab(name) {
  document.querySelector(`.tab[data-tab="${name}"]`).click();
}

/* ---------- Algos ---------- */
// Sélecteurs propres à la bibliothèque : cube (puzzles disponibles) puis ensemble d'algos de ce cube.
let algosPuzzle = DEFAULT_PUZZLE;
let algosSet = PUZZLES[DEFAULT_PUZZLE].algSets?.[0]?.id;

const puzzlePicker = picker($('#algos-puzzle'), {
  label: 'Cube',
  onChange(id) { algosPuzzle = id; openCaseId = null; selection.clear(); renderAlgos(); },
});
const setPicker = picker($('#algos-set'), {
  label: 'Ensemble',
  onChange(id) { algosSet = id; openCaseId = null; selection.clear(); renderAlgos(); },
});

function renderAlgos() {
  const sets = PUZZLES[algosPuzzle].algSets || [];
  if (!sets.some(s => s.id === algosSet)) algosSet = sets[0]?.id;
  puzzlePicker.set(Object.values(PUZZLES).filter(p => p.available), algosPuzzle);
  setPicker.set(sets, algosSet);
  renderAlgoList();
  renderTrainBar();
}

// Les schémas sont calculés une seule fois par cas.
const caseImages = new Map();
const caseImage = c => {
  if (!caseImages.has(c.id)) caseImages.set(c.id, renderLL(algCaseState(c.alg), currentSet().view));
  return caseImages.get(c.id);
};

// Progression de l'utilisateur : algo choisi et statut de chaque cas.
const STATUSES = [
  { id: 'unknown', name: 'Inconnu' },
  { id: 'learning', name: 'En apprentissage' },
  { id: 'learned', name: 'Appris' },
];
const setKey = () => `${algosPuzzle}/${algosSet}`;
const currentSet = () => ALG_SETS[setKey()];
const progressIn = (key, id) => data.algs[key]?.[id] || {};
const progress = id => progressIn(setKey(), id);
const myAlg = c => progress(c.id).alg || c.alg;
const statusOf = c => progress(c.id).status || 'unknown';

const setProgress = (id, patch) => setProgressIn(setKey(), id, patch);
function setProgressIn(key, id, patch) {
  const all = (data.algs[key] ||= {});
  const entry = { ...all[id], ...patch };
  for (const k of Object.keys(entry)) if (!entry[k]) delete entry[k];
  if (Object.keys(entry).length) all[id] = entry; else delete all[id];
  persist();
}

let openCaseId = null;
// Un algo enregistré est verrouillé ; maintenir 1 s dessus le rend modifiable.
let editingCaseId = null;
const UNLOCK_MS = 1000;

function caseButton(c) {
  const st = statusOf(c);
  return `<button type="button" class="case ${st}${c.id === openCaseId ? ' open' : ''}${selection.has(c.id) ? ' selected' : ''}" data-case="${c.id}" title="${esc(myAlg(c))}" aria-expanded="${c.id === openCaseId}">
    ${caseImage(c)}<span class="case-name">${esc(c.name)}</span>
  </button>`;
}

function renderAlgoList() {
  const set = currentSet();
  if (!set) {
    $('#algos-list').innerHTML = '<p class="empty">Aucun ensemble d\'algos pour ce cube pour l\'instant.</p>';
    return;
  }
  $('#algos-list').innerHTML = set.SUBSETS.map(sub => {
    const cases = set.CASES.filter(c => c.subset === sub.id);
    if (!cases.length) return '';
    return `<section class="card subset">
      <h2 data-subset-toggle="${sub.id}">${esc(sub.name)} <span class="muted">${cases.length}</span></h2>
      <div class="case-grid">${cases.map(caseButton).join('')}</div>
    </section>`;
  }).join('');
  if (openCaseId) placeCasePanel(false);
}

// Le panneau du cas s'insère sous la rangée de la case cliquée, sur toute la largeur de la grille.
function placeCasePanel(scroll) {
  const set = currentSet();
  const c = set?.CASES.find(x => x.id === openCaseId);
  const btn = c && document.querySelector(`.case[data-case="${c.id}"]`);
  document.querySelector('.case-panel')?.remove();
  if (!btn) { openCaseId = null; return; }
  if (editingCaseId !== c.id) editingCaseId = null;
  const row = [...btn.parentElement.children].filter(el => el.classList.contains('case') && el.offsetTop === btn.offsetTop);
  const panel = document.createElement('div');
  panel.className = 'case-panel';
  panel.innerHTML = `
    <div class="case-panel-img">${caseImage(c)}</div>
    <div class="case-panel-body">
      <div class="case-panel-head">
        <h3>${esc(c.name)}</h3>
        <button type="button" class="btn ghost" data-close-case>Fermer</button>
      </div>
      <div class="stack">
        <label for="case-alg-${c.id}">Mon algo</label>
        <textarea id="case-alg-${c.id}" class="case-alg" rows="2" spellcheck="false" placeholder="${esc(c.alg)}">${esc(progress(c.id).alg || '')}</textarea>
        <div class="case-alg-locked" tabindex="0" role="button" aria-label="Algo verrouillé : maintenir 1 seconde pour modifier" hidden>
          <span class="case-alg-text"></span>
        </div>
      </div>
      <p class="case-check muted"></p>
      <div class="case-times">
        <div class="muted">${caseTimesText('Sans check', progress(c.id).times)}${caseTimesText('Avec check', progress(c.id).timesCheck)}</div>
        ${timesCount(c.id) ? '<button type="button" class="btn ghost danger" data-clear-times>Supprimer les stats</button>' : ''}
      </div>
      <div class="status-pick" role="radiogroup" aria-label="État">
        ${STATUSES.map(s => `<label class="chip status-${s.id}"><input type="radio" name="case-status" value="${s.id}" ${s.id === statusOf(c) ? 'checked' : ''}><span>${s.name}</span></label>`).join('')}
      </div>
    </div>`;
  row.at(-1).after(panel);
  checkCaseAlg(panel, set, c);
  updateLock(panel, c);
  if (scroll) panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function checkCaseAlg(panel, set, c) {
  const input = panel.querySelector('.case-alg');
  const out = panel.querySelector('.case-check');
  const alg = input.value.trim();
  out.className = 'case-check';
  if (!alg) {
    out.innerHTML = `Algo par défaut : <code>${esc(c.alg)}</code>`;
    out.classList.add('muted');
    return;
  }
  try {
    const auf = solvesCase(set, c, alg);
    if (auf === null) { out.textContent = 'Cet algo ne résout pas ce cas'; out.classList.add('error'); }
    else { out.textContent = `✓ Résout le cas${auf ? ` (en faisant ${auf} avant, par rapport au schéma)` : ''}`; out.classList.add('ok'); }
  } catch (e) {
    out.textContent = e.message;
    out.classList.add('error');
  }
}

const timesCount = id => (progress(id).times?.length || 0) + (progress(id).timesCheck?.length || 0);

function caseTimesText(label, times) {
  const st = Stats.timeStats(times);
  if (!st) return `<p>${label} : pas encore de temps.</p>`;
  const f = ms => Stats.fmt(ms, { precision: precision(), avg: true });
  const f1 = ms => Stats.fmt(ms, { precision: precision() });
  return `<p>${label} (${st.count}) : moyenne ${f(st.mean)} · médiane ${f(st.median)} · meilleur ${f1(st.best)} · pire ${f1(st.worst)}</p>`;
}

function updateLock(panel, c) {
  const saved = progress(c.id).alg || '';
  const locked = !!saved && editingCaseId !== c.id;
  const box = panel.querySelector('.case-alg-locked');
  box.hidden = !locked;
  panel.querySelector('.case-alg').hidden = locked;
  box.querySelector('.case-alg-text').textContent = saved;
}

// Fige l'algo s'il est valide et enregistré (sortie du champ, Tab, Entrée).
function commitCaseAlg(panel, c) {
  const input = panel.querySelector('.case-alg');
  if (input.value.trim() && input.value.trim() === progress(c.id).alg) editingCaseId = null;
  updateLock(panel, c);
}

let unlockTimer = null;
function startUnlock(box) {
  cancelUnlock();
  box.classList.add('pressing');
  unlockTimer = setTimeout(() => {
    box.classList.remove('pressing');
    const panel = box.closest('.case-panel');
    const c = currentSet().CASES.find(x => x.id === openCaseId);
    editingCaseId = c.id;
    updateLock(panel, c);
    const input = panel.querySelector('.case-alg');
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  }, UNLOCK_MS);
}
function cancelUnlock() {
  clearTimeout(unlockTimer);
  unlockTimer = null;
  document.querySelector('.case-alg-locked.pressing')?.classList.remove('pressing');
}

function openCase(id) {
  openCaseId = openCaseId === id ? null : id;
  document.querySelectorAll('.case[data-case]').forEach(b => {
    const open = b.dataset.case === openCaseId;
    b.classList.toggle('open', open);
    b.setAttribute('aria-expanded', open);
  });
  if (openCaseId) placeCasePanel(true); else document.querySelector('.case-panel')?.remove();
}

function refreshCaseButton(c) {
  document.querySelector(`.case[data-case="${c.id}"]`)?.replaceWith(
    Object.assign(document.createElement('template'), { innerHTML: caseButton(c).trim() }).content.firstChild);
}

$('#algos-list').addEventListener('click', e => {
  const b = e.target.closest('.case[data-case]');
  const sub = e.target.closest('[data-subset-toggle]');
  if (selecting && b) toggleSelect([b.dataset.case]);
  else if (selecting && sub) toggleSelect(currentSet().CASES.filter(c => c.subset === sub.dataset.subsetToggle).map(c => c.id));
  else if (b) openCase(b.dataset.case);
  else if (e.target.closest('[data-close-case]')) openCase(openCaseId);
  else if (e.target.closest('[data-clear-times]')) {
    const c = currentSet().CASES.find(x => x.id === openCaseId);
    if (!confirm(`Supprimer les ${timesCount(c.id)} temps d'entraînement de ${c.name} ?`)) return;
    setProgress(c.id, { times: null, timesCheck: null });
    placeCasePanel(false);
  }
});
$('#algos-list').addEventListener('input', e => {
  if (!e.target.matches('.case-alg')) return;
  const set = currentSet();
  const c = set.CASES.find(x => x.id === openCaseId);
  const panel = e.target.closest('.case-panel');
  checkCaseAlg(panel, set, c);
  // On n'enregistre que les algos valides (ou vide = algo par défaut).
  const alg = e.target.value.trim();
  editingCaseId = c.id;
  if (!panel.querySelector('.case-check').classList.contains('error')) {
    setProgress(c.id, { alg });
    refreshCaseButton(c);
  }
});
$('#algos-list').addEventListener('keydown', e => {
  if (e.target.matches('.case-alg')) {
    const panel = e.target.closest('.case-panel');
    const c = currentSet().CASES.find(x => x.id === openCaseId);
    if (e.key === 'Tab' && !e.shiftKey) {
      // Tab : met l'algo par défaut et le verrouille.
      e.preventDefault();
      e.target.value = c.alg;
      setProgress(c.id, { alg: c.alg });
      refreshCaseButton(c);
      checkCaseAlg(panel, currentSet(), c);
      editingCaseId = null;
      updateLock(panel, c);
      panel.querySelector('.case-alg-locked').focus();
    } else if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      e.target.blur();
    }
  } else if (e.target.matches('.case-alg-locked') && (e.key === 'Enter' || e.key === ' ') && !e.repeat) {
    e.preventDefault();
    startUnlock(e.target);
  }
});
$('#algos-list').addEventListener('keyup', e => { if (e.target.matches('.case-alg-locked')) cancelUnlock(); });
$('#algos-list').addEventListener('focusout', e => {
  if (!e.target.matches('.case-alg')) return;
  const c = currentSet()?.CASES.find(x => x.id === openCaseId);
  if (c) commitCaseAlg(e.target.closest('.case-panel'), c);
});
$('#algos-list').addEventListener('pointerdown', e => {
  const box = e.target.closest('.case-alg-locked');
  if (box && e.button === 0) startUnlock(box);
});
for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) {
  $('#algos-list').addEventListener(ev, e => { if (unlockTimer && (ev !== 'pointerleave' || e.target.closest('.case-alg-locked'))) cancelUnlock(); }, true);
}
$('#algos-list').addEventListener('contextmenu', e => { if (e.target.closest('.case-alg-locked')) e.preventDefault(); });
$('#algos-list').addEventListener('change', e => {
  if (e.target.name !== 'case-status') return;
  const c = currentSet().CASES.find(x => x.id === openCaseId);
  setProgress(c.id, { status: e.target.value === 'unknown' ? '' : e.target.value });
  refreshCaseButton(c);
});
// La rangée change avec la largeur : on replace le panneau.
let lastWidth = innerWidth;
addEventListener('resize', () => {
  if (innerWidth !== lastWidth && openCaseId && activeTab === 'algos') placeCasePanel(false);
  lastWidth = innerWidth;
});


/* ---------- Train : sélection des cas ---------- */
let selecting = false;
const selection = new Set();
const SCRAMBLE_MODES = [{ id: 'inverse', name: 'Reverse' }, { id: 'random', name: 'Aléatoire' }];
const DISTRIBUTIONS = [{ id: 'balanced', name: 'Équilibrée' }, { id: 'realistic', name: 'Réaliste' }];
const CHECK_MODES = [{ id: 'off', name: 'Sans' }, { id: 'on', name: 'Avec' }];
const AUF_MODES = [{ id: 'on', name: 'Avec' }, { id: 'off', name: 'Sans' }];
const trainOpts = {
  scramble: data.trainer?.scramble || 'inverse',
  dist: data.trainer?.dist || 'balanced',
  check: data.trainer?.check || 'off',
  auf: data.trainer?.auf || 'on',
};
// Les temps avec check visuel (cas montré avant l'essai) sont rangés à part.
const timesField = check => (check === 'on' ? 'timesCheck' : 'times');
const scramblePicker = picker($('#train-scramble'), { label: 'Mélange', onChange(id) { trainOpts.scramble = id; } });
const distPicker = picker($('#train-dist'), { label: 'Répartition', onChange(id) { trainOpts.dist = id; } });
const checkPicker = picker($('#train-check'), { label: 'Check visuel', onChange(id) { trainOpts.check = id; } });
const aufPicker = picker($('#train-auf'), { label: 'AUF', onChange(id) { trainOpts.auf = id; } });

function renderTrainBar() {
  $('#view-algos').classList.toggle('selecting', selecting);
  $('#train-bar').hidden = !selecting;
  $('#train-foot').hidden = !selecting;
  $('#train-btn').hidden = selecting || !currentSet();
  if (!selecting) return;
  const set = currentSet();
  const n = selection.size;
  $('#train-count').textContent = `${n} cas sélectionné${n > 1 ? 's' : ''}`;
  $('#train-status').innerHTML = STATUSES.map(st => {
    const ids = set.CASES.filter(c => statusOf(c) === st.id);
    const all = ids.length && ids.every(c => selection.has(c.id));
    return `<button type="button" class="btn status-btn status-${st.id}${all ? ' on' : ''}" data-status="${st.id}" ${ids.length ? '' : 'disabled'}>${st.name} <span class="muted">${ids.length}</span></button>`;
  }).join('');
  scramblePicker.set(SCRAMBLE_MODES, trainOpts.scramble);
  distPicker.set(DISTRIBUTIONS, trainOpts.dist);
  checkPicker.set(CHECK_MODES, trainOpts.check);
  aufPicker.set(AUF_MODES, trainOpts.auf);
  $('#train-start').disabled = !n;
  $('#train-start').textContent = n ? `Lancer (${n})` : 'Lancer';
}

function toggleSelect(ids) {
  const all = ids.every(id => selection.has(id));
  for (const id of ids) all ? selection.delete(id) : selection.add(id);
  renderAlgoList();
  renderTrainBar();
}

function setSelecting(on) {
  selecting = on;
  if (on) {
    openCaseId = null;
    selection.clear();
    // Reprend la sélection précédente si elle porte sur le même ensemble.
    if (data.trainer?.set === setKey()) data.trainer.ids.forEach(id => selection.add(id));
  }
  renderAlgoList();
  renderTrainBar();
}

$('#train-btn').onclick = () => setSelecting(true);
$('#train-cancel').onclick = () => setSelecting(false);
$('#train-all').onclick = () => { currentSet().CASES.forEach(c => selection.add(c.id)); renderAlgoList(); renderTrainBar(); };
$('#train-none').onclick = () => { selection.clear(); renderAlgoList(); renderTrainBar(); };
$('#train-status').addEventListener('click', e => {
  const b = e.target.closest('[data-status]');
  if (b) toggleSelect(currentSet().CASES.filter(c => statusOf(c) === b.dataset.status).map(c => c.id));
});
$('#train-start').onclick = () => {
  if (!selection.size) return;
  data.trainer = { set: setKey(), ids: [...selection], ...trainOpts, active: true };
  persist();
  setSelecting(false);
  training = null;
  showTab('trainer');
};

/* ---------- Trainer ---------- */
let training = null; // { key, set, cases, current: { c, scramble }, next: Promise }
const trHistory = []; // derniers essais de la séance : { key, id, ms }

const trainerTimer = new Timer({
  settings: () => ({ ...settings(), inspection: false }),
  onUpdate(v) {
    const el = $('#tr-timer');
    el.className = 'timer';
    if (v.state === 'running') el.textContent = runningText(v.ms);
    else if (v.state === 'hold' || v.state === 'ready') {
      el.classList.add(v.state);
      if (v.state === 'ready') el.textContent = Stats.fmt(0, { precision: precision() });
    }
    document.body.classList.toggle('solving', v.state === 'running');
    $('#tr-hint').textContent = { hold: 'Attends le vert…', ready: 'Relâche pour démarrer', running: '' }[v.state]
      ?? 'Fais le mélange, puis maintiens Espace et relâche pour démarrer';
  },
  onSolve({ ms }) {
    if (!training?.current) return;
    const { c } = training.current;
    const field = timesField(data.trainer.check);
    const times = [...(progressIn(training.key, c.id)[field] || []), ms];
    setProgressIn(training.key, c.id, { [field]: times });
    trHistory.push({ key: training.key, id: c.id, ms, field });
    $('#tr-timer').textContent = Stats.fmt(ms, { precision: precision() });
    showLastAttempt();
    renderTrainerStats();
    nextAttempt();
  },
});

const trZone = $('#tr-timer-zone');
trZone.addEventListener('pointerdown', e => { if (isTouch(e) && training?.current) { e.preventDefault(); trainerTimer.pointerDown(); } });
trZone.addEventListener('pointerup', e => { if (isTouch(e) && training?.current) trainerTimer.pointerUp(); });

function pickCase() {
  const { set, cases } = training;
  if (data.trainer.dist === 'balanced') return cases[Math.floor(Math.random() * cases.length)];
  const w = caseWeights(set);
  return pickWeighted(cases, c => w.get(c.id));
}

// Prépare un essai : un cas tiré au sort et son mélange.
async function prepareAttempt() {
  const { set, key } = training;
  const c = pickCase();
  const auf = data.trainer.auf !== 'off';
  if (data.trainer.scramble === 'inverse') {
    const setup = reverseSetup(progressIn(key, c.id).alg || c.alg, Math.random, { auf });
    return { c, state: stateAfter(setup), scramble: formatAlg(simplify(setup)) };
  }
  const state = randomCaseState(set, c, Math.random, { auf });
  const sol = await solver.solve(state);
  return { c, state, scramble: formatAlg(invertMoves(parseAlg(sol))) };
}

// Essais déjà affichés : ← revient en arrière, → avance (ou tire un nouveau cas au bout de la liste).
function showAttempt(attempt) {
  training.current = attempt;
  $('#tr-scramble').textContent = attempt.scramble;
  // Check visuel : le cas est montré avant l'essai, tel qu'il se présente (AUF compris).
  const show = data.trainer.check === 'on';
  $('#tr-preview').hidden = !show;
  if (show) {
    $('#tr-preview').innerHTML = `${renderLL(attempt.state, training.set.view)}<strong>${esc(attempt.c.name)}</strong>`;
  }
}

function prevAttempt() {
  const t = training;
  if (!t || t.pos <= 0) return;
  showAttempt(t.shown[--t.pos]);
}

async function nextAttempt() {
  const t = training;
  if (t.pos < t.shown.length - 1) { showAttempt(t.shown[++t.pos]); return; }
  if (t.loading) return;
  t.loading = true;
  const pending = t.next || prepareAttempt();
  t.next = null;
  t.current = null;
  const slow = setTimeout(() => { if (training === t) $('#tr-scramble').textContent = 'Génération du mélange…'; }, 80);
  let attempt;
  try {
    attempt = await pending;
  } catch (err) {
    $('#tr-scramble').textContent = `Mélange impossible : ${err.message}`;
    return;
  } finally {
    clearTimeout(slow);
    t.loading = false;
  }
  if (training !== t) return;
  t.shown.push(attempt);
  t.pos = t.shown.length - 1;
  showAttempt(attempt);
  t.next = prepareAttempt(); // le suivant est prêt d'avance
}

function startTraining() {
  const cfg = data.trainer;
  if (!cfg || cfg.active === false) { training = null; return; }
  const set = ALG_SETS[cfg.set];
  const cases = set ? set.CASES.filter(c => cfg.ids.includes(c.id)) : [];
  if (!cases.length) { training = null; return; }
  training = { key: cfg.set, set, cases, current: null, next: null, shown: [], pos: -1, loading: false };
  $('#tr-timer').textContent = Stats.fmt(0, { precision: precision() });
  $('#tr-last').hidden = true;
  $('#tr-preview').hidden = true;
  nextAttempt();
}

function renderTrainer() {
  if (!training) startTraining();
  const on = !!training;
  $('#view-trainer').classList.toggle('empty', !on);
  if (!on) return;
  const [puzzle, setId] = training.key.split('/');
  const setName = PUZZLES[puzzle].algSets.find(x => x.id === setId)?.name;
  const opt = (list, id) => list.find(x => x.id === id).name.toLowerCase();
  $('#tr-summary').innerHTML = `<strong>${esc(PUZZLES[puzzle].name)} · ${esc(setName)}</strong>
    <span class="muted">${training.cases.length} cas · mélange ${opt(SCRAMBLE_MODES, data.trainer.scramble)} · répartition ${opt(DISTRIBUTIONS, data.trainer.dist)}
      · ${opt(CHECK_MODES, data.trainer.check || 'off')} check visuel · ${opt(AUF_MODES, data.trainer.auf || 'on')} AUF</span>`;
  $('#tr-hint').textContent = 'Fais le mélange, puis maintiens Espace et relâche pour démarrer';
  renderTrainerStats();
}

function renderTrainerStats() {
  const f = ms => Stats.fmt(ms, { precision: precision(), avg: true });
  const f1 = ms => Stats.fmt(ms, { precision: precision() });
  const field = timesField(data.trainer.check);
  const rows = training.cases.map(c => ({ c, st: Stats.timeStats(progressIn(training.key, c.id)[field]) }));
  // Les plus lents en premier : ce sont eux à travailler.
  rows.sort((a, b) => (b.st?.mean ?? -1) - (a.st?.mean ?? -1));
  $('#tr-stats-body').innerHTML = rows.map(({ c, st }) => `<tr>
    <td>${esc(c.name)}</td><td>${st?.count ?? 0}</td><td>${f(st?.mean)}</td><td>${f(st?.median)}</td><td>${f1(st?.best)}</td><td>${f1(st?.worst)}</td>
  </tr>`).join('');
}

function showLastAttempt() {
  const last = trHistory.at(-1);
  const set = ALG_SETS[last.key];
  const c = set.CASES.find(x => x.id === last.id);
  const alg = progressIn(last.key, c.id).alg || c.alg;
  $('#tr-last').hidden = false;
  $('#tr-last').innerHTML = `
    <div class="tr-last-img">${renderLL(algCaseState(c.alg), set.view)}</div>
    <div class="tr-last-body">
      <div><strong>${esc(c.name)}</strong> · ${Stats.fmt(last.ms, { precision: precision() })}</div>
      <code>${esc(alg)}</code>
    </div>
    <button type="button" class="btn ghost danger" id="tr-undo">Supprimer ce temps</button>`;
}

$('#tr-last').addEventListener('click', e => {
  if (!e.target.closest('#tr-undo')) return;
  const last = trHistory.pop();
  if (!last) return;
  const times = [...(progressIn(last.key, last.id)[last.field] || [])];
  const i = times.lastIndexOf(last.ms);
  if (i >= 0) times.splice(i, 1);
  setProgressIn(last.key, last.id, { [last.field]: times.length ? times : null });
  $('#tr-last').hidden = true;
  renderTrainerStats();
});
$('#tr-skip').onclick = () => { if (training) nextAttempt(); };
// Flèches gauche/droite : essai précédent / suivant (chrono à l'arrêt).
document.addEventListener('keydown', e => {
  if (activeTab !== 'trainer' || !training || trainerTimer.busy || typing(e) || document.querySelector('dialog[open]')) return;
  if (e.key === 'ArrowRight') { e.preventDefault(); nextAttempt(); }
  else if (e.key === 'ArrowLeft') { e.preventDefault(); prevAttempt(); }
});
$('#tr-choose').onclick = () => { showTab('algos'); setSelecting(true); };
// Quitter : l'entraînement s'arrête, la sélection est gardée pour la prochaine fois.
$('#tr-quit').onclick = () => {
  trainerTimer.cancel();
  if (data.trainer) data.trainer.active = false;
  persist();
  training = null;
  trHistory.length = 0;
  showTab('algos');
};
$('#tr-edit').onclick = () => {
  const [puzzle, setId] = (data.trainer?.set || '').split('/');
  if (PUZZLES[puzzle]) { algosPuzzle = puzzle; algosSet = setId; }
  showTab('algos');
  renderAlgos();
  setSelecting(true);
};

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
