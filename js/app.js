import { NxNCube } from './core/nxn.js';
import { parseAlg, formatAlg, formatMove, invertMoves, mirrorMoves, simplify, metrics } from './core/notation.js';
// ?v=… : GitHub Pages laisse le navigateur garder les fichiers 10 min ; changer le numéro force le rechargement.
import { PUZZLES, DEFAULT_PUZZLE } from './puzzles/registry.js?v=28';
import * as Store from './storage.js?v=24';
import * as Stats from './stats.js?v=10';
import { renderStatsView, renderSessionsView, renderAlgosView } from './statsview.js?v=27';
import { splitsOf, PHASES, crossAndPairs } from './splits.js?v=33';
import { DRILLS, DrillTimer, drillStats, PAIRS, DIFFICULTIES, difficultyOf, whiteCrossLength, PACES, slowMetrics, Metronome } from './drills.js?v=37';
import { randomMoveScramble } from './core/scramble.js';
import { Timer } from './timer.js?v=17';
import { connectGanTimer, bluetoothAvailable, STATES as GAN } from './devices/gan-timer.js?v=17';
import { connectMoyu32 } from './devices/moyu32.js?v=20';
import { ScrambleGuide } from './scramble-guide.js?v=26';
import { picker } from './picker.js?v=16';
import { renderNet, renderLL, renderF2L } from './render2d.js?v=30';
import { ALG_SETS, caseState as algCaseState, solvesCase, caseWeights, pickWeighted, randomCaseState, reverseSetup, stateAfter, SLOTS, slotAlg, f2lCaseState, solvesF2L, slotView, maskLL } from './algsets/index.js?v=32';
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

// Sessions par défaut : trois sessions principales (comptées dans les stats), une par façon de chronométrer,
// et Casual (hors stats). Depuis une session principale, chaque solve va dans la Main de sa source.
const MAIN_SESSIONS = [
  { role: 'keyboard', name: 'Main Keyboard' },
  { role: 'timer', name: 'Main Timer' },
  { role: 'smart', name: 'Main Smartcube' },
];
const isMain = s => MAIN_SESSIONS.some(m => m.role === s?.role);
const inStats = s => s.stats !== false;

function ensureDefaultSessions(puzzle) {
  let changed = false;
  const mains = MAIN_SESSIONS.map(m => {
    let s = data.sessions.find(x => x.puzzle === puzzle && x.role === m.role);
    if (!s) { s = Store.newSession(puzzle, m.name, { role: m.role }); changed = true; }
    return s;
  });
  if (changed) {
    // Les Main en tête de liste, dans l'ordre Keyboard, Timer, Smartcube.
    data.sessions = [...mains, ...data.sessions.filter(x => !mains.includes(x))];
    if (!data.sessions.some(x => x.puzzle === puzzle && x.role === 'casual')) {
      data.sessions.splice(data.sessions.indexOf(mains[2]) + 1, 0, Store.newSession(puzzle, 'Casual', { role: 'casual', stats: false }));
    }
    // À la création des Main, on se place sur Main Keyboard pour que le tri des solves s'applique.
    data.current[puzzle] = mains[0].id;
    persist();
  }
}

const mainSession = (puzzle, role) => data.sessions.find(x => x.puzzle === puzzle && x.role === role);

function session() {
  ensureDefaultSessions(puzzleId);
  let s = data.sessions.find(x => x.id === data.current[puzzleId] && x.puzzle === puzzleId);
  if (!s) {
    s = mainSession(puzzleId, 'keyboard');
    data.current[puzzleId] = s.id;
    persist();
  }
  return s;
}

// Session affichée dans l'onglet Stats : choisie parmi les sessions comptées dans les stats.
function statsSession() {
  const list = data.sessions.filter(x => x.puzzle === puzzleId && inStats(x));
  const cur = session();
  return list.find(x => x.id === data.statsSession?.[puzzleId]) || (inStats(cur) ? cur : list[0]);
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
    // Dans l'onglet Stats, le choix ne change que la session affichée ; ailleurs, la session en cours.
    if (activeTab === 'stats') (data.statsSession ||= {})[puzzleId] = id;
    else data.current[puzzleId] = id;
    persist();
    refreshAll();
  },
});

function renderSelectors() {
  timerPuzzlePicker.set(Object.values(PUZZLES).filter(p => p.available), puzzleId);
  const forStats = activeTab === 'stats';
  const current = forStats ? statsSession() : session();
  sessionPicker.set(data.sessions
    .filter(s => s.puzzle === puzzleId && (!forStats || inStats(s)))
    .map(s => ({ id: s.id, name: `${s.name} (${s.solves.length})` })), current?.id);
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
  smartScrambleChanged();
  renderPreview();
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
  $('#last-splits').innerHTML = '';
  $('#timer').textContent = Stats.fmt(0, { precision: precision() });
}

function showLastTime() {
  const last = session().solves.at(-1);
  if (last) $('#timer').textContent = Stats.fmtSolve(last, precision());
  $('#last-splits').innerHTML = splitsHtml(last);
}

// « Croix 1.20 · F2L 6.40 · OLL 1.80 · PLL 2.10 » pour un solve au cube connecté.
function splitsHtml(solve, withMoves = false) {
  const sp = splitsOf(solve);
  if (!sp) return '';
  return PHASES.map((ph, k) => `<span><i class="key sq ph${k}"></i>${ph.name} <b>${Stats.fmt(sp.times[ph.id], { precision: precision() })}</b>`
    + `${withMoves ? ` <small>${sp.moves[ph.id]} mvts</small>` : ''}</span>`).join('');
}

