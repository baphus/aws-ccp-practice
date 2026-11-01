#!/usr/bin/env node
/**
 * sync.mjs — fetch + parse the upstream AWS CCP practice exam Markdown into JSON.
 *
 * Author-only tool. Run manually:  node tools/sync.mjs
 * Outputs: data/questions.json, data/exams.json
 *
 * The upstream data is Markdown prose, not JSON, and is inconsistent across files.
 * Everything this parser tolerates is documented in the table below and was verified
 * against all 23 source files (1,142 questions).
 *
 * If ANY validation fails, this script exits non-zero and writes nothing.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

const UPSTREAM_RAW =
  'https://raw.githubusercontent.com/kananinirav/AWS-Certified-Cloud-Practitioner-Notes/master/practice-exam';
const SET_COUNT = 23;

const ROOT = path.resolve(import.meta.dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');
const CACHE_DIR = path.join(ROOT, 'tools', '.cache');

/* ------------------------------------------------------------------ fetch */

async function fetchSet(n) {
  const url = `${UPSTREAM_RAW}/practice-exam-${n}.md`;
  const cacheFile = path.join(CACHE_DIR, `practice-exam-${n}.md`);

  // Use the local cache when present so parsing can be re-run offline.
  try {
    const cached = await fs.readFile(cacheFile, 'utf8');
    if (cached.length > 1000) return cached;
  } catch {
    /* not cached yet */
  }

  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
  const text = await res.text();
  if (text.length < 1000) throw new Error(`Suspiciously short response for ${url}`);
  await fs.mkdir(CACHE_DIR, { recursive: true });
  await fs.writeFile(cacheFile, text, 'utf8');
  return text;
}

/* ------------------------------------------------------------------ parse */

/** Strip inline HTML and collapse whitespace. */
function cleanText(s) {
  return s
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/?[a-z][^>]*>/gi, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Normalize an upstream answer string into sorted letters.
 * Handles: "D" | "B, E" | "AB" | "A,B" | "Ac"
 */
function parseAnswerLetters(raw) {
  const letters = raw
    .toUpperCase()
    .replace(/[.,;:\s]/g, '')
    .split('')
    .filter((c) => c >= 'A' && c <= 'E');
  return [...new Set(letters)].sort();
}

/**
 * Extract the answer from a <details> block body.
 * IMPORTANT: sets 13-23 put a BLANK LINE between the label and the value, so we must
 * scan past blank lines. A naive "next line" read returns empty for ~500 questions.
 */
function extractAnswer(body) {
  const m = body.match(/Correct\s+[Aa]nswer\s*:?\s*([\s\S]*)$/i);
  if (!m) return null;
  const rest = m[1];
  const lines = rest.split('\n');
  for (const line of lines) {
    const t = line.replace(/<\/?[a-z][^>]*>/gi, '').trim();
    if (t === '') continue;
    return { value: t, remainder: lines.slice(lines.indexOf(line) + 1) };
  }
  return null;
}

/** Pull an explanation and/or a bare reference URL out of the block body. */
function extractExplanation(body) {
  // Remove the "Correct Answer: X" line and everything before it.
  // NOTE: the label may be followed by a blank line (sets 13-23), so do not anchor
  // to the end of that line — cut only the label and its own value.
  // The value class must NOT include lowercase e, or it eats the "E" of "Explanation".
  // Values appear as "B", "B, E", "AB", "A,B", "Ac" — consume the whole run.
  const answerRe = /^[\s\S]*?Correct\s+[Aa]nswer\s*:?[ \t]*[A-Ea-e](?:[ \t,;]*[A-Ea-e])*/i;
  const afterAnswer = body.replace(answerRe, '');

  // Drop a leading "Explanation:" label if present, keeping its body.
  const deLabelled = afterAnswer.replace(/^\s*Explanation\s*:\s*/i, '');

  const text = cleanExplanation(deLabelled);
  if (!text) return { explanation: null, refUrl: null };

  // A bare URL (upstream wraps these in angle brackets).
  const bare = text.match(/^<?(https?:\/\/[^\s<>]+)>?\.?$/);
  if (bare) return { explanation: null, refUrl: bare[1] };

  // Otherwise keep the prose, but note a URL if one is present.
  const anyUrl = text.match(/https?:\/\/[^\s<>)]+/);
  return {
    explanation: text,
    refUrl: anyUrl ? anyUrl[0].replace(/[.,;]+$/, '') : null,
  };
}

