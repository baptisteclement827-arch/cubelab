// Registre des puzzles. Pour en activer un nouveau : available: true + une fonction scramble (async).
import { randomMoveScramble } from '../core/scramble.js';
import { solver } from '../solver/client.js';

export const PUZZLES = {
  '333': {
    id: '333', name: '3x3', n: 3, available: true,
    async scramble({ type = 'random-state' } = {}) {
      if (type === 'random-move') return randomMoveScramble({ length: 25 });
      try {
        return await solver.scramble();
      } catch (err) {
        console.warn('Solveur indisponible, mélange random-move', err);
        return randomMoveScramble({ length: 25 });
      }
    },
  },
  '222': { id: '222', name: '2x2', n: 2, available: false },
  '444': { id: '444', name: '4x4', n: 4, available: false },
  '555': { id: '555', name: '5x5', n: 5, available: false },
  '666': { id: '666', name: '6x6', n: 6, available: false },
  '777': { id: '777', name: '7x7', n: 7, available: false },
};

export const DEFAULT_PUZZLE = '333';
