// Cube MoYu connecté (WeiLong V10 AI…), protocole « MoYu32 » en Bluetooth (Chrome / Edge).
// Protocole d'après csTimer (src/js/hardware/moyu32cube.js) : trames de 20 octets chiffrées en AES-128,
// clé et IV de base modifiés par l'adresse MAC du cube.
import { aes128 } from './aes128.js';

const SERVICE = '0783b03e-7735-b5a0-1760-a305d2795cb0';
const READ_CHAR = '0783b03e-7735-b5a0-1760-a305d2795cb1';
const WRITE_CHAR = '0783b03e-7735-b5a0-1760-a305d2795cb2';
const BASE_KEY = [21, 119, 58, 92, 103, 14, 45, 31, 23, 103, 42, 19, 155, 103, 82, 87];
const BASE_IV = [17, 35, 38, 37, 134, 42, 44, 59, 85, 6, 127, 49, 126, 103, 33, 87];
export const MSG = { INFO: 161, STATE: 163, BATTERY: 164, MOVE: 165, GYRO: 171 };
// Identifiants constructeur possibles dans l'annonce Bluetooth (0x0000 si le cube n'est lié à aucun compte).
const CICS = [0, ...Array.from({ length: 255 }, (_, i) => (i + 1) << 8)];

// Chiffrement : chaque bloc de 16 octets est XORé avec l'IV ; pour 20 octets, les blocs [0,16) puis [4,20).
export function makeCodec(mac) {
  const m = mac.split(':').map(h => parseInt(h, 16));
  const key = BASE_KEY.slice(), iv = BASE_IV.slice();
  for (let i = 0; i < 6; i++) {
    key[i] = (key[i] + m[5 - i]) % 255;
    iv[i] = (iv[i] + m[5 - i]) % 255;
  }
  const aes = aes128(key);
  const xorIv = b => { for (let i = 0; i < 16; i++) b[i] ^= iv[i]; };
  return {
    decode(bytes) {
      const r = Array.from(bytes);
      if (r.length > 16) {
        const off = r.length - 16;
        const block = aes.decrypt(r.slice(off));
        xorIv(block);
        for (let i = 0; i < 16; i++) r[off + i] = block[i];
      }
      const head = aes.decrypt(r.slice(0, 16));
      xorIv(head);
      for (let i = 0; i < 16; i++) r[i] = head[i];
      return r;
    },
    encode(bytes) {
      const r = Array.from(bytes);
      const head = r.slice(0, 16);
      xorIv(head);
      aes.encrypt(head);
      for (let i = 0; i < 16; i++) r[i] = head[i];
      if (r.length > 16) {
        const off = r.length - 16;
        const block = r.slice(off);
        xorIv(block);
        aes.encrypt(block);
        for (let i = 0; i < 16; i++) r[off + i] = block[i];
      }
      return r;
    },
  };
}