/**
 * Clean an explanation body. Upstream explanations are frequently junk: bare "-", "- -",
 * "(10)", or numbers. Those are treated as "no explanation" rather than stored.
 */
function cleanExplanation(raw) {
  const text = protectUrls(raw)
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // Strip leading/trailing bullet dash runs: "- ", "- - ", trailing " -"
  let out = text.replace(/^[-\s]+/, '').replace(/[-\s]+$/, '').trim();
  out = restoreUrls(out);

  // Treat placeholder junk as absent: "(10)", "10", "-", "", single tokens without letters.
  if (!out) return '';
  if (/^\(?\d+\)?$/.test(out)) return '';
  if (!/[a-zA-Z]{2,}/.test(out)) return '';

  return out;
}

/**
 * Angle-bracketed URLs such as <https://calculator.aws/#/> look exactly like HTML tags to a
 * naive <[^>]*> strip, which deletes them entirely. Swap them out first.
 */
const URL_MARK = '\u0000URL\u0000';
const urlStore = [];
function protectUrls(s) {
  urlStore.length = 0;
  return s.replace(/<(https?:\/\/[^\s>]+)>/g, (_, u) => {
    urlStore.push(u);
    return `${URL_MARK}${urlStore.length - 1}${URL_MARK}`;
  }).replace(/(?<!<)(https?:\/\/[^\s>]+)(?!>)/g, (u) => {
    urlStore.push(u);
    return `${URL_MARK}${urlStore.length - 1}${URL_MARK}`;
  });
}
function restoreUrls(s) {
  return s.replace(new RegExp(`${URL_MARK}(\\d+)${URL_MARK}`, 'g'), (_, i) => urlStore[Number(i)]);
}

/** A "useful" explanation is one with real prose, not a truncated fragment. */
function isUsefulExplanation(text) {
  if (!text) return false;
  if (text.length < 12) return false;
  if (!/[a-zA-Z]{2,}/.test(text)) return false;
  return true;
}

