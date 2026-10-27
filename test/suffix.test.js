// A word can also be typed as another word plus a suffix stroke: filming is film (TPEUPL) then
// {^ing} (-G), as Plover writes it, even when the dictionary only lists filming as one outline.
const test = require('node:test');
const assert = require('node:assert/strict');
const steno = require('../public/lib/steno.js');
const lessons = require('../public/lib/lessons.js');

const p = steno.parseStroke;
const dictionary = [
  ['TPEUPL', 'film'],
  ['TPEUL/-PLG', 'filming'], // the only whole-word outline the dictionary has
  ['-G', '{^ing}'],
  ['-S', '{^s}'],
  ['-Z', '{^s}'],
  ['-D', '{^ed}'],
  ['PHAEUBG', 'make'],
  ['PHAEUG', 'making'],
  ['STOP', 'stop'],
  ['STOPG', 'stopping'],
  ['TKO', 'do'],
  ['TKOG', 'doing'],
  ['KAT', 'cat'],
  ['KATS', 'cats'],
  ['TPEUPL/-G/-S', '{^ings}'], // multi-stroke: not a suffix stroke
  ['SKWRAOE', '{^ee}'],
];
const suffixes = steno.buildSuffixes(dictionary);
const build = () => steno.buildWords(dictionary);
const find = (words, text) => words.find((word) => word.text === text);
const written = (word) => word.variants.map((strokes) => strokes.map((bits) => steno.renderStroke(bits)).join('/'));

test('buildSuffixes keeps single-stroke suffixes, simplest stroke first, and nothing else', () => {
  assert.deepEqual(suffixes.ing, ['-G']);
  assert.deepEqual(suffixes.s, ['-S', '-Z']);
  assert.deepEqual(suffixes.ed, ['-D']);
  assert.equal(suffixes.ings, undefined, 'a multi-stroke entry is not a suffix stroke');
  assert.equal(suffixes.film, undefined, 'plain words are not suffixes');
});

test('filming can be typed as film then -G, as well as by its own outline', () => {
  const words = steno.addSuffixVariants(build(), suffixes);
  const filming = find(words, 'filming');
  assert.deepEqual(written(filming).slice(0, 1), ['TPEUL/-PLG'], 'the dictionary outline still comes first');
  assert.ok(written(filming).includes('TPEUPL/-G'), written(filming).join(' '));
});

test('the composed spelling is accepted stroke by stroke, and finishes the word', () => {
  const filming = steno.suffixComposer(build(), suffixes)(find(build(), 'filming'));
  const all = lessons.displayVariants(filming, (2 ** steno.SLOTS.length) - 1);
  const first = lessons.classifyStroke({ chord: p('TPEUPL'), candidates: all, all, strokeIdx: 0 });
  assert.equal(first.type, 'next', 'film is the first stroke of a spelling of filming');
  const second = lessons.classifyStroke({ chord: p('-G'), candidates: first.matches, all, strokeIdx: 1 });
  assert.equal(second.type, 'next');
  assert.ok(second.matches.some((strokes) => strokes.length === 2), 'two strokes finish the word');
});

test('spelling changes are undone: making is make+ing, stopping is stop+ing', () => {
  const words = steno.addSuffixVariants(build(), suffixes);
  assert.ok(written(find(words, 'making')).includes('PHAEUBG/-G'));
  assert.ok(written(find(words, 'stopping')).includes('STOP/-G'));
  assert.ok(written(find(words, 'cats')).includes('KAT/-S'));
  assert.ok(written(find(words, 'cats')).includes('KAT/-Z'), 'every stroke the suffix has');
});

test('a short stem is not used: doing is not do+ing', () => {
  const words = steno.addSuffixVariants(build(), suffixes);
  assert.deepEqual(written(find(words, 'doing')), ['TKOG']);
});

test('it never invents words, only widens the ones already in the list', () => {
  const before = build();
  const after = steno.addSuffixVariants(build(), suffixes);
  assert.deepEqual(after.map((word) => word.text), before.map((word) => word.text));
  assert.equal(find(after, 'film').variants.length, find(before, 'film').variants.length, 'film itself gains nothing');
});

test('a spelling never goes over three strokes', () => {
  const words = steno.buildWords([['A/B/KR', 'stem'], ['A/B/KR/-G', 'stemming'], ['KAT', 'cat'], ['-G', '{^ing}']]);
  steno.addSuffixVariants(words, { ing: ['-G'] });
  assert.ok(words.every((word) => word.variants.every((strokes) => strokes.length <= 3)));
});

test('composing is once per word and leaves a word with no stem alone', () => {
  const words = build();
  const compose = steno.suffixComposer(words, suffixes);
  const filming = find(words, 'filming');
  compose(filming);
  const count = filming.variants.length;
  compose(filming);
  assert.equal(filming.variants.length, count, 'a second call adds nothing');
  const cat = find(words, 'cat');
  assert.equal(compose(cat).variants.length, 1);
});

test('without suffixes nothing changes', () => {
  const words = build();
  const before = words.map((word) => word.variants.length);
  steno.addSuffixVariants(words, undefined);
  assert.deepEqual(words.map((word) => word.variants.length), before);
});

test('the shipped Plover data accepts film then -G for filming', () => {
  const bundle = require('../public/data/bundle.json');
  const shipped = require('../public/data/suffixes.json');
  const filming = steno.suffixComposer(bundle.words, shipped)(bundle.words.find((word) => word.text === 'filming'));
  assert.ok(written(filming).includes('TPEUPL/-G'), written(filming).join(' '));
});
