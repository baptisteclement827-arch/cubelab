// Tests du décodage des paquets du timer GAN (paquets construits à la main, sans appareil).
import { crc16, parseStatePacket, STATES } from '../devices/gan-timer.js';

const results = [];
const test = (name, fn) => {
  try { fn(); results.push({ name, ok: true }); }
  catch (e) { results.push({ name, ok: false, msg: e.message }); }
};
const ok = (v, msg) => { if (!v) throw new Error(msg); };

// Construit un paquet valide : 0xFE, taille, 0x01, état, données, CRC LE.
function packet(state, data = []) {
  const body = [0xfe, 4 + data.length + 2, 0x01, state, ...data];
  const crc = crc16(Uint8Array.from(body.slice(2)));
  return Uint8Array.from([...body, crc & 0xff, crc >> 8]);
}

test('CRC-16/CCITT-FALSE : valeur de référence (« 123456789 » = 0x29B1)', () => {
  ok(crc16(new TextEncoder().encode('123456789')) === 0x29b1, crc16(new TextEncoder().encode('123456789')).toString(16));
});
test('Timer GAN : état « mains posées »', () => {
  ok(parseStatePacket(packet(STATES.HANDS_ON))?.state === STATES.HANDS_ON, 'état non lu');
});
test('Timer GAN : temps arrêté 1:02.345', () => {
  const evt = parseStatePacket(packet(STATES.STOPPED, [1, 2, 345 & 0xff, 345 >> 8]));
  ok(evt?.state === STATES.STOPPED && evt.ms === 62345, JSON.stringify(evt));
});
test('Timer GAN : paquet corrompu rejeté', () => {
  const p = packet(STATES.STOPPED, [0, 9, 10, 0]);
  p[5] ^= 0xff;
  ok(parseStatePacket(p) === null, 'CRC non vérifié');
  ok(parseStatePacket(Uint8Array.from([0x00, 1, 2, 3, 4, 5])) === null, 'octet magique non vérifié');
});

export default results;
