// GAN Smart Timer en Bluetooth (Web Bluetooth : Chrome / Edge sur ordinateur et Android).
// Protocole d'après la bibliothèque libre afedotov/gan-web-bluetooth (licence MIT).
const SERVICE = '0000fff0-0000-1000-8000-00805f9b34fb';
const STATE_CHAR = '0000fff5-0000-1000-8000-00805f9b34fb';

export const STATES = {
  DISCONNECT: 0, // déconnecté
  GET_SET: 1,    // mains posées assez longtemps : prêt à partir
  HANDS_OFF: 2,  // mains retirées avant d'être prêt
  RUNNING: 3,    // chrono lancé
  STOPPED: 4,    // chrono arrêté (le paquet contient le temps)
  IDLE: 5,       // remis à zéro
  HANDS_ON: 6,   // mains posées
  FINISHED: 7,   // suit STOPPED
};

// CRC-16/CCITT-FALSE : init 0xFFFF, polynôme 0x1021, sans XOR final.
export function crc16(bytes) {
  let crc = 0xffff;
  for (const b of bytes) {
    crc ^= b << 8;
    for (let j = 0; j < 8; j++) crc = crc & 0x8000 ? (crc << 1) ^ 0x1021 : crc << 1;
  }
  return crc & 0xffff;
}

// Paquet d'état : 0xFE, …, état (octet 3), [temps : min, s, ms (uint16 LE)], CRC (uint16 LE) des octets 2..n-3.
// Renvoie { state, ms? } ou null si le paquet est invalide.
export function parseStatePacket(bytes) {
  if (bytes.length < 6 || bytes[0] !== 0xfe) return null;
  const n = bytes.length;
  const crc = bytes[n - 2] | (bytes[n - 1] << 8);
  if (crc !== crc16(bytes.subarray(2, n - 2))) return null;
  const evt = { state: bytes[3] };
  if (evt.state === STATES.STOPPED && n >= 10) {
    evt.ms = bytes[4] * 60000 + bytes[5] * 1000 + (bytes[6] | (bytes[7] << 8));
  }
  return evt;
}

export const bluetoothAvailable = () => !!navigator.bluetooth;

// Connexion (doit être lancée par un clic). onEvent({ state, ms? }), onStatus('connected' | 'disconnected').
export async function connectGanTimer({ onEvent, onStatus }) {
  const device = await navigator.bluetooth.requestDevice({
    filters: [{ namePrefix: 'GAN' }, { namePrefix: 'gan' }, { namePrefix: 'Gan' }],
    optionalServices: [SERVICE],
  });
  let closed = false;

  const onValue = e => {
    const v = e.target.value;
    const evt = parseStatePacket(new Uint8Array(v.buffer, v.byteOffset, v.byteLength));
    if (evt) onEvent(evt);
  };

  async function open() {
    const server = await device.gatt.connect();
    const service = await server.getPrimaryService(SERVICE);
    const ch = await service.getCharacteristic(STATE_CHAR);
    ch.addEventListener('characteristicvaluechanged', onValue);
    await ch.startNotifications();
    onStatus('connected');
  }

  // Reconnexion automatique si le timer se met en veille ou s'éloigne.
  device.addEventListener('gattserverdisconnected', async () => {
    onStatus('disconnected');
    for (let i = 0; i < 3 && !closed; i++) {
      await new Promise(r => setTimeout(r, 1000 * (i + 1)));
      try { await open(); return; } catch { /* nouvel essai */ }
    }
  });

  await open();
  return {
    name: device.name,
    disconnect() { closed = true; device.gatt.disconnect(); },
  };
}
