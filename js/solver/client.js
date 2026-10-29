// Accès aux workers depuis l'interface.

class SolverClient {
  constructor() {
    this.worker = null;
    this.pending = new Map();
    this.seq = 0;
  }

  ensure() {
    if (this.worker) return;
    this.worker = new Worker(new URL('../workers/solver.worker.js', import.meta.url), { type: 'module' });
    this.worker.onmessage = e => {
      const { id, result, error } = e.data;
      const p = this.pending.get(id);
      if (!p) return;
      this.pending.delete(id);
      error ? p.reject(new Error(error)) : p.resolve(result);
    };
    this.worker.onerror = e => {
      for (const p of this.pending.values()) p.reject(new Error(e.message || 'Erreur du solveur'));
      this.pending.clear();
    };
  }

  call(type, payload) {
    this.ensure();
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ id, type, payload });
    });
  }

  init() { return this.call('init'); }
  scramble() { return this.call('scramble'); }
  solve(facelets) { return this.call('solve', { facelets: Array.from(facelets) }); }}

export const solver = new SolverClient();

// Lance une génération ; renvoie { stop() }. Un nouveau worker par génération (l'arrêt le termine).
export function runGenerator(payload, { onSolutions, onProgress, onDone, onError }) {
  const worker = new Worker(new URL('../workers/generator.worker.js', import.meta.url), { type: 'module' });
  worker.onmessage = e => {
    const msg = e.data;
    if (msg.type === 'solutions') onSolutions?.(msg.solutions);
    else if (msg.type === 'progress') onProgress?.(msg);
    else if (msg.type === 'done') { onDone?.(msg); worker.terminate(); }
    else if (msg.type === 'error') { onError?.(new Error(msg.message)); worker.terminate(); }
  };
  worker.onerror = e => { onError?.(new Error(e.message || 'Erreur du générateur')); worker.terminate(); };
  worker.postMessage({ id: 1, payload });
  return { stop: () => worker.terminate() };
}
