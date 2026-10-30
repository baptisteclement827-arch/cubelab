// Drills : exercices ciblés. BLD Croix + X : une phase d'analyse (sans limite), puis l'exécution chronométrée.
// Chrono : Espace (appui court) lance l'analyse ; maintenir puis relâcher lance l'exécution ; Espace l'arrête.
export const DRILLS = [
  { id: 'bldcross', name: 'BLD Croix + X', puzzle: '333' },
];

// États : idle -> analysis -> hold -> ready -> running -> done.
export class DrillTimer {
  constructor({ settings, onUpdate, onDone }) {
    this.settings = settings;
    this.onUpdate = onUpdate;
    this.onDone = onDone;
    this.state = 'idle';
    this.analysisStart = 0;
    this.analysisMs = 0;
    this.startTime = 0;
    this.pressed = false;
    this.holdTimer = null;
    this.raf = null;
  }

  get busy() { return ['analysis', 'hold', 'ready', 'running'].includes(this.state); }

  keyDown(code, repeat) {
    if (code === 'Escape') { if (this.busy) { this.cancel(); return true; } return false; }
    if (code !== 'Space') return false;
    if (!repeat) this.press();
    return true;
  }

  keyUp(code) {
    if (code !== 'Space') return false;
    this.release();
    return true;
  }

  pointerDown() { this.press(); }
  pointerUp() { this.release(); }

  press() {
    if (this.state === 'running') { this.stop(); return; }
    if (this.state === 'analysis') {
      // Maintien : on se prépare à l'exécution (vert après le délai de maintien).
      this.state = 'hold';
      this.emit();
      clearTimeout(this.holdTimer);
      this.holdTimer = setTimeout(() => { if (this.state === 'hold') { this.state = 'ready'; this.emit(); } }, this.settings().holdMs);
      return;
    }
    if (this.state === 'idle' || this.state === 'done') this.pressed = true;
  }

  release() {
    if (this.pressed) {
      // Appui court depuis le repos : début de l'analyse.
      this.pressed = false;
      this.state = 'analysis';
      this.analysisStart = performance.now();
      this.loop();
    } else if (this.state === 'hold') {
      clearTimeout(this.holdTimer);
      this.state = 'analysis';
      this.emit();
    } else if (this.state === 'ready') {
      this.start();
    }
  }

  start() {
    const now = performance.now();
    this.analysisMs = Math.floor(now - this.analysisStart);
    this.startTime = now;
    this.state = 'running';
    this.loop();
  }

  stop(ms) {
    const exec = ms ?? Math.floor(performance.now() - this.startTime);
    this.state = 'done';
    cancelAnimationFrame(this.raf);
    this.onUpdate({ state: 'done', ms: exec, analysis: this.analysisMs });
    this.onDone({ analysis: this.analysisMs, exec });
  }

  cancel() {
    clearTimeout(this.holdTimer);
    cancelAnimationFrame(this.raf);
    this.pressed = false;
    this.state = 'idle';
    this.emit();
  }

  // Timer GAN : mains posées pendant l'analyse = préparation ; départ et arrêt du tapis.
  device(evt) {
    if (evt.kind === 'hands-on' && this.state === 'analysis') { this.state = 'hold'; this.emit(); }
    else if (evt.kind === 'ready' && (this.state === 'hold' || this.state === 'analysis')) { this.state = 'ready'; this.emit(); }
    else if (evt.kind === 'hands-off' && (this.state === 'hold' || this.state === 'ready')) { this.state = 'analysis'; this.emit(); }
    else if (evt.kind === 'start' && this.state !== 'running' && this.state !== 'idle' && this.state !== 'done') this.start();
    else if (evt.kind === 'stop' && this.state === 'running') this.stop(evt.ms);
  }

  loop() {
    cancelAnimationFrame(this.raf);
    const tick = () => {
      this.emit();
      if (this.busy) this.raf = requestAnimationFrame(tick);
    };
    tick();
  }

  emit() {
    const now = performance.now();
    if (this.state === 'running') this.onUpdate({ state: 'running', ms: now - this.startTime });
    else if (['analysis', 'hold', 'ready'].includes(this.state)) this.onUpdate({ state: this.state, analysis: now - this.analysisStart });
    else this.onUpdate({ state: this.state });
  }
}

// Stats d'une liste d'essais : nombre, réussite, moyennes d'analyse et d'exécution (essais réussis).
export function drillStats(list) {
  if (!list.length) return null;
  const ok = list.filter(x => x.ok);
  const mean = arr => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null);
  return {
    count: list.length,
    success: ok.length / list.length,
    analysis: mean(ok.map(x => x.analysis)),
    exec: mean(ok.map(x => x.exec)),
    best: ok.length ? Math.min(...ok.map(x => x.exec)) : null,
  };
}
