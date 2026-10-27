// Builds a theory's data files for the page: public/data/<theory>/bundle.json (the lesson words
// and layout) and public/data/<theory>/dictionary.json (every stroke, for the letting-go preview).
//
// Usage: node scripts/build-theory.js lapwing <folder with the Plover-format JSON files>
//
// Lapwing's JSON files come from https://github.com/aerickt/plover-lapwing-aio (folder
// plover_lapwing/dictionaries). Only the .json files are used; its .modal and .py files need
// Plover's plugin runtime and are skipped, so inflected forms such as "accorded" are missing.
// Files earlier in the list win when two strokes map to the same key, like Plover's priority.
const fs = require('node:fs');
const path = require('node:path');
const steno = require('../public/lib/steno.js');

const LAPWING_FILES = [
  'lapwing-base.json',
  'lapwing-numbers.json',
  'lapwing-commands.json',
  'lapwing-semi-modal-movement.json',
  'lapwing-prefixed-proper-nouns.json',
  'lapwing-uk-additions.json',
];

const [theory, source] = process.argv.slice(2);
if (theory !== 'lapwing' || !source) {
  console.error('usage: node scripts/build-theory.js lapwing <folder with the JSON files>');
  process.exit(1);
}

const PUBLIC = path.join(__dirname, '..', 'public');
const plover = JSON.parse(fs.readFileSync(path.join(PUBLIC, 'data', 'bundle.json'), 'utf8'));

const merged = {};
for (const file of LAPWING_FILES) {
  const dict = JSON.parse(fs.readFileSync(path.join(source, file), 'utf8'));
  for (const [stroke, text] of Object.entries(dict)) {
    if (!(stroke in merged)) merged[stroke] = text;
  }
}

const bundle = {
  layout: plover.layout,
  words: steno.buildWords(Object.entries(merged)),
  dictionaries: LAPWING_FILES,
};

const out = path.join(PUBLIC, 'data', theory);
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'bundle.json'), JSON.stringify(bundle));
fs.writeFileSync(path.join(out, 'dictionary.json'), JSON.stringify(merged));
fs.writeFileSync(path.join(out, 'suffixes.json'), JSON.stringify(steno.buildSuffixes(Object.entries(merged))));
console.log(`${theory}: ${bundle.words.length} words, ${Object.keys(merged).length} strokes -> ${out}`);
