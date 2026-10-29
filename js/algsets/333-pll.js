// Les 21 cas PLL du 3x3, rangés par sous-ensemble (noms anglais usuels). alg = algo par défaut.
export const SUBSETS = [
  { id: 'edges', name: 'Edges Only' },
  { id: 'corners', name: 'Corners Only' },
  { id: 'adjacent', name: 'Adjacent Corner Swap' },
  { id: 'diagonal', name: 'Diagonal Corner Swap' },
  { id: 'g', name: 'G Perms' },
];

const RAW = [
  ['Ua', 'edges', "R U' R U R U R U' R' U' R2"],
  ['Ub', 'edges', "R2 U R U R' U' R' U' R' U R'"],
  ['H', 'edges', 'M2 U M2 U2 M2 U M2'],
  ['Z', 'edges', "M' U M2 U M2 U M' U2 M2"],
  ['Aa', 'corners', "x R' U R' D2 R U' R' D2 R2 x'"],
  ['Ab', 'corners', "x R2 D2 R U R' D2 R U' R x'"],
  ['E', 'corners', "x' R U' R' D R U R' D' R U R' D R U' R' D' x"],
  ['T', 'adjacent', "R U R' U' R' F R2 U' R' U' R U R' F'"],
  ['F', 'adjacent', "R' U' F' R U R' U' R' F R2 U' R' U' R U R' U R"],
  ['Ja', 'adjacent', "R' U L' U2 R U' R' U2 R L"],
  ['Jb', 'adjacent', "R U R' F' R U R' U' R' F R2 U' R'"],
  ['Ra', 'adjacent', "R U' R' U' R U R D R' U' R D' R' U2 R'"],
  ['Rb', 'adjacent', "R2 F R U R U' R' F' R U2 R' U2 R"],
  ['V', 'diagonal', "R' U R' U' y R' F' R2 U' R' U R' F R F"],
  ['Y', 'diagonal', "F R U' R' U' R U R' F' R U R' U' R' F R F'"],
  ['Na', 'diagonal', "R U R' U R U R' F' R U R' U' R' F R2 U' R' U2 R U' R'"],
  ['Nb', 'diagonal', "R' U R U' R' F' U' F R U R' F R' F' R U' R"],
  ['Ga', 'g', "R2 U R' U R' U' R U' R2 U' D R' U R D'"],
  ['Gb', 'g', "R' U' R U D' R2 U R' U R U' R U' R2 D"],
  ['Gc', 'g', "R2 U' R U' R U R' U R2 U D' R U' R' D"],
  ['Gd', 'g', "R U R' U' D R2 U' R U' R' U R' U R2 D'"],
];

export const CASES = RAW.map(([n, subset, alg]) => ({ id: `pll${n}`, name: `${n} Perm`, subset, alg }));
