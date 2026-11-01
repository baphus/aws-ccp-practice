/**
 * Tests for the custom question-count parsing.
 * Mirrors validateCustom/readCustom in app.js so range handling is provable
 * independently of the DOM.
 */
import assert from 'node:assert';

const MAX_Q = 972;

function readCustom(value) {
  const raw = String(value).trim();
  if (raw === '') return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n)) return null;
  if (n < 1 || n > MAX_Q) return null;
  return n;
}

function validateCustom(value) {
  const raw = String(value).trim();
  const n = Number(raw);
  if (raw === '' || !Number.isFinite(n)) return { ok: false, error: 'Enter a number of questions.' };
  if (!Number.isInteger(n) || n < 1 || n > MAX_Q) {
    return { ok: false, error: `Enter a whole number between 1 and ${MAX_Q.toLocaleString()}.` };
  }
  return { ok: true, error: '' };
}

const cases = [
  // value, expectOk, expectN
  ['7', true, 7],
  ['1', true, 1],
  ['972', true, 972],
  ['100', true, 100],
  ['  42  ', true, 42],
  ['0', false, null],
  ['973', false, null],
  ['5000', false, null],
  ['-5', false, null],
  ['', false, null],
  ['   ', false, null],
  ['abc', false, null],
  ['7.5', false, null],
  ['1e3', false, null],
];

let pass = 0;
const fails = [];
for (const [input, expectOk, expectN] of cases) {
  const v = validateCustom(input);
  const n = readCustom(input);
  const okMatch = v.ok === expectOk;
  const nMatch = n === expectN;
  if (okMatch && nMatch) {
    pass++;
  } else {
    fails.push(
      `input ${JSON.stringify(input)}: expected ok=${expectOk} n=${expectN}, got ok=${v.ok} n=${n}`
    );
  }
}

console.log(`${pass} passed, ${fails.length} failed`);
for (const f of fails) console.log('  FAIL ' + f);
process.exit(fails.length ? 1 : 0);
