// Machine à états du timer : idle -> (inspect) -> hold -> ready -> running -> stopped.
export class Timer {
  constructor({ settings, onUpdate, onSolve }) {
    this.settings = settings;
    this.onUpdate = onUpdate;
    this.onSolve = onSolve;
    this.state = 'idle';
    this.inspStart = null;
    this.startTime = 0;
    this.lastTime = 0;
    this.penalty = '';
    this.pendingInspection = false;
    this.ignoreRelease = false;
    this.holdTimer = null;
    this.raf = null;
    this.spoken = new Set();
  }

  get busy() {
    return this.state === 'running' || this.state === 'hold' || this.state === 'ready' || this.inspStart !== null;
  }

  // Renvoie true si l'événement a été consommé.
  keyDown(code, repeat) {
    if (this.state === 'running') { this.stop(); return true; }
    if (code === 'Escape') { if (this.busy) { this.cancel(); return true; } return false; }
    if (code !== 'Space') return false;
    if (!repeat) this.press();
    return true;
  }

  keyUp(code) {
    if (this.ignoreRelease) { this.ignoreRelease = false; return code === 'Space'; }
    if (code !== 'Space') return false;
    this.release();
    return true;
  }

  pointerDown() {
    if (this.state === 'running') this.stop();
    else this.press();
  }

  pointerUp() {
    if (this.ignoreRelease) { this.ignoreRelease = false; return; }
    this.release();
  }

  press() {
    const s = this.settings();
    if (this.inspStart === null && s.inspection) { this.pendingInspection = true; return; }
    this.state = 'hold';
    this.emit();
    clearTimeout(this.holdTimer);
    this.holdTimer = setTimeout(() => {
      if (this.state === 'hold') { this.state = 'ready'; this.emit(); }
    }, s.holdMs);
  }

  release() {
    if (this.pendingInspection) { this.pendingInspection = false; this.startInspection(); return; }
    if (this.state === 'hold') {
      clearTimeout(this.holdTimer);
      this.state = this.inspStart !== null ? 'inspect' : 'idle';
      this.emit();
    } else if (this.state === 'ready') {
      this.start();
    }
  }

  startInspection() {
    this.inspStart = performance.now();
    this.spoken.clear();
    this.state = 'inspect';
    this.loop();
  }

  start() {
    const now = performance.now();
    this.penalty = '';
    if (this.inspStart !== null) {
      const elapsed = now - this.inspStart;
      if (elapsed > 17000) this.penalty = 'DNF';
      else if (elapsed > 15000) this.penalty = '+2';
    }
    this.inspStart = null;
    this.startTime = now;
    this.state = 'running';
    this.loop();
  }

  stop() {
    this.lastTime = Math.floor(performance.now() - this.startTime);
    this.state = 'stopped';
    this.ignoreRelease = true;
    cancelAnimationFrame(this.raf);
    this.emit();
    this.onSolve({ ms: this.lastTime, penalty: this.penalty });
  }

  cancel() {
    clearTimeout(this.holdTimer);
    cancelAnimationFrame(this.raf);
    this.inspStart = null;
    this.pendingInspection = false;
    this.state = 'idle';
    this.emit();
  }

  loop() {
    cancelAnimationFrame(this.raf);
    const tick = () => {
      this.emit();
      if (this.state === 'running' || this.inspStart !== null) this.raf = requestAnimationFrame(tick);
    };
    tick();
  }

  speak(text) {
    if (!('speechSynthesis' in window)) return;
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'fr-FR';
    speechSynthesis.speak(u);
  }

  emit() {
    const now = performance.now();
    if (this.state === 'running') {
      this.onUpdate({ state: 'running', ms: now - this.startTime });
    } else if (this.inspStart !== null) {
      const elapsed = now - this.inspStart;
      if (this.settings().voice) {
        for (const sec of [8, 12]) {
          if (elapsed >= sec * 1000 && !this.spoken.has(sec)) { this.spoken.add(sec); this.speak(`${sec} secondes`); }
        }
      }
      this.onUpdate({ state: this.state, inspection: elapsed });
    } else {
      this.onUpdate({ state: this.state, ms: this.lastTime });
    }
  }
}
