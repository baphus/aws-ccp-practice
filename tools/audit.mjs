import fs from 'node:fs';

const qs = JSON.parse(fs.readFileSync('data/questions.json', 'utf8'));
const byId = new Map(qs.map(q => [q.id, q]));

/* ---------- 1. Explanation quality audit ---------- */
const withRef = qs.filter(q => q.refUrl);
const withProse = qs.filter(q => q.explanation);
console.log('refUrl:', withRef.length, '| prose explanation:', withProse.length);

const junk = withProse.filter(q => q.explanation.length < 20 || /^-+$/.test(q.explanation) || /Explanation\s*:/i.test(q.explanation) || /^[B-D]\b/.test(q.explanation));
console.log('suspicious prose explanations:', junk.length);
junk.slice(0, 6).forEach(q => console.log(`   ${q.id}: ${JSON.stringify(q.explanation)}`));

console.log('\nsample refUrls:');
withRef.slice(0, 4).forEach(q => console.log(`   ${q.id}: ${q.refUrl}`));

/* ---------- 2. Answer residue audit ---------- */
const residue = qs.filter(q => q.explanation && /^\s*[A-E][\s,;]/i.test(q.explanation));
console.log('\nexplanations starting with an answer letter (residue):', residue.length);

/* ---------- 3. SPOT-CHECK against raw markdown ---------- */
// Verify each parsed question's answer matches an independent regex read of the raw file,
// and that every option's text actually appears in the source block.
function spotCheck(id) {
  const q = byId.get(id);
  const raw = fs.readFileSync(`tools/.cache/practice-exam-${q.set}.md`, 'utf8');
  const starts = []; const re = /<details/gi; let m;
  while ((m = re.exec(raw)) !== null) starts.push(m.index);
  const i = q.setPos - 1;
  const cs = i === 0 ? 0 : raw.indexOf('</details>', starts[i - 1]) + 10;
  const ce = raw.indexOf('</details>', starts[i]) + 10;
  const block = raw.slice(cs, ce);

  // Independent answer read: take ONLY the first line after the label (the answer line).
  const am = block.match(/Correct\s+[Aa]nswer\s*:?\s*([^\n]*)/i);
  const rawAnswer = am
    ? am[1].toUpperCase().replace(/[^A-E]/g, '').split('').sort().join('')
    : 'NONE';
  const parsed = q.answers.join('');
  const ok = rawAnswer === parsed;

  const optsInSource = q.options.every(o => {
    const frag = o.text.slice(0, 25).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(frag, 'i').test(block);
  });

  return { ok, optsInSource, rawAnswer, parsed };
}

// Mix across BOTH generations + multi/single + ref/prose
const picks = ['e1q01', 'e1q07', 'e2q18', 'e5q04', 'e9q42', 'e12q01', 'e12q42',
               'e13q01', 'e13q06', 'e13q16', 'e13q19', 'e14q09', 'e14q34',
               'e20q10', 'e23q03', 'e23q04', 'e23q12', 'e23q30', 'e23q45', 'e23q50'];

console.log('\n=== SPOT-CHECK: parsed answer vs. raw source (20 questions, both file generations) ===');
let pass = 0, fail = 0;
for (const id of picks) {
  const q = byId.get(id);
  if (!q) { console.log(`   ${id}: MISSING`); fail++; continue; }
  const r = spotCheck(id);
  const status = r.ok && r.optsInSource ? 'PASS' : 'FAIL';
  if (status === 'PASS') pass++; else fail++;
  console.log(`   ${status}  ${id}  parsed=${r.parsed}  raw=${r.rawAnswer}  optsFound=${r.optsInSource}  multi=${q.multi}`);
}
console.log(`\n   ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
