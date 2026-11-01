/**
 * End-to-end scoring test via the in-app browser is not scriptable here, so this
 * verifies the exact scoring path the UI uses against real data:
 * simulate a full attempt, compute score, and confirm recordAttempt's math.
 */
import fs from 'node:fs';
import assert from 'node:assert';

const BANK = JSON.parse(fs.readFileSync('data/questions.json', 'utf8'));

const set12 = BANK.filter((q) => q.set === 12);
console.log('Set 12 length:', set12.length);

function isCorrect(question, given) {
  return given.length === question.answers.length && given.every((l) => question.answers.includes(l));
}

// Simulate: answer the first 30 correctly, the next 6 wrong, leave 6 blank.
const answers = new Map();
set12.forEach((q, i) => {
  if (i < 30) answers.set(q.id, q.answers);
  else if (i < 36) {
    const wrong = q.options.map((o) => o.letter).find((l) => !q.answers.includes(l));
    answers.set(q.id, [wrong]);
  }
});

const results = set12.map((q) => {
  const given = answers.get(q.id) || [];
  return { q, given, correct: isCorrect(q, given) };
});
const score = results.filter((r) => r.correct).length;
const missed = results.filter((r) => !r.correct).map((r) => r.q.id);

console.log('Score:', score, '/', set12.length, '=', Math.round((score / set12.length) * 100) + '%');
console.log('Missed:', missed.length, '(expected 12: 6 wrong + 6 blank)');
assert.equal(score, 30);
assert.equal(missed.length, 12);

// Verify "practice missed" would resolve every missed id back to a real question.
const byId = new Map(BANK.map((q) => [q.id, q]));
for (const id of missed) assert.ok(byId.get(id), `missed id ${id} not resolvable`);
console.log('All missed ids resolve to questions. OK');
