/**
 * Logic tests for the exam runner's scoring + storage.
 * Runs the real app.js in a DOM-free harness by extracting its pure helpers is not
 * possible (it is DOM-coupled), so this exercises the same rules against real data.
 */
import fs from 'node:fs';
import assert from 'node:assert';

const BANK = JSON.parse(fs.readFileSync('data/questions.json', 'utf8'));

/* --- mirror of app.js scoring rule: all-or-nothing, order-insensitive --- */
function isCorrect(question, given) {
  return given.length === question.answers.length && given.every((l) => question.answers.includes(l));
}

let pass = 0;
const fail = [];

function check(name, fn) {
  try {
    fn();
    pass++;
  } catch (e) {
    fail.push(`${name}: ${e.message}`);
  }
}

/* 1. Exact match is correct */
check('single exact match', () => {
  const q = BANK.find((x) => x.answers.length === 1);
  assert.equal(isCorrect(q, [q.answers[0]]), true);
});

/* 2. Wrong letter is wrong */
check('single wrong answer', () => {
  const q = BANK.find((x) => x.answers.length === 1);
  const wrong = q.options.map((o) => o.letter).find((l) => l !== q.answers[0]);
  assert.equal(isCorrect(q, [wrong]), false);
});

/* 3. Blank is wrong */
check('blank is wrong', () => {
  const q = BANK.find((x) => x.answers.length === 1);
  assert.equal(isCorrect(q, []), false);
});

/* 4. Multi: all correct letters in any order passes */
check('multi all correct, any order', () => {
  const q = BANK.find((x) => x.answers.length === 2);
  assert.equal(isCorrect(q, [q.answers[1], q.answers[0]]), true);
});

/* 5. Multi: partial answer fails (all-or-nothing) */
check('multi partial fails', () => {
  const q = BANK.find((x) => x.answers.length === 2);
  assert.equal(isCorrect(q, [q.answers[0]]), false);
});

/* 6. Multi: extra wrong letter fails */
check('multi with extra fails', () => {
  const q = BANK.find((x) => x.answers.length >= 2);
  const extra = q.options.map((o) => o.letter).find((l) => !q.answers.includes(l));
  assert.equal(isCorrect(q, [...q.answers, extra]), false);
});

/* 7. Three-answer questions exist and score correctly */
check('three-answer question exists', () => {
  const q = BANK.find((x) => x.answers.length === 3);
  assert.ok(q, 'expected at least one 3-answer question');
  assert.equal(isCorrect(q, q.answers), true);
  assert.equal(isCorrect(q, q.answers.slice(0, 2)), false);
});

/* 8. Every answer letter is a real option, across the whole bank */
check('all answers reference real options', () => {
  for (const q of BANK) {
    for (const a of q.answers) {
      assert.ok(q.options.some((o) => o.letter === a), `${q.id}: ${a} not in options`);
    }
  }
});

/* 9. No question has fewer than 2 options */
check('all questions have >=2 options', () => {
  for (const q of BANK) assert.ok(q.options.length >= 2, `${q.id}: ${q.options.length} options`);
});

/* 10. dupeKey de-duplication yields the reported unique count */
check('dedupe count matches exams.json', () => {
  const exams = JSON.parse(fs.readFileSync('data/exams.json', 'utf8'));
  const seen = new Set();
  const unique = BANK.filter((q) => (seen.has(q.dupeKey) ? false : (seen.add(q.dupeKey), true)));
  assert.equal(unique.length, exams.uniqueQuestions);
});

/* 11. Set counts sum to the bank size */
check('set counts sum to total', () => {
  const exams = JSON.parse(fs.readFileSync('data/exams.json', 'utf8'));
  const sum = exams.sets.reduce((s, x) => s + x.count, 0);
  assert.equal(sum, BANK.length);
  assert.equal(BANK.length, 1142);
});

/* 12. Every question id is unique */
check('ids unique', () => {
  const ids = new Set(BANK.map((q) => q.id));
  assert.equal(ids.size, BANK.length);
});

/* 13. Percentages used by the UI */
check('pct helper', () => {
  const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
  assert.equal(pct(41, 65), 63);
  assert.equal(pct(0, 10), 0);
  assert.equal(pct(10, 10), 100);
  assert.equal(pct(0, 0), 0);
});

/* 14. Stems and options are non-empty and free of leftover markdown/html */
check('no html or markdown debris', () => {
  for (const q of BANK) {
    assert.ok(!/<[a-z][^>]*>/i.test(q.stem), `${q.id}: html in stem`);
    assert.ok(!/<br/i.test(q.stem), `${q.id}: br in stem`);
    assert.ok(!/^---/.test(q.stem), `${q.id}: front matter leaked into stem`);
    assert.ok(!/\blayout:\s*exam\b/i.test(q.stem), `${q.id}: front matter key leaked`);
    assert.ok(!/^#/.test(q.stem), `${q.id}: markdown heading leaked`);
    assert.ok(!q.stem.includes('Practice Exam'), `${q.id}: document title leaked into stem`);
    for (const o of q.options) {
      assert.ok(o.text.length > 0, `${q.id}/${o.letter}: empty option`);
      assert.ok(!/^\s*[-*]\s/.test(o.text), `${q.id}/${o.letter}: markdown bullet leaked`);
      assert.ok(!/<[a-z][^>]*>/i.test(o.text), `${q.id}/${o.letter}: html in option`);
    }
  }
});

/* 14b. First question of every set must not contain header debris */
check('first question of each set is clean', () => {
  const exams = JSON.parse(fs.readFileSync('data/exams.json', 'utf8'));
  for (const s of exams.sets) {
    const first = BANK.find((q) => q.set === s.set && q.setPos === 1);
    assert.ok(first, `set ${s.set}: no first question`);
    assert.ok(/^[A-Z0-9]/.test(first.stem), `set ${s.set}: first stem starts oddly: "${first.stem.slice(0, 60)}"`);
    assert.ok(!/#|layouts?/i.test(first.stem.slice(0, 40)), `set ${s.set}: header debris: "${first.stem.slice(0, 60)}"`);
  }
});

/* 15. No "Choose TWO" question is stored as single-answer */
check('choose-two questions are multi', () => {
  const mismatches = BANK.filter(
    (q) => /choose\s+(two|2)/i.test(q.stem) && q.answers.length !== 2
  );
  assert.equal(mismatches.length, 0, `mismatches: ${mismatches.map((q) => q.id).join(', ')}`);
});

console.log(`\n${pass} passed, ${fail.length} failed`);
if (fail.length) {
  for (const f of fail) console.log('  FAIL ' + f);
  process.exit(1);
}
console.log('All logic tests passed.');