function parseFile(text, setName) {
  const questions = [];
  const warnings = [];

  // Strip the YAML front matter (--- layout: exam ---) and the "# Practice Exam N"
  // heading, which would otherwise leak into the first question's stem.
  // Note: question text can contain "---", so only the leading block is removed.
  let body = text.replace(/^\s*---[\s\S]*?---\s*/, '');
  body = body.replace(/^\s*#[^\n]*\n/, '');

  // Split on <details> — NEVER on question numbers (exam 13 numbers everything "1.").
  // The question's stem + options live in the text BEFORE each <details> tag.
  const starts = [];
  const re = /<details/gi;
  let m;
  while ((m = re.exec(body)) !== null) starts.push(m.index);

  const chunks = starts.map((detailsStart, i) => {
    const closeIdx = body.indexOf('</details>', detailsStart);
    if (closeIdx === -1) warnings.push(`${setName}: unclosed <details> at offset ${detailsStart}`);
    return {
      contentStart: i === 0 ? 0 : body.indexOf('</details>', starts[i - 1]) + '</details>'.length,
      detailsStart,
      detailsEnd: closeIdx === -1 ? body.length : closeIdx + '</details>'.length,
    };
  });

  chunks.forEach((chunk, i) => {
    const content = body.slice(chunk.contentStart, chunk.detailsStart);
    const blockBody = body.slice(chunk.detailsStart, chunk.detailsEnd);
    const parsed = parseQuestionContent(content, blockBody, setName, i + 1, warnings);
    if (parsed) questions.push(parsed);
  });

  return { questions, warnings };
}

function parseQuestionContent(content, blockBody, setName, position, warnings) {
  const lines = content.split('\n').map((l) => l.replace(/\r$/, ''));

  const stemLines = [];
  const options = [];
  let seenOption = false;

  for (const line of lines) {
    // Option: "- A." ... (dash + dot, always, per verified data)
    const opt = line.match(/^\s*[-*]\s*([A-E])[.)]\s*(.*)$/);
    if (opt) {
      seenOption = true;
      options.push({ letter: opt[1], text: cleanText(opt[2]) });
      continue;
    }
    // Question stem: "1." (or any number) — strip the number.
    const stem = line.match(/^\s*\d+\.\s*(.*)$/);
    if (stem && !seenOption) {
      stemLines.push(stem[1]);
      continue;
    }
    if (!seenOption && line.trim() !== '') {
      stemLines.push(line.trim());
    }
  }

  const stem = cleanText(stemLines.join(' '));
  if (!options.length) {
    warnings.push(`${setName} pos ${position}: no options found — skipped`);
    return null;
  }
  if (!stem) {
    warnings.push(`${setName} pos ${position}: empty stem — skipped`);
    return null;
  }

  const ans = extractAnswer(blockBody);
  if (!ans) {
    warnings.push(`${setName} pos ${position}: no "Correct answer" label — skipped`);
    return null;
  }

  const answers = parseAnswerLetters(ans.value);
  if (!answers.length) {
    warnings.push(`${setName} pos ${position}: unparseable answer "${ans.value}" — skipped`);
    return null;
  }

  // Every answer letter must exist among this question's options.
  const optLetters = new Set(options.map((o) => o.letter));
  const missing = answers.filter((a) => !optLetters.has(a));
  if (missing.length) {
    warnings.push(
      `${setName} pos ${position}: answer ${answers.join('')} references missing option(s) ${missing.join(',')} — skipped`
    );
    return null;
  }

  const { explanation, refUrl } = extractExplanation(blockBody);
  if (!isUsefulExplanation(explanation) && !refUrl) {
    return {
      id: `e${setName}q${String(position).padStart(2, '0')}`,
      set: setName,
      setPos: position,
      stem,
      options,
      answers,
      multi: answers.length > 1,
      explanation: null,
      refUrl: null,
      dupeKey: dupeKeyFor(stem),
    };
  }

  return {
    id: `e${setName}q${String(position).padStart(2, '0')}`,
    set: setName,
    setPos: position,
    stem,
    options,
    answers,
    multi: answers.length > 1,
    explanation,
    refUrl,
    dupeKey: dupeKeyFor(stem),
  };
}

/** Normalized stem hash used to find the same question across sets. */
function dupeKeyFor(stem) {
  const norm = stem
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return crypto.createHash('sha1').update(norm).digest('hex').slice(0, 16);
}

/* -------------------------------------------------------------------- main */

