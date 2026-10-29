// AES-128 sur un bloc de 16 octets, en place (le navigateur n'offre pas le mode bloc par bloc dont les cubes ont besoin).
const SBOX = new Uint8Array(256);
const INV = new Uint8Array(256);
const xtime = a => ((a << 1) ^ (a & 0x80 ? 0x1b : 0)) & 0xff;
const mul = (a, b) => { let r = 0; while (b) { if (b & 1) r ^= a; a = xtime(a); b >>= 1; } return r; };
{
  // S-box : inverse dans GF(2^8) puis transformation affine.
  for (let i = 0; i < 256; i++) {
    let inv = 0;
    if (i) for (let j = 1; j < 256; j++) if (mul(i, j) === 1) { inv = j; break; }
    let s = inv;
    for (let k = 1; k < 5; k++) s ^= ((inv << k) | (inv >> (8 - k))) & 0xff;
    SBOX[i] = s ^ 0x63;
    INV[SBOX[i]] = i;
  }
}

function expandKey(key) {
  const w = new Uint8Array(176);
  w.set(key);
  let rcon = 1;
  for (let i = 16; i < 176; i += 4) {
    let t = w.slice(i - 4, i);
    if (i % 16 === 0) {
      t = Uint8Array.of(SBOX[t[1]] ^ rcon, SBOX[t[2]], SBOX[t[3]], SBOX[t[0]]);
      rcon = xtime(rcon);
    }
    for (let k = 0; k < 4; k++) w[i + k] = w[i - 16 + k] ^ t[k];
  }
  return w;
}

const addKey = (s, w, r) => { for (let i = 0; i < 16; i++) s[i] ^= w[r * 16 + i]; };
// État en colonnes : octet i = ligne i % 4, colonne i >> 2.
const shift = (s, dir) => {
  const t = s.slice();
  for (let r = 1; r < 4; r++) for (let c = 0; c < 4; c++) s[r + 4 * c] = t[r + 4 * ((c + dir * r + 16) % 4)];
};
const mixCol = (s, m) => {
  for (let c = 0; c < 4; c++) {
    const a = s.slice(4 * c, 4 * c + 4);
    for (let r = 0; r < 4; r++) {
      s[4 * c + r] = mul(a[0], m[(4 - r) % 4]) ^ mul(a[1], m[(5 - r) % 4]) ^ mul(a[2], m[(6 - r) % 4]) ^ mul(a[3], m[(7 - r) % 4]);
    }
  }
};
const MIX = [2, 3, 1, 1];
const UNMIX = [14, 11, 13, 9];

export function aes128(key) {
  const w = expandKey(Uint8Array.from(key));
  return {
    encrypt(b) { // b : tableau de 16 octets, modifié en place
      const s = Uint8Array.from(b);
      addKey(s, w, 0);
      for (let r = 1; r <= 10; r++) {
        for (let i = 0; i < 16; i++) s[i] = SBOX[s[i]];
        shift(s, 1);
        if (r < 10) mixCol(s, MIX);
        addKey(s, w, r);
      }
      for (let i = 0; i < 16; i++) b[i] = s[i];
      return b;
    },
    decrypt(b) {
      const s = Uint8Array.from(b);
      addKey(s, w, 10);
      for (let r = 9; r >= 0; r--) {
        shift(s, -1);
        for (let i = 0; i < 16; i++) s[i] = INV[s[i]];
        addKey(s, w, r);
        if (r > 0) mixCol(s, UNMIX);
      }
      for (let i = 0; i < 16; i++) b[i] = s[i];
      return b;
    },
  };
}
