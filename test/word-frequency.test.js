const test = require('node:test');
const assert = require('node:assert/strict');
const wordFreq = require('../public/lib/word-frequency.js');

test('RANKED_WORDS has no duplicates', () => {
  assert.equal(new Set(wordFreq.RANKED_WORDS).size, wordFreq.RANKED_WORDS.length);
});

test('freqWeight is highest for the most frequent word and decays by rank', () => {
  const top = wordFreq.freqWeight(wordFreq.RANKED_WORDS[0]);
  const mid = wordFreq.freqWeight(wordFreq.RANKED_WORDS[Math.floor(wordFreq.RANKED_WORDS.length / 2)]);
  const last = wordFreq.freqWeight(wordFreq.RANKED_WORDS[wordFreq.RANKED_WORDS.length - 1]);
  assert.equal(top, 1);
  assert.ok(top > mid);
  assert.ok(mid > last);
});

test('freqWeight gives unknown words a low floor weight, never zero', () => {
  const weight = wordFreq.freqWeight('zzqxnotaword');
  assert.ok(weight > 0);
  assert.ok(weight < wordFreq.freqWeight(wordFreq.RANKED_WORDS[0]));
});

test('freqWeight is case-insensitive', () => {
  assert.equal(wordFreq.freqWeight('The'), wordFreq.freqWeight('the'));
});