async function main() {
  console.log('Fetching and parsing upstream practice exams...\n');

  const allQuestions = [];
  const sets = [];
  const allWarnings = [];

  for (let n = 1; n <= SET_COUNT; n++) {
    const text = await fetchSet(n);
    const { questions, warnings } = parseFile(text, n);
    allQuestions.push(...questions);
    sets.push({ set: n, title: `Practice Exam ${n}`, count: questions.length });
    allWarnings.push(...warnings);
    console.log(`  practice-exam-${n}.md  ->  ${String(questions.length).padStart(3)} questions`);
  }

  console.log(`\n  TOTAL: ${allQuestions.length} questions across ${sets.length} sets`);

  /* ------------------------------------------------------- validation pass */

  const errors = [];

  const idSeen = new Set();
  for (const q of allQuestions) {
    if (idSeen.has(q.id)) errors.push(`duplicate id ${q.id}`);
    idSeen.add(q.id);
    if (q.options.length < 2) errors.push(`${q.id}: fewer than 2 options`);
    if (!q.stem) errors.push(`${q.id}: empty stem`);
    for (const a of q.answers) {
      if (!q.options.some((o) => o.letter === a)) errors.push(`${q.id}: answer ${a} has no option`);
    }
    if (q.multi !== q.answers.length > 1) errors.push(`${q.id}: multi flag mismatch`);
  }

  /* ------------------------------------------------------------- reporting */

  const single = allQuestions.filter((q) => q.answers.length === 1).length;
  const multi = allQuestions.filter((q) => q.answers.length > 1).length;
  const withExplain = allQuestions.filter((q) => q.explanation || q.refUrl).length;
  const withRefOnly = allQuestions.filter((q) => q.refUrl && !q.explanation).length;

  const byKey = new Map();
  for (const q of allQuestions) {
    if (!byKey.has(q.dupeKey)) byKey.set(q.dupeKey, []);
    byKey.get(q.dupeKey).push(q.id);
  }
  const dupeGroups = [...byKey.values()].filter((g) => g.length > 1);
  const dupeQuestionCount = dupeGroups.reduce((s, g) => s + g.length, 0);

  console.log('\n--- Sync report ---');
  console.log(`  single-answer questions : ${single}`);
  console.log(`  multi-answer questions  : ${multi}`);
  console.log(`  with explanation or ref : ${withExplain}  (ref-only: ${withRefOnly})`);
  console.log(`  duplicate stems         : ${dupeGroups.length} group(s), ${dupeQuestionCount} question(s)`);
  console.log(`  unique questions        : ${allQuestions.length - (dupeQuestionCount - dupeGroups.length)}`);

  if (dupeGroups.length) {
    console.log('\n  Duplicate groups (first 10):');
    for (const g of dupeGroups.slice(0, 10)) console.log(`    ${g.join(', ')}`);
  }

  if (allWarnings.length) {
    console.log(`\n  WARNINGS (${allWarnings.length}):`);
    for (const w of allWarnings.slice(0, 30)) console.log(`    - ${w}`);
    if (allWarnings.length > 30) console.log(`    ... and ${allWarnings.length - 30} more`);
  } else {
    console.log('\n  WARNINGS: none');
  }

  if (errors.length) {
    console.error(`\nVALIDATION FAILED (${errors.length} error(s)) — nothing written:`);
    for (const e of errors.slice(0, 50)) console.error(`  - ${e}`);
    process.exit(1);
  }

  // Sanity floor: a partial scrape must never overwrite good data.
  if (allQuestions.length < 1000) {
    console.error(`\nOnly ${allQuestions.length} questions parsed (expected ~1142). Refusing to write.`);
    process.exit(1);
  }

  /* ----------------------------------------------------------------- write */

  const uniqueQuestions = allQuestions.length - (dupeQuestionCount - dupeGroups.length);
  const examsJson = {
    generatedAt: new Date().toISOString(),
    source:
      'https://github.com/kananinirav/AWS-Certified-Cloud-Practitioner-Notes/tree/master/practice-exam',
    sets,
    totalQuestions: allQuestions.length,
    uniqueQuestions,
    duplicates: {
      groups: dupeGroups.length,
      questions: dupeQuestionCount,
      sample: dupeGroups.slice(0, 20),
    },
  };

  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(path.join(DATA_DIR, 'questions.json'), JSON.stringify(allQuestions), 'utf8');
  await fs.writeFile(path.join(DATA_DIR, 'exams.json'), JSON.stringify(examsJson, null, 2), 'utf8');

  console.log(`\nWrote data/questions.json (${allQuestions.length}) and data/exams.json`);
  console.log('Done.');
}

main().catch((e) => {
  console.error('\nSYNC FAILED:', e.message);
  process.exit(1);
});
