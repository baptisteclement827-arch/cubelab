// Worker du générateur d'algos. Pour l'arrêter, le thread principal le termine.
import { generate } from '../solver/generator.js';

self.onmessage = e => {
  const { id, payload } = e.data;
  try {
    let batch = [];
    const flush = () => {
      if (batch.length) self.postMessage({ id, type: 'solutions', solutions: batch });
      batch = [];
    };
    const summary = generate(payload, {
      onSolution: sol => { batch.push(sol); if (batch.length >= 20) flush(); },
      onProgress: p => { flush(); self.postMessage({ id, type: 'progress', ...p }); },
    });
    flush();
    self.postMessage({ id, type: 'done', ...summary });
  } catch (err) {
    self.postMessage({ id, type: 'error', message: err.message });
  }
};
