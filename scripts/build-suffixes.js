// Builds public/data/suffixes.json for Plover: the single-stroke suffixes in public/data/dictionary.json
// ({^ing} on -G, {^s} on -S ...), so the page also accepts a word typed as another word plus a suffix
// (film then -G for filming). Lapwing's is written by scripts/build-theory.js.
//
// Usage: node scripts/build-suffixes.js
const fs = require('node:fs');
const path = require('node:path');
const steno = require('../public/lib/steno.js');

const data = path.join(__dirname, '..', 'public', 'data');
const dictionary = JSON.parse(fs.readFileSync(path.join(data, 'dictionary.json'), 'utf8'));
const suffixes = steno.buildSuffixes(Object.entries(dictionary));
fs.writeFileSync(path.join(data, 'suffixes.json'), JSON.stringify(suffixes));
console.log(`${Object.keys(suffixes).length} suffixes -> ${path.join(data, 'suffixes.json')}`);
