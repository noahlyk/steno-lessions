// Snapshots keymux's layout and dictionary into public/data/bundle.json, so the app can be
// hosted as static files (e.g. GitHub Pages) without a server able to run keymux at request
// time. Run this locally whenever the layout or dictionary changes, then commit the file.
const fs = require('node:fs');
const path = require('node:path');
const { loadData } = require('../server.js');

const OUT = path.join(__dirname, '..', 'public', 'data', 'bundle.json');

const { layout, words, dictionaries } = loadData();
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify({ layout, words, dictionaries }));
console.log(`wrote ${OUT} (${dictionaries.join(', ')})`);