/* ---------- Timer ---------- */
const HINTS = {
  idle: () => smartHint() || (settings().inspection ? 'Espace pour lancer l\'inspection' : 'Maintiens Espace puis relâche pour démarrer'),
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
    const solve = { t: ms, p: penalty, s: scramble, d: Date.now() };
    // Source du solve : cube connecté, timer GAN, ou clavier (barre d'espace / appui).
    const source = smart.solveMoves?.length ? 'smart' : solveInput === 'timer' ? 'timer' : 'keyboard';
    solveInput = 'keyboard';
    if (smart.solveMoves?.length) {
      solve.src = 'smart';
      solve.mv = smart.solveMoves; // mouvements du cube connecté : [mouvement, ms depuis le départ]
    }
    smart.solveMoves = null;
    // Depuis une session Main, le solve va dans la Main de sa source (et on l'affiche) ;
    // depuis Casual ou une autre session secondaire, il reste dans la session en cours.
    const target = isMain(session()) ? mainSession(puzzleId, source) : session();
    target.solves.push(solve);
    data.current[puzzleId] = target.id;
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
  if (activeTab === 'drills') return drillTimer;
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
let solveInput = 'keyboard'; // qui a lancé le chrono en cours : 'keyboard' ou 'timer' (le cube est repéré à part)
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
  // « Connecter le » est masqué sur mobile pour que les boutons tiennent sur une ligne.
  $('#device-label').innerHTML = {
    connected: 'Timer GAN',
    connecting: 'Connexion…',
    disconnected: '<span class="long">Connecter le timer</span><span class="short">Timer</span>',
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
        if (kind === 'start') {
          solveInput = 'timer';
          smart.solveMoves = smart.conn ? [] : null; // le cube connecté enregistre les mouvements de ce solve
        }
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

/* ---------- Cube connecté (MoYu WeiLong V10 AI) ---------- */
// L'état du vrai cube est suivi mouvement par mouvement. Dans le Timer : le mélange fait est détecté,
// le chrono part au premier mouvement (après l'inspection si elle est activée) et s'arrête cube résolu.
// sinceSolved : mouvements faits depuis la dernière fois que le cube était résolu ; guide : suivi du mélange.
const smart = { conn: null, state: null, phase: 'idle', solveMoves: null, start: 0, battery: null, sinceSolved: [], guide: null };
const cube3 = new NxNCube(3);
const sameState = (a, b) => a && b && a.every((v, i) => v === b[i]);
const scrambleState = () => cube3.applyAlg(cube3.solved(), scramble || '');
// Dans le Timer, le cube connecté détecte le mélange et enregistre les mouvements du solve.
// Sans timer GAN, il pilote aussi le chrono ; avec le timer GAN, c'est le tapis qui chronomètre.
const smartTimes = () => !!smart.conn && activeTab === 'timer';
const cubeDrivesClock = () => smartTimes() && !ganTimer;

function setCubeStatus(status) {
  $('#cube-btn').dataset.status = status;
  $('#cube-label').innerHTML = status === 'connected'
    ? `Cube<span class="long"> MoYu</span>${smart.battery != null ? ` · ${smart.battery} %` : ''}`
    : status === 'connecting' ? 'Connexion…' : '<span class="long">Connecter le cube</span><span class="short">Cube</span>';
  $('#cube-btn').title = status === 'connected' ? 'Cliquer pour déconnecter' : '';
  $('#smart-bar').hidden = status !== 'connected';
  renderPreview();
}

function renderPreview() {
  const live = smart.conn && smart.state;
  $('#preview').innerHTML = renderNet(live ? smart.state : cube().applyAlg(cube().solved(), scramble || ''), cube().n);
  $('#preview').classList.toggle('live', !!live);
  if (smartTimes() && (timer.state === 'idle' || timer.state === 'stopped')) $('#timer-hint').textContent = HINTS.idle();
}

// Texte sous le chrono quand le cube connecté pilote le Timer.
function smartHint() {
  if (!smartTimes()) return '';
  if (!smart.state) return 'Lecture de l\'état du cube…';
  if (smart.phase !== 'ready') return 'Fais le mélange sur le cube';
  return ganTimer ? 'Mélange fait : pose les mains sur le timer' : 'Mélange fait : le chrono part au premier mouvement';
}

// Nouveau mélange : on attend que le vrai cube y arrive, en le guidant mouvement par mouvement.
function smartScrambleChanged() {
  if (!smart.conn || smart.phase === 'running') return;
  smart.phase = 'scrambling';
  smart.guide = scramble ? new ScrambleGuide(cube3, parseAlg(scramble), smart.sinceSolved) : null;
  checkScrambled();
  renderScramble();
}

// Mélange affiché : texte simple, ou suivi (fait / en cours / erreur) quand le cube connecté mélange.
function renderScramble() {
  const g = smart.guide;
  if (!g || !smartTimes() || !['scrambling', 'ready'].includes(smart.phase)) {
    $('#scramble').textContent = scramble;
    return;
  }
  const ready = smart.phase === 'ready';
  const fix = g.correction;
  const moves = g.moves.map((m, i) => {
    const cls = ready || i < g.k ? 'done' : i === g.k ? (fix ? 'cur wrong' : g.partial ? 'cur half' : 'cur') : '';
    return `<span class="scr-move ${cls}">${esc(formatMove(m))}</span>`;
  }).join(' ');
  let note = '';
  if (fix) note = `<div class="scr-note wrong">Pour revenir : <b>${esc(formatAlg(fix))}</b></div>`;
  else if (g.partial) note = `<div class="scr-note half">Encore <b>${esc(formatMove(g.dev[0]))}</b> pour finir ${esc(formatMove(g.moves[g.k]))}</div>`;
  $('#scramble').innerHTML = moves + note;
}

function checkScrambled() {
  if (smart.phase !== 'scrambling' || !smartTimes() || !sameState(smart.state, scrambleState())) return;
  smart.phase = 'ready';
  if (settings().inspection && timer.state !== 'running') timer.startInspection();
}

function onSmartMove(move) {
  const parsed = parseAlg(move);
  smart.state = cube3.apply(smart.state, parsed);
  smart.sinceSolved = cube3.isSolved(smart.state) ? [] : simplify([...smart.sinceSolved, ...parsed]);
  if ((smart.phase === 'scrambling' || smart.phase === 'ready') && smart.guide) smart.guide.move(parsed[0]);
  const now = performance.now();
  drillSmartMove(now);
  if (smartTimes() && !cubeDrivesClock()) {
    // Avec le timer GAN : on enregistre les mouvements pendant que le chrono tourne.
    if (timer.state === 'running') (smart.solveMoves ||= []).push([move, Math.round(now - timer.startTime)]);
    else if (smart.phase === 'scrambling') checkScrambled();
    else if (smart.phase === 'ready' && !sameState(smart.state, scrambleState())) smart.phase = 'scrambling';
  } else if (smartTimes()) {
    if (smart.phase === 'ready') {
      // Premier mouvement après le mélange : départ.
      timer.device({ kind: 'start' });
      smart.phase = 'running';
      smart.start = now;
      smart.solveMoves = [];
    }
    if (smart.phase === 'running') {
      smart.solveMoves.push([move, Math.round(now - smart.start)]);
      if (cube3.isSolved(smart.state)) {
        smart.phase = 'scrambling';
        timer.device({ kind: 'stop', ms: Math.floor(now - timer.startTime) });
      }
    } else if (smart.phase === 'scrambling') {
      checkScrambled();
    }
  }
  renderPreview();
  renderScramble();
}

$('#cube-btn').onclick = async () => {
  if (smart.conn) {
    if (!confirm('Déconnecter le cube ?')) return;
    smart.conn.disconnect();
    smart.conn = null;
    smart.phase = 'idle';
    smart.guide = null;
    setCubeStatus('disconnected');
    renderScramble();
    return;
  }
  if (!bluetoothAvailable()) {
    alert('Ce navigateur ne gère pas le Bluetooth. Utilise Chrome ou Edge (ordinateur ou Android).');
    return;
  }
  setCubeStatus('connecting');
  try {
    smart.conn = await connectMoyu32({
      onEvent(evt) {
        // L'état envoyé par le cube n'est pas utilisé : à la connexion, le cube est considéré comme résolu.
        if (evt.type === 'battery') { smart.battery = evt.level; setCubeStatus('connected'); }
        else if (evt.type === 'move' && smart.state) onSmartMove(evt.move);
      },
      onStatus(status) { if (smart.conn || status === 'connected') setCubeStatus(status); },
      askMac(name, guess, diag) {
        console.info('[cube MoYu] diagnostic\n' + diag);
        return prompt(`Le cube ${name} ne répond pas avec la bonne clé.\n`
          + 'Adresse MAC (visible dans l\'appli MoYu, ex. cf3016017333) :\n\n'
          + `Diagnostic (version 20) :\n${diag}`, guess ? guess.replace(/:/g, '').toLowerCase() : '');
      },
      // L'adresse validée est retenue : plus besoin de la saisir.
      knownMac: name => data.devices?.[name] || null,
      onMac(name, mac) { (data.devices ||= {})[name] = mac; persist(); },
    });
    smart.state = cube3.solved();
    smart.sinceSolved = [];
    setCubeStatus('connected');
    smartScrambleChanged();
  } catch (err) {
    smart.conn = null;
    setCubeStatus('disconnected');
    if (err.name !== 'NotFoundError') alert(`Connexion impossible : ${err.message}`);
  }
};
// Recaler : le vrai cube est résolu, on repart de l'état résolu.
$('#smart-sync').onclick = () => {
  smart.state = cube3.solved();
  smart.sinceSolved = [];
  smartScrambleChanged();
  renderPreview();
};
setCubeStatus('disconnected');

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

/* ---------- Onglet Stats ---------- */
// Catégories : la session choisie, la comparaison des sessions, l'entraînement des algos.
let statsTab = data.statsTab || 'session';

function renderStatsPage() {
  document.querySelectorAll('#sv-tabs [data-cat]').forEach(b => {
    b.classList.toggle('on', b.dataset.cat === statsTab);
    b.setAttribute('aria-selected', b.dataset.cat === statsTab);
  });
  // Les menus Cube / Session ne servent qu'aux catégories liées aux solves.
  $('.selectors').hidden = statsTab === 'algos';
  const opts = { precision: precision() };
  if (statsTab === 'session') {
    renderStatsView($('#stats-view'), statsSession()?.solves || [], opts);
  } else if (statsTab === 'sessions') {
    const sessions = data.sessions.filter(x => x.puzzle === puzzleId && inStats(x));
    renderSessionsView($('#stats-view'), sessions, { ...opts, current: statsSession()?.id });
  } else {
    const sets = Object.entries(ALG_SETS).map(([key, set]) => {
      const [puzzle, id] = key.split('/');
      return { key, name: `${PUZZLES[puzzle].name} · ${PUZZLES[puzzle].algSets.find(x => x.id === id)?.name}`, set, progress: data.algs[key] || {} };
    });
    renderAlgosView($('#stats-view'), sets, { ...opts, check: data.statsCheck || 'off', image: c => caseImageFor(c) });
  }
}

$('#sv-tabs').addEventListener('click', e => {
  const b = e.target.closest('[data-cat]');
  if (!b) return;
  statsTab = b.dataset.cat;
  data.statsTab = statsTab;
  persist();
  renderStatsPage();
});
$('#stats-view').addEventListener('click', e => {
  // Comparaison : un clic sur une session l'ouvre dans la catégorie Session.
  const row = e.target.closest('[data-session]');
  if (row) {
    (data.statsSession ||= {})[puzzleId] = row.dataset.session;
    statsTab = data.statsTab = 'session';
    persist();
    refreshAll();
    return;
  }
  const chk = e.target.closest('[data-check]');
  if (chk) { data.statsCheck = chk.dataset.check; persist(); renderStatsPage(); }
});
// Les graphiques suivent la largeur de la fenêtre.
let statsWidth = innerWidth;
addEventListener('resize', () => {
  if (activeTab === 'stats' && innerWidth !== statsWidth) renderStatsPage();
  statsWidth = innerWidth;
});

$('#solves-body').addEventListener('click', e => {
  const tr = e.target.closest('tr');
  if (tr) openSolve(Number(tr.dataset.i));
});

function openSolve(i) {
  const s = session().solves[i];
  if (!s) return;
  openSolveIndex = i;
  $('#solve-title').textContent = `Solve n°${i + 1}${s.mv ? ' (cube connecté)' : ''} · ${Stats.fmtSolve(s, precision())}`;
  $('#solve-date').textContent = new Date(s.d).toLocaleString('fr-FR');
  $('#solve-splits').innerHTML = splitsHtml(s, true);
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

// Création / modification d'une session : nom et présence dans l'onglet Stats.
let editedSession = null;
function openSessionDialog(s) {
  editedSession = s;
  const f = $('#session-dialog form');
  $('#session-dialog-title').textContent = s ? 'Modifier la session' : 'Nouvelle session';
  f.name.value = s ? s.name : `Session ${data.sessions.filter(x => x.puzzle === puzzleId).length + 1}`;
  f.stats.checked = s ? inStats(s) : true;
  // Les sessions Main sont toujours dans les stats.
  f.stats.disabled = isMain(s);
  $('#session-main-note').hidden = !isMain(s);
  $('#session-dialog').showModal();
  f.name.select();
}
$('#session-dialog form').addEventListener('submit', e => {
  if (e.submitter?.value !== 'save') return;
  const f = e.target;
  const name = f.name.value.trim();
  if (!name) { e.preventDefault(); return; }
  if (editedSession) {
    editedSession.name = name;
    if (!isMain(editedSession)) editedSession.stats = f.stats.checked;
  } else {
    const s = Store.newSession(puzzleId, name, f.stats.checked ? {} : { stats: false });
    data.sessions.push(s);
    data.current[puzzleId] = s.id;
  }
  persist();
  refreshAll();
});
$('#session-new').onclick = () => openSessionDialog(null);
$('#session-rename').onclick = () => openSessionDialog(session());
$('#session-delete').onclick = () => {
  const s = session();
  if (isMain(s)) { alert(`« ${s.name} » est une session principale : elle ne peut pas être supprimée.`); return; }
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
    drillTimer.cancel();
    document.querySelectorAll('.tab[data-tab]').forEach(t => {
      t.classList.toggle('active', t === tab);
      if (t === tab) t.setAttribute('aria-current', 'page'); else t.removeAttribute('aria-current');
    });
    document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.id === `view-${activeTab}`));
    $('#page-title').textContent = tab.dataset.title;
    $('.selectors').hidden = !TABS_WITH_SESSION.includes(activeTab);
    renderSelectors(); // la liste des sessions diffère dans l'onglet Stats
    $('#device-btn').hidden = !['timer', 'trainer', 'drills'].includes(activeTab);
    $('#cube-btn').hidden = !['timer', 'trainer', 'drills'].includes(activeTab);
    if (activeTab === 'lab') renderLab();
    if (activeTab === 'gen') renderGenCase();
    if (activeTab === 'trainer') renderTrainer();
    if (activeTab === 'drills') renderDrills();
    if (activeTab === 'stats') renderStatsPage();
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
const caseImageFor = c => {
  if (!caseImages.has(c.id)) {
    const set = Object.values(ALG_SETS).find(x => x.CASES.includes(c));
    caseImages.set(c.id, set.view === 'f2l' ? renderF2L(f2lCaseState(c)) : renderLL(algCaseState(c.alg), set.view));
  }
  return caseImages.get(c.id);
};
const caseImage = c => {
  if (!caseImages.has(c.id)) caseImages.set(c.id, currentSet().view === 'f2l' ? renderF2L(f2lCaseState(c)) : renderLL(algCaseState(c.alg), currentSet().view));
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
const myAlg = c => progress(c.id).alg || progress(c.id).slots?.FR || c.alg;
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
// Un algo enregistré est verrouillé ; maintenir 1 s dessus le rend modifiable (« cas/champ » en cours d'édition).
let editingField = null;
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

// Champs d'algo d'un cas : un seul (« Mon algo ») pour OLL/PLL, un par slot (FR, FL, BR, BL) pour la F2L.
function caseFields(set, c) {
  if (set.view === 'f2l') return SLOTS.map(sl => ({ key: sl.id, label: sl.name, def: slotAlg(c, sl.id), slot: sl.id }));
  return [{ key: 'alg', label: 'Mon algo', def: c.alg }];
}
const fieldValue = (c, key) => (key === 'alg' ? progress(c.id).alg : progress(c.id).slots?.[key]) || '';
function setFieldValue(c, key, alg) {
  if (key === 'alg') { setProgress(c.id, { alg }); return; }
  const slots = { ...progress(c.id).slots };
  if (alg) slots[key] = alg; else delete slots[key];
  setProgress(c.id, { slots: Object.keys(slots).length ? slots : null });
}
const fieldOf = (el, c) => caseFields(currentSet(), c).find(f => f.key === el.dataset.field);
const fieldId = (c, key) => `${c.id}/${key}`;

// Le panneau du cas s'insère sous la rangée de la case cliquée, sur toute la largeur de la grille.
function placeCasePanel(scroll) {
  const set = currentSet();
  const c = set?.CASES.find(x => x.id === openCaseId);
  const btn = c && document.querySelector(`.case[data-case="${c.id}"]`);
  document.querySelector('.case-panel')?.remove();
  if (!btn) { openCaseId = null; return; }
  if (!editingField?.startsWith(`${c.id}/`)) editingField = null;
  const row = [...btn.parentElement.children].filter(el => el.classList.contains('case') && el.offsetTop === btn.offsetTop);
  const fields = caseFields(set, c);
  const panel = document.createElement('div');
  panel.className = 'case-panel';
  panel.innerHTML = `
    <div class="case-panel-img">${caseImage(c)}</div>
    <div class="case-panel-body">
      <div class="case-panel-head">
        <h3>${esc(c.name)}</h3>
        <button type="button" class="btn ghost" data-close-case>Fermer</button>
      </div>
      <div class="alg-fields${fields.length > 1 ? ' cols' : ''}">
        ${fields.map(fd => `<div class="alg-field" data-field="${fd.key}">
          <label for="case-alg-${c.id}-${fd.key}">${fd.label}</label>
          <textarea id="case-alg-${c.id}-${fd.key}" class="case-alg" rows="2" spellcheck="false" placeholder="${esc(fd.def)}">${esc(fieldValue(c, fd.key))}</textarea>
          <div class="case-alg-locked" tabindex="0" role="button" aria-label="Algo verrouillé : maintenir 1 seconde pour modifier" hidden>
            <span class="case-alg-text"></span>
          </div>
          <p class="case-check muted"></p>
        </div>`).join('')}
      </div>
      ${set.view === 'f2l' ? variantsHtml(c) : ''}
      <div class="case-times">
        <div class="muted">${caseTimesText('Sans check', progress(c.id).times)}${caseTimesText('Avec check', progress(c.id).timesCheck)}</div>
        ${timesCount(c.id) ? '<button type="button" class="btn ghost danger" data-clear-times>Supprimer les stats</button>' : ''}
      </div>
      <div class="status-pick" role="radiogroup" aria-label="État">
        ${STATUSES.map(s => `<label class="chip status-${s.id}"><input type="radio" name="case-status" value="${s.id}" ${s.id === statusOf(c) ? 'checked' : ''}><span>${s.name}</span></label>`).join('')}
      </div>
    </div>`;
  row.at(-1).after(panel);
  panel.querySelectorAll('.alg-field').forEach(el => { checkCaseAlg(el, c); updateLock(el, c); });
  if (scroll) panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function checkCaseAlg(el, c) {
  const fd = fieldOf(el, c);
  const out = el.querySelector('.case-check');
  const alg = el.querySelector('.case-alg').value.trim();
  out.className = 'case-check';
  if (!alg) {
    out.innerHTML = `Par défaut : <code>${esc(fd.def)}</code>`;
    out.classList.add('muted');
    return;
  }
  try {
    const auf = fd.slot ? solvesF2L(c, fd.slot, alg) : solvesCase(currentSet(), c, alg);
    if (auf === null) { out.textContent = 'Ne résout pas ce cas'; out.classList.add('error'); }
    else { out.textContent = `✓ Résout le cas${auf ? ` (avec ${auf} avant)` : ''}`; out.classList.add('ok'); }
  } catch (e) {
    out.textContent = e.message;
    out.classList.add('error');
  }
}

// ---------- Variantes F2L (slots libres) ----------
function variantsHtml(c) {
  const list = progress(c.id).variants || [];
  const chips = (name, type, checked, disabled = () => false) => SLOTS.map(sl => `<label class="chip"><input type="${type}" name="${name}" value="${sl.id}" ${checked(sl.id) ? 'checked' : ''} ${disabled(sl.id) ? 'disabled' : ''}><span>${sl.name}</span></label>`).join('');
  return `<div class="variants">
    <strong class="variants-title">Variantes avec slots libres</strong>
    ${list.length ? list.map((v, i) => `<div class="variant">
      <span class="variant-tag">${v.slot} · ${v.empty.join(' + ')} libre${v.empty.length > 1 ? 's' : ''}</span>
      <code>${esc(v.alg)}</code>
      <button type="button" class="btn ghost danger" data-del-variant="${i}">Supprimer</button>
    </div>`).join('') : '<p class="muted">Aucune variante pour l\'instant.</p>'}
    <details class="variant-add">
      <summary>+ Ajouter une variante</summary>
      <div class="variant-form">
        <div class="variant-row"><span class="muted">Slot</span><div class="chips">${chips('v-slot', 'radio', id => id === 'FR')}</div></div>
        <div class="variant-row"><span class="muted">Slots libres</span><div class="chips">${chips('v-empty', 'checkbox', () => false, id => id === 'FR')}</div></div>
        <input type="text" class="variant-alg" spellcheck="false" placeholder="Algo de la variante">
        <p class="variant-check muted">Choisis au moins un slot libre et tape l'algo.</p>
        <button type="button" class="btn primary" data-add-variant disabled>Ajouter</button>
      </div>
    </details>
  </div>`;
}

// Lit le formulaire de variante et vérifie l'algo ; renvoie la variante si elle est valide.
function readVariant(form, c) {
  const slot = form.querySelector('[name="v-slot"]:checked').value;
  form.querySelectorAll('[name="v-empty"]').forEach(i => {
    i.disabled = i.value === slot;
    if (i.disabled) i.checked = false;
  });
  const empty = [...form.querySelectorAll('[name="v-empty"]:checked')].map(i => i.value);
  const alg = form.querySelector('.variant-alg').value.trim();
  const out = form.querySelector('.variant-check');
  const add = form.querySelector('[data-add-variant]');
  add.disabled = true;
  out.className = 'variant-check';
  if (!empty.length || !alg) { out.textContent = 'Choisis au moins un slot libre et tape l\'algo.'; out.classList.add('muted'); return null; }
  try {
    const auf = solvesF2L(c, slot, alg, empty);
    if (auf === null) { out.textContent = 'Ne résout pas ce cas avec ces slots libres'; out.classList.add('error'); return null; }
    out.textContent = `✓ Résout le cas en ${slot}${auf ? ` (avec ${auf} avant)` : ''}`;
    out.classList.add('ok');
    add.disabled = false;
    return { slot, empty, alg };
  } catch (e) {
    out.textContent = e.message;
    out.classList.add('error');
    return null;
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

function updateLock(el, c) {
  const saved = fieldValue(c, el.dataset.field);
  const locked = !!saved && editingField !== fieldId(c, el.dataset.field);
  const box = el.querySelector('.case-alg-locked');
  box.hidden = !locked;
  el.querySelector('.case-alg').hidden = locked;
  box.querySelector('.case-alg-text').textContent = saved;
}

// Fige l'algo s'il est valide et enregistré (sortie du champ, Tab, Entrée).
function commitCaseAlg(el, c) {
  const v = el.querySelector('.case-alg').value.trim();
  if (v && v === fieldValue(c, el.dataset.field) && editingField === fieldId(c, el.dataset.field)) editingField = null;
  updateLock(el, c);
}

let unlockTimer = null;
function startUnlock(box) {
  cancelUnlock();
  box.classList.add('pressing');
  unlockTimer = setTimeout(() => {
    box.classList.remove('pressing');
    const el = box.closest('.alg-field');
    const c = currentSet().CASES.find(x => x.id === openCaseId);
    editingField = fieldId(c, el.dataset.field);
    updateLock(el, c);
    const input = el.querySelector('.case-alg');
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

const openCaseObj = () => currentSet()?.CASES.find(x => x.id === openCaseId);

$('#algos-list').addEventListener('click', e => {
  const b = e.target.closest('.case[data-case]');
  const sub = e.target.closest('[data-subset-toggle]');
  if (selecting && b) toggleSelect([b.dataset.case]);
  else if (selecting && sub) toggleSelect(currentSet().CASES.filter(c => c.subset === sub.dataset.subsetToggle).map(c => c.id));
  else if (b) openCase(b.dataset.case);
  else if (e.target.closest('[data-close-case]')) openCase(openCaseId);
  else if (e.target.closest('[data-clear-times]')) {
    const c = openCaseObj();
    if (!confirm(`Supprimer les ${timesCount(c.id)} temps d'entraînement de ${c.name} ?`)) return;
    setProgress(c.id, { times: null, timesCheck: null });
    placeCasePanel(false);
  } else if (e.target.closest('[data-add-variant]')) {
    const c = openCaseObj();
    const v = readVariant(e.target.closest('.variant-form'), c);
    if (!v) return;
    setProgress(c.id, { variants: [...(progress(c.id).variants || []), v] });
    placeCasePanel(false);
  } else if (e.target.closest('[data-del-variant]')) {
    const c = openCaseObj();
    const list = [...(progress(c.id).variants || [])];
    list.splice(Number(e.target.closest('[data-del-variant]').dataset.delVariant), 1);
    setProgress(c.id, { variants: list.length ? list : null });
    placeCasePanel(false);
  }
});
$('#algos-list').addEventListener('input', e => {
  if (e.target.closest('.variant-form')) { readVariant(e.target.closest('.variant-form'), openCaseObj()); return; }
  if (!e.target.matches('.case-alg')) return;
  const c = openCaseObj();
  const el = e.target.closest('.alg-field');
  checkCaseAlg(el, c);
  // On n'enregistre que les algos valides (ou vide = algo par défaut).
  editingField = fieldId(c, el.dataset.field);
  if (!el.querySelector('.case-check').classList.contains('error')) {
    setFieldValue(c, el.dataset.field, e.target.value.trim());
    refreshCaseButton(c);
  }
});
$('#algos-list').addEventListener('keydown', e => {
  if (e.target.matches('.case-alg')) {
    const el = e.target.closest('.alg-field');
    const c = openCaseObj();
    if (e.key === 'Tab' && !e.shiftKey) {
      // Tab : met l'algo par défaut et le verrouille.
      e.preventDefault();
      const def = fieldOf(el, c).def;
      e.target.value = def;
      setFieldValue(c, el.dataset.field, def);
      refreshCaseButton(c);
      checkCaseAlg(el, c);
      editingField = null;
      updateLock(el, c);
      el.querySelector('.case-alg-locked').focus();
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
  const c = openCaseObj();
  if (c) commitCaseAlg(e.target.closest('.alg-field'), c);
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
  if (e.target.closest('.variant-form')) { readVariant(e.target.closest('.variant-form'), openCaseObj()); return; }
  if (e.target.name !== 'case-status') return;
  const c = openCaseObj();
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
  slots: data.trainer?.slots || ['FR'],       // F2L : slots entraînés
  variants: data.trainer?.variants || 'off',  // F2L : variantes (off | on | only)
};
const VARIANT_MODES = [{ id: 'off', name: 'Sans' }, { id: 'on', name: 'Avec' }, { id: 'only', name: 'Seulement' }];
// Les temps avec check visuel (cas montré avant l'essai) sont rangés à part.
const timesField = check => (check === 'on' ? 'timesCheck' : 'times');
const scramblePicker = picker($('#train-scramble'), { label: 'Mélange', onChange(id) { trainOpts.scramble = id; } });
const distPicker = picker($('#train-dist'), { label: 'Répartition', onChange(id) { trainOpts.dist = id; } });
const checkPicker = picker($('#train-check'), { label: 'Check visuel', onChange(id) { trainOpts.check = id; } });
const aufPicker = picker($('#train-auf'), { label: 'AUF', onChange(id) { trainOpts.auf = id; } });
const variantsPicker = picker($('#train-variants'), { label: 'Variantes', onChange(id) { trainOpts.variants = id; renderTrainBar(); } });
$('#train-slots').addEventListener('change', () => {
  trainOpts.slots = [...document.querySelectorAll('#train-slots input:checked')].map(i => i.value);
  renderTrainBar();
});

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
  // F2L : slots à entraîner et variantes.
  const f2l = set.view === 'f2l';
  document.querySelector('.train-f2l').hidden = !f2l;
  if (f2l) {
    $('#train-slots').innerHTML = SLOTS.map(sl => `<label class="chip"><input type="checkbox" value="${sl.id}" ${trainOpts.slots.includes(sl.id) ? 'checked' : ''}><span>${sl.name}</span></label>`).join('');
    variantsPicker.set(VARIANT_MODES, trainOpts.variants);
  }
  const noTarget = f2l && !trainOpts.slots.length && trainOpts.variants !== 'only';
  if (noTarget) $('#train-start').disabled = true;
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
  if (currentSet().view === 'f2l' && trainOpts.variants === 'only'
    && ![...selection].some(id => progress(id).variants?.some(v => trainOpts.slots.includes(v.slot) || !trainOpts.slots.length))) {
    alert('Aucune variante pour ces cas : ajoute des variantes dans leurs fiches, ou choisis « Avec ».');
    return;
  }
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
    const { target } = training.current;
    trHistory.push({ key: training.key, id: c.id, ms, field, alg: target.alg, label: target.label });
    $('#tr-timer').textContent = Stats.fmt(ms, { precision: precision() });
    showLastAttempt();
    renderTrainerStats();
    nextAttempt();
  },
});

const trZone = $('#tr-timer-zone');
trZone.addEventListener('pointerdown', e => { if (isTouch(e) && training?.current) { e.preventDefault(); trainerTimer.pointerDown(); } });
trZone.addEventListener('pointerup', e => { if (isTouch(e) && training?.current) trainerTimer.pointerUp(); });

// Ce qu'on entraîne sur un cas : son algo (OLL/PLL) ; en F2L, un des slots choisis ou une de ses variantes.
function targetsFor(c) {
  const p = progressIn(training.key, c.id);
  if (training.set.view !== 'f2l') return [{ alg: p.alg || c.alg, label: '' }];
  const cfg = data.trainer;
  const slots = cfg.slots || ['FR'];
  const out = cfg.variants === 'only' ? [] : slots.map(id => ({ slot: id, alg: p.slots?.[id] || slotAlg(c, id), label: id }));
  if (cfg.variants === 'on' || cfg.variants === 'only') {
    for (const v of p.variants || []) {
      if (slots.length && !slots.includes(v.slot)) continue;
      out.push({ slot: v.slot, alg: v.alg, label: `${v.slot} · ${v.empty.join(' + ')} libre${v.empty.length > 1 ? 's' : ''}` });
    }
  }
  return out;
}

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
  const targets = targetsFor(c);
  const target = targets[Math.floor(Math.random() * targets.length)];
  const auf = data.trainer.auf !== 'off';
  if (data.trainer.scramble === 'inverse') {
    const setup = reverseSetup(target.alg, Math.random, { auf });
    return { c, target, state: stateAfter(setup), scramble: formatAlg(simplify(setup)) };
  }
  const state = randomCaseState(set, c, Math.random, { auf, setup: target.alg });
  const sol = await solver.solve(state);
  return { c, target, state, scramble: formatAlg(invertMoves(parseAlg(sol))) };
}

// Essais déjà affichés : ← revient en arrière, → avance (ou tire un nouveau cas au bout de la liste).
function showAttempt(attempt) {
  training.current = attempt;
  $('#tr-scramble').textContent = attempt.scramble;
  // Check visuel : le cas est montré avant l'essai, tel qu'il se présente (AUF compris).
  const show = data.trainer.check === 'on';
  $('#tr-preview').hidden = !show;
  if (show) {
    // F2L : le cas est montré vu depuis son slot (ramené devant à droite), avec le slot ou la variante.
    const t = attempt.target;
    const img = training.set.view === 'f2l' ? renderF2L(maskLL(slotView(attempt.state, t.slot))) : renderLL(attempt.state, training.set.view);
    $('#tr-preview').innerHTML = `${img}<strong>${esc(attempt.c.name)}${t.label ? ` · ${esc(t.label)}` : ''}</strong>`;
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
  training = { key: cfg.set, set, cases: [], current: null, next: null, shown: [], pos: -1, loading: false };
  // Seuls les cas qui ont quelque chose à entraîner (en F2L « variantes seulement », ceux qui ont des variantes).
  training.cases = set ? set.CASES.filter(c => cfg.ids.includes(c.id) && targetsFor(c).length) : [];
  if (!training.cases.length) { training = null; return; }
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
      · ${opt(CHECK_MODES, data.trainer.check || 'off')} check visuel · ${opt(AUF_MODES, data.trainer.auf || 'on')} AUF${training.set.view === 'f2l'
        ? ` · slots ${(data.trainer.slots || ['FR']).join(', ') || 'aucun'} · variantes ${opt(VARIANT_MODES, data.trainer.variants || 'off')}` : ''}</span>`;
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
  $('#tr-last').hidden = false;
  $('#tr-last').innerHTML = `
    <div class="tr-last-img">${caseImageFor(c)}</div>
    <div class="tr-last-body">
      <div><strong>${esc(c.name)}</strong>${last.label ? ` · ${esc(last.label)}` : ''} · ${Stats.fmt(last.ms, { precision: precision() })}</div>
      <code>${esc(last.alg)}</code>
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

/* ---------- Drills ---------- */
// BLD Cross + X : analyse sans limite, puis exécution (à l'aveugle) chronométrée. Avec le cube connecté,
// la réussite est vérifiée (cross + paires en place) ; sinon on la note soi-même.
let drillId = data.drillId || DRILLS[0].id;
// Réglages : paires à prévoir (0, 1, 2) et difficulté de la cross (longueur de la cross blanche).
let drillPairs = data.drillPairs ?? 0;
let drillDiff = DIFFICULTIES.find(d => d.id === data.drillDiff) || DIFFICULTIES.find(d => d.id === 'any');
// Slow solves : rythme du métronome (0 = sans) ; instants des mouvements du cube connecté pendant le solve.
let drillPace = data.drillPace ?? 0;
let slowMoves = null;
const metronome = new Metronome();
const currentDrill = () => DRILLS.find(d => d.id === drillId) || DRILLS[0];
const isSlow = () => drillId === 'slow';
let drillScramble = '';
let drillPending = null; // essai terminé, en attente de « Réussi / Raté »
const drillList = () => ((data.drills ||= {})[drillId] ||= []);
const drillPicker = picker($('#dr-drill'), {
  label: 'Drill',
  onChange(id) {
    drillTimer.cancel();
    drillId = data.drillId = id;
    drillPending = null;
    persist();
    renderDrills();
    newDrillScramble();
  },
});
const SLOW_HINTS = {
  idle: 'Maintiens Espace puis relâche pour démarrer',
  done: 'Maintiens Espace puis relâche pour un nouveau solve',
  hold: 'Attends le vert…',
  ready: 'Relâche pour démarrer',
  running: '',
};
const drillHint = state => (isSlow() ? SLOW_HINTS : DRILL_HINTS)[state] ?? '';
const DRILL_HINTS = {
  idle: 'Espace : lancer l\'analyse',
  done: 'Espace : nouvelle analyse',
  analysis: 'Prévois la cross et les paires · maintiens Espace puis relâche pour exécuter',
  hold: 'Attends le vert…',
  ready: 'Relâche pour lancer l\'exécution',
  running: '',
};

const drillTimer = new DrillTimer({
  settings,
  analysis: () => currentDrill().analysis,
  onUpdate(v) {
    const el = $('#dr-timer');
    el.className = 'timer';
    const phase = $('#dr-phase');
    if (v.state === 'running') {
      el.textContent = runningText(v.ms);
      phase.textContent = isSlow() ? (drillPace ? `Métronome ${String(drillPace).replace('.', ',')} TPS` : '') : 'Exécution';
    } else if (isSlow() && v.state !== 'done') {
      if (v.state === 'hold' || v.state === 'ready') el.classList.add(v.state);
      if (v.state === 'ready') el.textContent = Stats.fmt(0, { precision: precision() });
      phase.textContent = '';
    } else if (v.analysis !== undefined && v.state !== 'done') {
      el.textContent = (v.analysis / 1000).toFixed(1);
      el.classList.add(v.state === 'analysis' ? 'inspect' : v.state);
      phase.textContent = 'Analyse';
    } else if (v.state === 'done') {
      el.textContent = Stats.fmt(v.ms, { precision: precision() });
      phase.textContent = isSlow() ? '' : `Analyse ${(v.analysis / 1000).toFixed(1)} s`;
    }
    document.body.classList.toggle('solving', v.state === 'running');
    $('#dr-hint').textContent = drillPending && v.state === 'done' ? '' : drillHint(v.state);
  },
  onDone({ analysis, exec }) {
    metronome.stop();
    if (isSlow()) { saveSlow(exec); newDrillScramble(); return; }
    drillPending = { n: drillPairs, diff: drillDiff.id, s: drillScramble, analysis, exec, d: Date.now() };
    // Cube connecté : vérification automatique (cross d'une couleur quelconque + au moins n paires).
    if (smart.conn && smart.state) {
      const r = crossAndPairs(smart.state);
      saveDrill(r.cross && r.pairs >= drillPairs, true, r);
    } else {
      showDrillResult();
    }
    newDrillScramble();
  },
});
// Tant qu'un essai n'est pas noté, on ne relance pas d'analyse.
const drillPress = drillTimer.press.bind(drillTimer);
drillTimer.press = () => { if (!drillPending) drillPress(); };
// Slow solves : le métronome et l'enregistrement des mouvements démarrent avec le solve.
const drillStart = drillTimer.start.bind(drillTimer);
drillTimer.start = () => {
  drillStart();
  if (!isSlow()) return;
  slowMoves = smart.conn ? [] : null;
  metronome.start(drillPace);
};
const drillCancel = drillTimer.cancel.bind(drillTimer);
drillTimer.cancel = () => { metronome.stop(); drillCancel(); };

// Mouvement du cube connecté pendant un slow solve : instant noté ; cube résolu = fin du solve.
function drillSmartMove(now) {
  if (activeTab !== 'drills' || !isSlow() || drillTimer.state !== 'running' || !slowMoves) return;
  slowMoves.push(Math.round(now - drillTimer.startTime));
  if (cube3.isSolved(smart.state)) drillTimer.stop(Math.floor(now - drillTimer.startTime));
}

function saveSlow(exec) {
  const entry = { s: drillScramble, exec, tps: drillPace, d: Date.now() };
  if (slowMoves?.length) entry.t = slowMoves;
  slowMoves = null;
  drillList().push(entry);
  persist();
  const m = slowMetrics(entry.t, exec, drillPace);
  const r = $('#dr-result');
  r.hidden = !m;
  if (m) {
    r.innerHTML = `<div class="slow-result">
      <span><b>${m.moves}</b> mouvements · <b>${m.tps.toFixed(2)}</b> TPS · <b class="${m.pauses ? 'no' : 'yes'}">${m.pauses}</b> pause${m.pauses > 1 ? 's' : ''}${m.pauses ? ` (plus longue ${(m.longest / 1000).toFixed(1)} s)` : ''}</span>
      ${gapsChart(m)}
    </div>`;
  }
  renderDrillStats();
}

// Écarts entre mouvements, en barres ; les pauses (au-dessus du seuil) en orange.
function gapsChart(m) {
  const W = 320, H = 60, max = Math.max(m.limit * 1.5, ...m.gaps);
  const bw = W / m.gaps.length;
  const y = v => H - (Math.min(v, max) / max) * H;
  const bars = m.gaps.map((g, i) => `<rect x="${(i * bw + 0.5).toFixed(1)}" y="${y(g).toFixed(1)}" width="${Math.max(bw - 1, 1).toFixed(1)}" height="${(H - y(g)).toFixed(1)}" class="${g >= m.limit ? 'gap-pause' : 'gap'}"><title>${(g / 1000).toFixed(2)} s</title></rect>`).join('');
  return `<svg class="gaps" viewBox="0 0 ${W} ${H}" role="img" aria-label="Écarts entre les mouvements, pauses en orange">
    <line x1="0" x2="${W}" y1="${y(m.limit)}" y2="${y(m.limit)}" class="gap-limit"/>${bars}</svg>
    <span class="muted gaps-legend">Écart entre chaque mouvement · ligne = seuil de pause (${(m.limit / 1000).toFixed(1)} s)</span>`;
}

function showDrillResult(auto) {
  const r = $('#dr-result');
  r.hidden = false;
  if (drillPending) {
    $('#dr-hint').textContent = '';
    r.innerHTML = `<span>${drillPending.n ? `Cross + ${drillPending.n} paire${drillPending.n > 1 ? 's' : ''}` : 'Cross'} réussie ?</span>
      <button type="button" class="btn ok-btn" data-drill-ok="1">Réussi</button>
      <button type="button" class="btn danger" data-drill-ok="0">Raté</button>`;
  } else if (auto) {
    const last = drillList().at(-1);
    const what = auto.cross ? `cross + ${auto.pairs} paire${auto.pairs > 1 ? 's' : ''} en place` : 'pas de cross en place';
    r.innerHTML = `<span class="${last.ok ? 'yes' : 'no'}">${last.ok ? '✓ Réussi' : '✗ Raté'}</span><span class="muted">(${what}, vérifié par le cube)</span>`;
  }
}

function saveDrill(ok, auto, check) {
  if (!drillPending) return;
  drillList().push({ ...drillPending, ok, ...(auto ? { auto: true } : {}) });
  drillPending = null;
  persist();
  showDrillResult(auto ? check : null);
  if (!auto) $('#dr-result').hidden = true;
  renderDrillStats();
  $('#dr-hint').textContent = DRILL_HINTS.done;
}

// Mélange du niveau : pour Cross 1/2/3, on tire des états jusqu'à ce que la cross blanche ait la bonne
// longueur, puis on en donne un mélange « random-state » (solution de Kociemba inversée).
let drillScrambleToken = 0;
async function newDrillScramble() {
  const drill = DRILLS.find(d => d.id === drillId);
  const token = ++drillScrambleToken;
  const lvl = isSlow() ? {} : drillDiff;
  $('#dr-scramble').textContent = 'Génération du mélange…';
  let scr;
  if (lvl.min !== undefined) {
    const c = cube();
    let state;
    for (let i = 0; i < 2000; i++) {
      scr = randomMoveScramble({ length: 25 });
      state = c.applyAlg(c.solved(), scr);
      const len = whiteCrossLength(state);
      if (len >= lvl.min && len <= lvl.max) break;
    }
    try { scr = formatAlg(invertMoves(parseAlg(await solver.solve(state)))); } catch { /* on garde le mélange aléatoire */ }
  } else {
    scr = await PUZZLES[drill.puzzle].scramble({ type: settings().scrambleType });
  }
  if (token !== drillScrambleToken) return;
  drillScramble = scr;
  $('#dr-scramble').textContent = drillScramble;
}

function renderDrills() {
  drillPicker.set(DRILLS, drillId);
  document.querySelectorAll('.dr-opts').forEach(el => { el.hidden = el.dataset.drill !== drillId; });
  $('#dr-pace').innerHTML = PACES.map(p => `<button type="button" role="tab" data-pace="${p.tps}"
    class="${p.tps === drillPace ? 'on' : ''}" aria-selected="${p.tps === drillPace}">${p.name}</button>`).join('');
  $('#dr-pairs').innerHTML = PAIRS.map(p => `<button type="button" role="tab" data-n="${p.n}"
    class="${p.n === drillPairs ? 'on' : ''}" aria-selected="${p.n === drillPairs}">${p.name}</button>`).join('');
  $('#dr-diff').innerHTML = DIFFICULTIES.map(d => `<button type="button" role="tab" data-diff="${d.id}" title="${d.title}"
    class="${d.id === drillDiff.id ? 'on' : ''}" aria-selected="${d.id === drillDiff.id}">${d.name}</button>`).join('');
  $('#dr-diff-title').textContent = drillDiff.title;
  if (!drillScramble) newDrillScramble();
  if (!drillTimer.busy && drillTimer.state !== 'done') {
    $('#dr-timer').textContent = '0.0';
    $('#dr-phase').textContent = '';
    $('#dr-hint').textContent = drillHint('idle');
    $('#dr-result').hidden = true;
  }
  renderDrillStats();
}

function renderDrillStats() {
  if (isSlow()) { renderSlowStats(); return; }
  $('#dr-head').innerHTML = '<tr><th>#</th><th>X</th><th>Analyse</th><th>Exéc.</th><th></th></tr>';
  const list = drillList();
  const f = ms => Stats.fmt(ms, { precision: precision(), avg: true });
  const sec = ms => (ms == null ? '–' : `${(ms / 1000).toFixed(1)} s`);
  // Une ligne par combinaison paires × difficulté (ex. « +1 · Facile »).
  const pairsName = n => PAIRS.find(p => p.n === n)?.name || 'Cross';
  const diffOf = id => DIFFICULTIES.find(d => d.id === id);
  const label = (n, diff) => `${pairsName(n)}${diff === 'any' ? '' : ` · ${diffOf(diff).name}`}`;
  const rows = [];
  for (const p of PAIRS) for (const d of DIFFICULTIES) {
    const st = drillStats(list.filter(x => (x.n || 0) === p.n && difficultyOf(x) === d.id));
    if (st) rows.push({ n: p.n, diff: d.id, st });
  }
  $('#dr-stats').innerHTML = rows.length ? `<table>
      <thead><tr><th></th><th>Essais</th><th>Réussite</th><th>Analyse</th><th>Exéc.</th></tr></thead>
      <tbody>${rows.map(({ n, diff, st }) => `<tr class="${n === drillPairs && diff === drillDiff.id ? 'current' : ''}">
        <td>${label(n, diff)}</td><td>${st.count}</td><td>${Math.round(st.success * 100)} %</td><td>${sec(st.analysis)}</td><td>${f(st.exec)}</td>
      </tr>`).join('')}</tbody>
    </table><p class="muted dr-note">Moyennes sur les essais réussis.</p>`
    : '<p class="empty">Les stats apparaîtront après ton premier essai.</p>';
  const rowsH = [];
  for (let i = list.length - 1; i >= Math.max(0, list.length - 100); i--) {
    const x = list[i];
    const short = diffOf(difficultyOf(x)).short;
    rowsH.push(`<tr><td>${i + 1}</td><td title="${label(x.n || 0, difficultyOf(x))}">${(x.n ? `+${x.n}` : 'C') + (short ? ` ${short}` : '')}</td><td>${sec(x.analysis)}</td>
      <td class="${x.ok ? '' : 'dr-fail'}">${Stats.fmt(x.exec, { precision: precision() })}</td>
      <td><span class="${x.ok ? 'yes' : 'no'}">${x.ok ? '✓' : '✗'}</span> <button type="button" class="btn ghost dr-del" data-del-drill="${i}" title="Supprimer">×</button></td></tr>`);
  }
  $('#dr-body').innerHTML = rowsH.join('');
  $('#dr-empty').hidden = list.length > 0;
}

// Stats des slow solves : par rythme ; mouvements, TPS et pauses quand le cube connecté a suivi le solve.
function renderSlowStats() {
  const list = drillList();
  const f = ms => Stats.fmt(ms, { precision: precision(), avg: true });
  const paceName = tps => (tps ? `${String(tps).replace('.', ',')} TPS` : 'Sans métronome');
  const rows = PACES.map(p => {
    const xs = list.filter(x => (x.tps || 0) === p.tps);
    if (!xs.length) return null;
    const ms = xs.map(x => slowMetrics(x.t, x.exec, x.tps)).filter(Boolean);
    const avg = arr => arr.reduce((a, b) => a + b, 0) / arr.length;
    return { p, count: xs.length, time: avg(xs.map(x => x.exec)), tps: ms.length ? avg(ms.map(m => m.tps)) : null, pauses: ms.length ? avg(ms.map(m => m.pauses)) : null };
  }).filter(Boolean);
  $('#dr-stats').innerHTML = rows.length ? `<table>
      <thead><tr><th></th><th>Solves</th><th>Temps</th><th>TPS</th><th>Pauses</th></tr></thead>
      <tbody>${rows.map(r => `<tr class="${r.p.tps === drillPace ? 'current' : ''}">
        <td>${paceName(r.p.tps)}</td><td>${r.count}</td><td>${f(r.time)}</td><td>${r.tps == null ? '–' : r.tps.toFixed(2)}</td><td>${r.pauses == null ? '–' : r.pauses.toFixed(1)}</td>
      </tr>`).join('')}</tbody>
    </table><p class="muted dr-note">TPS et pauses : solves suivis par le cube connecté.</p>`
    : '<p class="empty">Les stats apparaîtront après ton premier solve.</p>';
  $('#dr-head').innerHTML = '<tr><th>#</th><th>Rythme</th><th>Temps</th><th>TPS</th><th>Pauses</th><th></th></tr>';
  const rowsH = [];
  for (let i = list.length - 1; i >= Math.max(0, list.length - 100); i--) {
    const x = list[i], m = slowMetrics(x.t, x.exec, x.tps);
    rowsH.push(`<tr><td>${i + 1}</td><td>${x.tps ? String(x.tps).replace('.', ',') : '–'}</td><td>${Stats.fmt(x.exec, { precision: precision() })}</td>
      <td>${m ? m.tps.toFixed(2) : '–'}</td><td>${m ? m.pauses : '–'}</td>
      <td><button type="button" class="btn ghost dr-del" data-del-drill="${i}" title="Supprimer">×</button></td></tr>`);
  }
  $('#dr-body').innerHTML = rowsH.join('');
  $('#dr-empty').hidden = list.length > 0;
}

$('#dr-pace').addEventListener('click', e => {
  const b = e.target.closest('[data-pace]');
  if (!b || drillTimer.busy) return;
  drillPace = data.drillPace = Number(b.dataset.pace);
  persist();
  renderDrills();
});
$('#dr-pairs').addEventListener('click', e => {
  const b = e.target.closest('[data-n]');
  if (!b || drillTimer.busy) return;
  drillPairs = data.drillPairs = Number(b.dataset.n);
  persist();
  renderDrills();
});
$('#dr-diff').addEventListener('click', e => {
  const b = e.target.closest('[data-diff]');
  if (!b || drillTimer.busy || b.dataset.diff === drillDiff.id) return;
  drillDiff = DIFFICULTIES.find(d => d.id === b.dataset.diff);
  data.drillDiff = drillDiff.id;
  persist();
  renderDrills();
  newDrillScramble(); // le mélange doit correspondre à la difficulté
});
$('#dr-new').onclick = () => { if (!drillTimer.busy) newDrillScramble(); };
$('#dr-result').addEventListener('click', e => {
  const b = e.target.closest('[data-drill-ok]');
  if (b) saveDrill(b.dataset.drillOk === '1', false);
});
$('#dr-body').addEventListener('click', e => {
  const b = e.target.closest('[data-del-drill]');
  if (!b || !confirm('Supprimer cet essai ?')) return;
  drillList().splice(Number(b.dataset.delDrill), 1);
  persist();
  renderDrillStats();
});
const drZone = $('#dr-zone');
drZone.addEventListener('pointerdown', e => { if (isTouch(e) && !e.target.closest('button')) { e.preventDefault(); drillTimer.pointerDown(); } });
drZone.addEventListener('pointerup', e => { if (isTouch(e) && !e.target.closest('button')) drillTimer.pointerUp(); });

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
  $('#last-splits').innerHTML = '';
  $('#timer').textContent = Stats.fmt(0, { precision: precision() });
  $('#timer-hint').textContent = HINTS.idle();
  if (activeTab === 'lab') renderLab();
  if (activeTab === 'stats') renderStatsPage();
}

refreshAll();
