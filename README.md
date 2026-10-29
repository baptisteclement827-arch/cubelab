# CubeLab

Environnement de speedcubing : timer, stats, labo d'algos. Sans dépendance, sans build.

## En ligne

https://baptisteclement827-arch.github.io/cubelab/ (GitHub Pages, mis à jour à chaque push sur `main`).

Le dossier de travail est `Mon Drive/CubeLab` ; les données git sont hors de Drive (`C:\Users\bapti\.git-repos\cubelab`).

## Lancer en local

```bash
python -m http.server 8333
```

Puis ouvrir http://localhost:8333 (tests du moteur : http://localhost:8333/tests.html).
Garder le port 8333 : les données sont stockées dans le navigateur, liées à cette adresse.

## Publier une modification

GitHub Pages laisse le navigateur garder les fichiers en cache 10 minutes. Quand on modifie
`css/style.css`, `js/app.js` ou `js/puzzles/registry.js`, on augmente leur numéro `?v=…`
(dans `index.html` pour les deux premiers, dans l'import de `js/app.js` pour le registre),
sinon un visiteur peut recevoir un mélange d'ancienne et de nouvelle version.

## Structure

- `js/core/nxn.js` : moteur générique NxN (facettes au format Kociemba U R F D L B)
- `js/core/notation.js` : notation WCA, commutateurs/conjugués, inverse, miroir, métriques
- `js/core/scramble.js` : mélanges random-move
- `js/core/cubie.js` : modèle coins/arêtes du 3x3, coordonnées, état aléatoire
- `js/core/orientation.js` : remet les centres en place (algos avec x, y, M, r…)
- `js/solver/twophase.js` : solveur de Kociemba en deux phases (mélanges random-state, bouton « Résoudre »)
- `js/solver/generator.js` : générateur d'algos (IDA* + table de distances, masques OLL/F2L, AUF)
- `js/workers/` + `js/solver/client.js` : calculs lourds hors du thread de l'interface
- `js/puzzles/registry.js` : liste des puzzles (seul le 3x3 est activé)
- `js/algsets/` : bibliothèque d'algos (`333-oll.js` : les 57 OLL, `333-pll.js` : les 21 PLL, par sous-ensemble ; `index.js` : ensembles par puzzle, état de chaque cas)
- `js/timer.js` : machine à états du timer (inspection WCA, maintien, pénalités)
- `js/stats.js` : moyennes WCA (ao5, ao12, ...), formatage
- `js/storage.js` : localStorage + export/import JSON
- `js/app.js` : interface
