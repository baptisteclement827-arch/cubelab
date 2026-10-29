// Tests du décodage des paquets du timer GAN (paquets construits à la main, sans appareil).
import { crc16, parseStatePacket, STATES } from '../devices/gan-timer.js';
import { aes128 } from '../devices/aes128.js';
import { makeCodec, parseMessage, parseFacelets, plausible, macFromName, MSG } from '../devices/moyu32.js';

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

// ---------- AES et cube MoYu ----------
const hex = h => h.match(/../g).map(x => parseInt(x, 16));
const toHex = b => Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
test('AES-128 : vecteur du standard FIPS-197', () => {
  const b = hex('00112233445566778899aabbccddeeff');
  const a = aes128(hex('000102030405060708090a0b0c0d0e0f'));
  a.encrypt(b);
  ok(toHex(b) === '69c4e0d86a7b0430d8cdb78070b4c55a', toHex(b));
  a.decrypt(b);
  ok(toHex(b) === '00112233445566778899aabbccddeeff', 'déchiffrement');
});

// Écrit len bits de v à la position start (bit de poids fort en premier).
const setBits = (bytes, start, len, v) => {
  for (let i = 0; i < len; i++) {
    const bit = (v >> (len - 1 - i)) & 1, p = start + i;
    bytes[p >> 3] = (bytes[p >> 3] & ~(1 << (7 - (p & 7)))) | (bit << (7 - (p & 7)));
  }
};
const FBUDLR = 'FBUDLR';
const SOLVED = 'UUUUUUUUURRRRRRRRRFFFFFFFFFDDDDDDDDDLLLLLLLLLBBBBBBBBB';
function stateFrame(facelets, count) {
  const b = new Array(20).fill(0);
  b[0] = MSG.STATE;
  // facelets (ordre URFDLB) -> blocs de faces dans l'ordre FBUDLR, 8 facettes sans le centre.
  ['U', 'R', 'F', 'D', 'L', 'B'].forEach((face, k) => {
    const f = FBUDLR.indexOf(face);
    const stickers = facelets.slice(k * 9, k * 9 + 9).split('').filter((_, j) => j !== 4);
    stickers.forEach((c, j) => setBits(b, 8 + f * 24 + j * 3, 3, FBUDLR.indexOf(c)));
  });
  setBits(b, 152, 8, count);
  return b;
}

test('MoYu : MAC déduite du nom WCU_MY32_XXXX', () => {
  ok(macFromName('WCU_MY32_1A2B') === 'CF:30:16:00:1A:2B', macFromName('WCU_MY32_1A2B'));
  ok(macFromName('WCU_MY32') === null, 'nom sans suffixe');
});
test('MoYu : chiffrement puis déchiffrement d\'une trame de 20 octets', () => {
  const codec = makeCodec('CF:30:16:00:1A:2B');
  const frame = stateFrame(SOLVED, 7);
  const enc = codec.encode(frame);
  ok(toHex(enc) !== toHex(frame), 'trame non chiffrée');
  ok(toHex(codec.decode(enc)) === toHex(frame), 'aller-retour incorrect');
  const wrong = makeCodec('CF:30:16:00:00:00').decode(enc);
  ok(!plausible(parseMessage(wrong) || { type: 'x' }), 'une mauvaise clé ne doit pas passer');
});
test('MoYu : état du cube (facettes) et compteur', () => {
  const msg = parseMessage(stateFrame(SOLVED, 42));
  ok(msg.type === 'state' && msg.facelets === SOLVED && msg.count === 42, JSON.stringify(msg));
  ok(plausible(msg), 'état résolu jugé incohérent');
  const scrambled = 'DUUBULDBFRBFRRULLLBRDFFFBLURDBFDFDRFRULBLUFDURRBLBDUDL';
  ok(parseFacelets(stateFrame(scrambled, 0)) === scrambled, 'état mélangé mal relu');
});
test('MoYu : trame de mouvements (5 derniers, écarts de temps)', () => {
  const b = new Array(20).fill(0);
  b[0] = MSG.MOVE;
  const moves = [[5, 0, 120], [2, 1, 80], [0, 0, 0], [0, 0, 0], [0, 0, 0]]; // R (0 ms avant: 120), U' …
  moves.forEach(([face, prime, dt], i) => { setBits(b, 96 + i * 5, 5, face * 2 + prime); setBits(b, 8 + i * 16, 16, dt); });
  setBits(b, 88, 8, 200);
  const msg = parseMessage(b);
  ok(msg.type === 'move' && msg.count === 200, JSON.stringify(msg));
  ok(msg.moves[0].move === 'R' && msg.moves[0].dt === 120 && msg.moves[1].move === "U'", JSON.stringify(msg.moves.slice(0, 2)));
});

export default results;