// Résumé lisible du diagnostic (affiché quand la connexion échoue).
function diagText(device, diag) {
  const lines = [`Nom : ${device.name || '(aucun)'} · advertisements : ${device.watchAdvertisements ? 'oui' : 'non'}`];
  for (const a of diag.attempts) {
    const frames = a.frames.map(f => `${f.len}o type ${f.type} [${f.raw}]`).join(', ');
    lines.push(`${a.mac} → ${a.frames.length ? frames : 'aucun message'}${a.error ? ` · erreur d'envoi : ${a.error}` : ''}`);
  }
  return lines.join('\n');
}

const bits = (bytes, start, len) => {
  let v = 0;
  for (let i = start; i < start + len; i++) v = v * 2 + ((bytes[i >> 3] >> (7 - (i & 7))) & 1);
  return v;
};
const FBUDLR = 'FBUDLR';

// État complet : 6 faces de 8 facettes × 3 bits (centre implicite), lues dans l'ordre U R F D L B.
// Renvoie les 54 facettes en lettres de faces, ordre Kociemba (URFDLB).
export function parseFacelets(bytes) {
  let out = '';
  for (const f of [2, 5, 0, 3, 4, 1]) {
    for (let j = 0; j < 8; j++) {
      out += FBUDLR[bits(bytes, 8 + f * 24 + j * 3, 3)];
      if (j === 3) out += FBUDLR[f];
    }
  }
  return out;
}

// Trame décodée -> événement.
export function parseMessage(bytes) {
  const type = bytes[0];
  if (type === MSG.STATE) return { type: 'state', facelets: parseFacelets(bytes), count: bits(bytes, 152, 8) };
  if (type === MSG.BATTERY) return { type: 'battery', level: bytes[1] };
  if (type === MSG.INFO) {
    let name = '';
    for (let i = 0; i < 8; i++) name += String.fromCharCode(bytes[1 + i]);
    return { type: 'info', name: name.replace(/\0/g, '').trim() };
  }
  if (type === MSG.MOVE) {
    // 5 derniers mouvements (le plus récent en 0) : 5 bits chacun, + écart de temps (ms) sur 16 bits.
    const moves = [];
    for (let i = 0; i < 5; i++) {
      const m = bits(bytes, 96 + i * 5, 5);
      moves.push(m < 12 ? { move: FBUDLR[m >> 1] + (m & 1 ? "'" : ''), dt: bits(bytes, 8 + i * 16, 16) } : null);
    }
    return { type: 'move', count: bits(bytes, 88, 8), moves };
  }
  if (type === MSG.GYRO) return { type: 'gyro' };
  return null;
}

// Une réponse décodée avec la bonne clé : état à 9 facettes par face, ou nom lisible.
export function plausible(msg) {
  if (msg.type === 'state') return [...'URFDLB'].every(f => msg.facelets.split(f).length === 10);
  if (msg.type === 'info') return /^[\x20-\x7e]{2,}$/.test(msg.name);
  return false;
}

export const isMoyu32Name = name => /^WCU_MY3/.test(name || '');
// Adresse MAC saisie librement (« cf3016017333 », « CF:30:16:01:73:33 »…) -> « CF:30:16:01:73:33 », ou null.
export function normalizeMac(input) {
  const hex = String(input || '').replace(/[^0-9a-f]/gi, '').toUpperCase();
  return hex.length === 12 ? hex.match(/../g).join(':') : null;
}

// Le nom « WCU_MY32_ABCD » donne les deux derniers octets de la MAC ; les premiers sont CF:30:16:00 ou CF:30:16:01.
export function macsFromName(name) {
  const m = /^WCU_MY32_([0-9A-F]{2})([0-9A-F]{2})$/i.exec(name || '');
  return m ? ['00', '01'].map(b => `CF:30:16:${b}:${m[1]}:${m[2]}`.toUpperCase()) : [];
}
export const macFromName = name => macsFromName(name)[0] || null;

// Lit la MAC dans l'annonce Bluetooth (6 derniers octets des données constructeur, à l'envers).
async function macFromAdvertisement(device, timeout = 4000) {
  if (!device.watchAdvertisements) return null;
  const ctrl = new AbortController();
  try {
    return await new Promise(resolve => {
      const timer = setTimeout(() => resolve(null), timeout);
      device.addEventListener('advertisementreceived', e => {
        for (const id of CICS) {
          const dv = e.manufacturerData?.get?.(id);
          if (dv && dv.byteLength >= 6) {
            clearTimeout(timer);
            const mac = [];
            for (let i = 0; i < 6; i++) mac.push(dv.getUint8(dv.byteLength - 1 - i).toString(16).padStart(2, '0'));
            resolve(mac.join(':').toUpperCase());
            return;
          }
        }
      }, { once: false });
      device.watchAdvertisements({ signal: ctrl.signal }).catch(() => { clearTimeout(timer); resolve(null); });
    });
  } finally {
    ctrl.abort();
  }
}

// Connexion (lancée par un clic). Callbacks : onEvent(événement), onStatus(statut),
// askMac(nom, macProposée) -> MAC ou null, knownMac(nom) -> MAC déjà validée, onMac(nom, mac) une fois validée.
export async function connectMoyu32({ onEvent, onStatus, askMac, knownMac = () => null, onMac = () => {} }) {
  const device = await navigator.bluetooth.requestDevice({
    filters: [{ namePrefix: 'WCU_MY3' }],
    optionalServices: [SERVICE],
    optionalManufacturerData: CICS,
  });
  let mac = null;
  let codec = null;
  let writer = null;
  let closed = false;
  let lastCount = -1;
  let verified = false;
  // Diagnostic : pour chaque adresse essayée, les messages reçus (premier octet déchiffré, et brut).
  const diag = { attempts: [] };
  let attempt = null;

  const send = opcode => {
    const req = new Array(20).fill(0);
    req[0] = opcode;
    return writer.writeValue(Uint8Array.from(codec.encode(req)));
  };

  const onValue = e => {
    if (!codec) return;
    const v = e.target.value;
    const raw = new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
    const decoded = codec.decode(raw);
    if (attempt && attempt.frames.length < 6) {
      attempt.frames.push({ len: raw.length, type: decoded[0], raw: Array.from(raw.slice(0, 6), b => b.toString(16).padStart(2, '0')).join('') });
    }
    const msg = parseMessage(decoded);
    if (!msg) return;
    // Tant que la clé n'est pas confirmée, seule une réponse cohérente compte (une mauvaise clé donne du bruit).
    if (!verified) {
      if (!plausible(msg)) return;
      verified = true;
    }
    if (msg.type === 'move') {
      // Compteur sur 8 bits : on rejoue les mouvements manqués (5 au plus), du plus ancien au plus récent.
      if (lastCount < 0) { lastCount = msg.count; return; }
      const n = Math.min((msg.count - lastCount) & 0xff, 5);
      lastCount = msg.count;
      for (let i = n - 1; i >= 0; i--) if (msg.moves[i]) onEvent({ type: 'move', move: msg.moves[i].move, dt: msg.moves[i].dt });
      return;
    }
    if (msg.type === 'state') lastCount = msg.count;
    onEvent(msg);
  };

  async function open() {
    const server = await device.gatt.connect();
    const service = await server.getPrimaryService(SERVICE);
    const reader = await service.getCharacteristic(READ_CHAR);
    writer = await service.getCharacteristic(WRITE_CHAR);
    reader.addEventListener('characteristicvaluechanged', onValue);
    await reader.startNotifications();
  }

  // Vérifie la clé : le cube doit répondre à la demande d'infos par une trame lisible.
  async function handshake() {
    verified = false;
    lastCount = -1;
    codec = makeCodec(mac);
    attempt = { mac, frames: [], error: null };
    diag.attempts.push(attempt);
    try {
      await send(MSG.INFO);
      await send(MSG.STATE);
      await send(MSG.BATTERY);
    } catch (err) {
      attempt.error = err.message;
    }
    await new Promise(r => setTimeout(r, 2000));
    return verified;
  }

  device.addEventListener('gattserverdisconnected', async () => {
    onStatus('disconnected');
    for (let i = 0; i < 3 && !closed; i++) {
      await new Promise(r => setTimeout(r, 1000 * (i + 1)));
      try { await open(); await handshake(); onStatus('connected'); return; } catch { /* nouvel essai */ }
    }
  });

  await open();
  // Adresses essayées dans l'ordre : déjà validée, annonce Bluetooth, déduites du nom ; sinon on la demande.
  const tried = new Set();
  const candidates = [knownMac(device.name), ...macsFromName(device.name)];
  const tryMac = async m => {
    m = normalizeMac(m);
    if (!m || tried.has(m)) return false;
    tried.add(m);
    mac = m;
    return handshake();
  };
  let ok = false;
  for (const m of candidates) if ((ok = await tryMac(m))) break;
  if (!ok) ok = await tryMac(await macFromAdvertisement(device));
  while (!ok) {
    const answer = await askMac(device.name, [...tried].at(-1), diagText(device, diag));
    if (!answer) { closed = true; device.gatt.disconnect(); throw new Error('Adresse MAC du cube inconnue'); }
    if (!normalizeMac(answer)) continue;
    tried.delete(normalizeMac(answer)); // une saisie explicite est toujours réessayée
    ok = await tryMac(answer);
  }
  onMac(device.name, mac);
  onStatus('connected');
  return {
    name: device.name,
    mac,
    battery: () => send(MSG.BATTERY),
    requestState: () => send(MSG.STATE),
    disconnect() { closed = true; device.gatt.disconnect(); },
  };
}
