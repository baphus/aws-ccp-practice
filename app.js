/* ============================================================================
   AWS CCP Practice — shared app logic
   Vanilla JS. No framework, no build step.
   Screens: home (index.html) | sets (sets.html) | exam | results
   ========================================================================== */

'use strict';

/* ------------------------------------------------------------------ config */

const STORAGE_KEY = 'ccp:progress:v1';
const HISTORY_LIMIT = 20;
const MULTI_HINT = { 2: 'Select 2', 3: 'Select 3', 4: 'Select 4', 5: 'Select 5' };

/* ------------------------------------------------------------------- state */

let BANK = [];          // all questions
let BANK_BY_ID = new Map();
let EXAMS = null;       // data/exams.json
let UNIQUE = [];        // de-duplicated pool for mock exams

/** Active exam session (in memory only; nothing mid-exam is persisted). */
let session = null;

/* ----------------------------------------------------------------- storage */

function defaultStore() {
  return { version: 1, sets: {}, mock: {}, history: [], missed: {} };
}

function loadStore() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultStore();
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return defaultStore();
    if (parsed.version !== 1) return defaultStore();
    // Defensive: guarantee the shape the UI relies on.
    return {
      version: 1,
      sets: parsed.sets && typeof parsed.sets === 'object' ? parsed.sets : {},
      mock: parsed.mock && typeof parsed.mock === 'object' ? parsed.mock : {},
      history: Array.isArray(parsed.history) ? parsed.history : [],
      missed: parsed.missed && typeof parsed.missed === 'object' ? parsed.missed : {},
    };
  } catch (err) {
    console.warn('Stored progress was unreadable; starting fresh.', err);
    return defaultStore();
  }
}

function saveStore(store) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
    return true;
  } catch (err) {
    console.warn('Could not save progress (storage full or blocked).', err);
    return false;
  }
}

/** Wipe all saved progress for this site. Returns true when the data is gone. */
function clearStore() {
  try {
    localStorage.removeItem(STORAGE_KEY);
    // Anything else this app may have written under its own prefix.
    Object.keys(localStorage)
      .filter((k) => k.startsWith('ccp:'))
      .forEach((k) => localStorage.removeItem(k));
    return true;
  } catch (err) {
    console.warn('Could not clear stored progress.', err);
    return false;
  }
}

/** Download the saved progress as JSON. */
function exportStore() {
  const raw = localStorage.getItem(STORAGE_KEY) || JSON.stringify(defaultStore());
  const blob = new Blob([raw], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `aws-ccp-progress-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.append(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(a.href);
}

/** Replace saved progress from a JSON file the user picked. */
function importStore(file) {
  return file
    .text()
    .then((text) => {
      const parsed = JSON.parse(text);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('That file is not an AWS CCP Practice backup.');
      }
      const normalised = {
        version: 1,
        sets: parsed.sets && typeof parsed.sets === 'object' ? parsed.sets : {},
        mock: parsed.mock && typeof parsed.mock === 'object' ? parsed.mock : {},
        history: Array.isArray(parsed.history) ? parsed.history.slice(0, HISTORY_LIMIT) : [],
        missed: parsed.missed && typeof parsed.missed === 'object' ? parsed.missed : {},
      };
      const ok = saveStore(normalised);
      if (!ok) throw new Error('Could not write to storage.');
      return true;
    })
    .catch((err) => {
      throw err instanceof SyntaxError ? new Error('That file is not valid JSON.') : err;
    });
}

/**
 * Confirm + perform a full reset, then repaint the current screen so badges and
 * counters clear immediately.
 */
async function resetAllData() {
  const hasData = !!localStorage.getItem(STORAGE_KEY);
  const ok = await askConfirm({
    title: 'Reset all saved data?',
    body: hasData
      ? 'This deletes every score, best result, missed-question list and attempt history on this device. It cannot be undone. Export a backup first if you want to keep it.'
      : 'There is no saved progress to delete on this device. Your settings for this session will still be cleared.',
    confirmText: 'Reset everything',
    cancelText: 'Cancel',
    destructive: true,
  });
  if (!ok) return false;

  const cleared = clearStore();
  if (!cleared) {
    await askConfirm({
      title: 'Could not reset',
      body: 'Your browser blocked access to local storage, so nothing was deleted.',
      confirmText: 'OK',
      cancelText: 'Close',
    });
    return false;
  }

  // Refresh whichever screen is showing.
  document.body.classList.remove('is-exam');
  session = null;
  if (document.body.dataset.page === 'sets') renderSets();
  else renderHome();
  return true;
}

function recordAttempt({ mode, setName, score, total, seconds, missedIds }) {
  const store = loadStore();
  const bucketKey = mode === 'mock' ? 'mock' : String(setName);
  const bucket = mode === 'mock' ? store.mock : store.sets[bucketKey] || (store.sets[bucketKey] = {});

  const at = new Date().toISOString();
  bucket.lastScore = score;
  bucket.lastTotal = total;
  bucket.lastAt = at;
  bucket.bestScore = Math.max(bucket.bestScore ?? 0, score);
  bucket.bestTotal = total;

  store.history.unshift({ mode, set: mode === 'mock' ? null : setName, score, total, seconds, at });
  store.history = store.history.slice(0, HISTORY_LIMIT);

  store.missed[bucketKey] = missedIds;

  saveStore(store);
}

/* ---------------------------------------------------------------- utilities */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

function el(tag, attrs = {}, ...kids) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v);
  }
  for (const kid of kids.flat()) {
    if (kid === null || kid === undefined || kid === false) continue;
    node.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return node;
}

function fmtClock(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(sec).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function pct(score, total) {
  return total ? Math.round((score / total) * 100) : 0;
}

function badgeTone(percent) {
  if (percent >= 80) return 'good';
  if (percent >= 60) return 'mid';
  return 'bad';
}

/* --------------------------------------------------------------- data load */

async function loadData() {
  const bust = window.__APP_VERSION ? `?v=${window.__APP_VERSION}` : '';
  const [questionsRes, examsRes] = await Promise.all([
    fetch(`data/questions.json${bust}`),
    fetch(`data/exams.json${bust}`),
  ]);
  if (!questionsRes.ok || !examsRes.ok) throw new Error('Could not load the question bank.');
  BANK = await questionsRes.json();
  EXAMS = await examsRes.json();
  BANK_BY_ID = new Map(BANK.map((q) => [q.id, q]));

  // De-duplicate for the random mock-exam pool only; practice sets keep all questions.
  const seen = new Set();
  UNIQUE = BANK.filter((q) => {
    if (seen.has(q.dupeKey)) return false;
    seen.add(q.dupeKey);
    return true;
  });
}

/* ------------------------------------------------------------------- exam */

function startExam({ mode, questions, setName, title, shuffleOn }) {
  const list = shuffleOn ? shuffle(questions) : questions.slice();
  session = {
    mode,
    setName,
    title,
    questions: list,
    answers: new Map(),   // questionId -> [letters]
    index: 0,
    startedAt: Date.now(),
    timerId: null,
  };
  showExam();
  session.timerId = setInterval(tickClock, 1000);
}

function elapsedSeconds() {
  return session ? Math.floor((Date.now() - session.startedAt) / 1000) : 0;
}

function tickClock() {
  const clock = $('#clock');
  if (clock) clock.textContent = fmtClock(elapsedSeconds());
}

function answeredCount() {
  return session.answers.size;
}

function showExam() {
  document.body.classList.add('is-exam');
  const root = $('#app');
  root.textContent = '';

  const total = session.questions.length;
  const q = session.questions[session.index];
  const chosen = session.answers.get(q.id) || [];

  const exam = el('section', { class: 'exam', 'aria-label': 'Practice questions' });

  /* top: progress + stats */
  exam.append(
    el(
      'div',
      { class: 'exam-top' },
      el('div', { class: 'progress', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': String(total), 'aria-valuenow': String(session.index + 1), 'aria-label': 'Exam progress' },
        el('i', { style: `width:${((session.index + 1) / total) * 100}%` })),
      el('div', { class: 'exam-stats' },
        el('span', { text: session.title }),
        el('span', { class: 'clock', id: 'clock', text: fmtClock(elapsedSeconds()) })),
      el('div', { class: 'exam-stats' },
        el('span', { text: `Answered ${answeredCount()} of ${total}` }),
        el('span', { text: `Question ${session.index + 1}` }))
    )
  );

  /* body: stem + options */
  const body = el('div', { class: 'exam-body' });
  const form = el('form', { id: 'qform', novalidate: '' });

  if (q.multi) {
    form.append(el('div', { class: 'q-hint', text: MULTI_HINT[q.answers.length] || `Select ${q.answers.length}` }));
  }
  form.append(el('h1', { class: 'q-stem', text: q.stem }));

  const opts = el('div', { class: 'options', role: q.multi ? 'group' : 'radiogroup', 'aria-labelledby': 'stem' });
  for (const opt of q.options) {
    const id = `opt-${q.id}-${opt.letter}`;
    const input = el('input', {
      type: q.multi ? 'checkbox' : 'radio',
      name: 'answer',
      id,
      value: opt.letter,
      checked: chosen.includes(opt.letter),
    });
    input.addEventListener('change', () => selectOption(q, opt.letter, input.checked));
    opts.append(
      el('label', { class: 'option', for: id },
        input,
        el('span', { class: 'letter', text: opt.letter }),
        el('span', { text: opt.text }))
    );
  }
  form.append(opts);
  body.append(form);
  exam.append(body);

  /* bottom bar */
  const bar = el('div', { class: 'exam-bar' });
  bar.append(
    el('div', { class: 'inner' },
      el('button', { class: 'btn', type: 'button', text: 'Back', disabled: session.index === 0 ? '' : null, onclick: () => go(-1) }),
      el('button', { class: 'counter-btn', type: 'button', 'aria-haspopup': 'dialog', 'aria-label': `Question ${session.index + 1} of ${total}. Open question list.`, text: `${session.index + 1}/${total}`, onclick: openSheet }),
      session.index === total - 1
        ? el('button', { class: 'btn btn-primary', type: 'button', text: 'Submit', onclick: confirmSubmit })
        : el('button', { class: 'btn btn-primary', type: 'button', text: 'Next', onclick: () => go(1) })
    )
  );
  exam.append(bar);
  exam.append(el('button', { class: 'btn btn-ghost exam-abandon', type: 'button', text: 'Abandon this attempt', onclick: abandon }));

  root.append(exam);
  tickClock();
  window.scrollTo(0, 0);
}

function selectOption(question, letter, checked) {
  const cur = new Set(session.answers.get(question.id) || []);
  if (question.multi) {
    if (checked) cur.add(letter);
    else cur.delete(letter);
  } else {
    cur.clear();
    cur.add(letter);
  }
  if (cur.size) session.answers.set(question.id, [...cur].sort());
  else session.answers.delete(question.id);

  // Refresh the "Answered n of m" line without a full re-render.
  const statLine = $$('.exam-stats')[1];
  if (statLine) statLine.firstChild.textContent = `Answered ${answeredCount()} of ${session.questions.length}`;
}

function go(delta) {
  const next = session.index + delta;
  if (next < 0 || next >= session.questions.length) return;
  session.index = next;
  showExam();
}

function jumpTo(i) {
  session.index = i;
  closeSheet();
  showExam();
}

function openSheet() {
  let backdrop = $('#sheet-backdrop');
  if (backdrop) return;

  const total = session.questions.length;
  const grid = el('div', { class: 'grid', role: 'group', 'aria-label': 'Jump to question' });

  session.questions.forEach((q, i) => {
    const isAnswered = session.answers.has(q.id);
    const state = i === session.index ? 'current' : isAnswered ? 'answered' : 'unanswered';
    grid.append(el('button', {
      type: 'button',
      'data-state': state,
      'data-answered': isAnswered ? 'true' : 'false',
      'aria-label': `Question ${i + 1}${isAnswered ? ', answered' : ''}`,
      'aria-current': i === session.index ? 'true' : null,
      text: String(i + 1),
      onclick: () => jumpTo(i),
    }));
  });

  const sheet = el('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Question list' });
  sheet.append(
    el('div', { class: 'row-between' },
      el('h2', { text: 'Questions' }),
      el('button', { class: 'btn btn-ghost', type: 'button', text: 'Close', onclick: closeSheet })),
    grid,
    el('div', { class: 'legend-row', 'aria-hidden': 'true' },
      el('span', {}, el('i', { 'data-state': 'answered' }), 'Answered'),
      el('span', {}, el('i', {}), 'Not answered'),
      el('span', {}, el('i', { 'data-state': 'current' }), 'Current'))
  );

  backdrop = el('div', { class: 'sheet-backdrop', id: 'sheet-backdrop', onclick: (e) => { if (e.target === backdrop) closeSheet(); } });
  backdrop.append(sheet);
  document.body.append(backdrop);
  sheet.querySelector('button[data-state="current"]')?.focus();
  document.addEventListener('keydown', onSheetKey);
}

function closeSheet() {
  $('#sheet-backdrop')?.remove();
  document.removeEventListener('keydown', onSheetKey);
}

function onSheetKey(e) {
  if (e.key === 'Escape') closeSheet();
}

/**
 * In-page confirmation dialog. window.confirm() is deliberately avoided: it blocks
 * rendering, cannot be styled, and behaves inconsistently in installed PWAs.
 */
function askConfirm({ title, body, confirmText = 'Continue', cancelText = 'Cancel', destructive = false }) {
  return new Promise((resolve) => {
    const prevFocus = document.activeElement;

    const close = (result) => {
      overlay.remove();
      document.removeEventListener('keydown', onKey);
      if (prevFocus && prevFocus.focus) prevFocus.focus();
      resolve(result);
    };

    const onKey = (e) => {
      if (e.key === 'Escape') close(false);
    };

    const dialog = el('div', {
      class: 'sheet',
      role: 'alertdialog',
      'aria-modal': 'true',
      'aria-labelledby': 'confirm-title',
      'aria-describedby': 'confirm-body',
    });

    dialog.append(
      el('h2', { id: 'confirm-title', text: title }),
      el('p', { id: 'confirm-body', class: 'toggle-label', text: body, style: 'margin:0 0 1rem' }),
      el('div', { class: 'btn-row', style: 'margin-top:0; justify-content:flex-end' },
        el('button', { class: 'btn', type: 'button', text: cancelText, onclick: () => close(false) }),
        el('button', {
          // Cloudscape: one primary per page, and destructive actions are not it.
          class: destructive ? 'btn btn-danger' : 'btn btn-primary',
          type: 'button',
          text: confirmText,
          onclick: () => close(true),
        }))
    );

    const overlay = el('div', { class: 'sheet-backdrop', onclick: (e) => { if (e.target === overlay) close(false); } }, dialog);
    document.body.append(overlay);
    // Focus the safe action first so Enter never triggers a destructive default.
    dialog.querySelector('.btn-row .btn').focus();
    document.addEventListener('keydown', onKey);
  });
}

function sessionReturnUrl() {
  return document.body.dataset.page === 'sets' ? 'sets.html' : 'index.html';
}

async function confirmSubmit() {
  const total = session.questions.length;
  const unanswered = total - answeredCount();
  if (unanswered > 0) {
    const ok = await askConfirm({
      title: 'Submit with answers missing?',
      body: `You have ${unanswered} unanswered question${unanswered === 1 ? '' : 's'} out of ${total}. Those will be scored as incorrect.`,
      confirmText: 'Submit anyway',
      cancelText: 'Keep answering',
    });
    if (!ok) return;
  }
  submitExam();
}

async function abandon() {
  const ok = await askConfirm({
    title: 'Abandon this attempt?',
    body: 'Your answers will be lost and nothing will be saved.',
    confirmText: 'Abandon',
    cancelText: 'Keep going',
    destructive: true,
  });
  if (!ok) return;
  clearInterval(session.timerId);
  session = null;
  document.body.classList.remove('is-exam');
  window.location.href = sessionReturnUrl();
}

/* ---------------------------------------------------------------- results */

function submitExam() {
  clearInterval(session.timerId);
  const secs = elapsedSeconds();

  const results = session.questions.map((q) => {
    const given = session.answers.get(q.id) || [];
    const correct = given.length === q.answers.length && given.every((l) => q.answers.includes(l));
    return { q, given, correct };
  });

  const score = results.filter((r) => r.correct).length;
  const total = results.length;
  const missedIds = results.filter((r) => !r.correct).map((r) => r.q.id);

  recordAttempt({
    mode: session.mode,
    setName: session.setName,
    score,
    total,
    seconds: secs,
    missedIds,
  });

  const finished = { mode: session.mode, setName: session.setName, title: session.title, results, score, total, secs, missedIds };
  session = null;
  showResults(finished);
}

function showResults(data) {
  document.body.classList.remove('is-exam');
  const root = $('#app');
  root.textContent = '';
  window.scrollTo(0, 0);

  const percent = pct(data.score, data.total);
  const missedCount = data.missedIds.length;

  root.append(
    el('h1', { text: data.title }),
    el('div', { class: 'score-hero' },
      el('div', { class: 'score-big', text: `${data.score} / ${data.total}` }),
      el('div', { class: 'score-pct', text: `${percent}% · ${percent >= 80 ? 'Nice work' : percent >= 60 ? 'Getting there' : 'Keep practising'} · ${fmtClock(data.secs)}` }))
  );

  const actions = el('div', { class: 'btn-row' });
  actions.append(
    el('button', {
      class: 'btn btn-primary',
      type: 'button',
      text: missedCount ? `Practice my ${missedCount} missed` : 'All correct!',
      disabled: missedCount ? null : '',
      onclick: () => practiceMissed(data),
    }),
    el('button', { class: 'btn', type: 'button', text: 'Retake same set', onclick: () => retake(data) }),
    el('a', { class: 'btn', href: sessionReturnUrl(), text: 'Done' })
  );
  root.append(actions);

  root.append(el('h2', { text: 'Review' }));

  const list = el('div', { class: 'review-list' });
  data.results.forEach((r, i) => {
    const result = r.correct ? 'correct' : r.given.length ? 'wrong' : 'blank';
    const item = el('div', { class: 'review-item', 'data-result': result });
    item.append(el('p', { class: 'rq' }, el('span', { class: 'num', text: `${i + 1}.` }), r.q.stem));

    // Show every option as TEXT, marking the correct one(s) and what you picked.
    // Letters alone are useless when reviewing: you cannot remember what "B" said.
    const optionList = el('ul', { class: 'review-options' });
    for (const opt of r.q.options) {
      const isKey = r.q.answers.includes(opt.letter);
      const isYours = r.given.includes(opt.letter);
      let mark = '';
      if (isKey && isYours) mark = 'Your answer · correct';
      else if (isKey) mark = 'Correct answer';
      else if (isYours) mark = 'Your answer';

      optionList.append(
        el(
          'li',
          {
            class: 'review-option',
            'data-key': isKey ? 'true' : 'false',
            'data-yours': isYours ? 'true' : 'false',
          },
          el('span', { class: 'letter', text: opt.letter }),
          el('span', { class: 'opt-text', text: opt.text }),
          mark ? el('span', { class: 'opt-mark', text: mark }) : null
        )
      );
    }
    item.append(optionList);

    if (!r.given.length) {
      item.append(el('p', { class: 'answer-line blank-note' }, el('span', { class: 'lbl', text: 'You did not answer this question.' })));
    }

    const explainParts = [];
    if (r.q.explanation) explainParts.push(el('span', { text: r.q.explanation }));
    if (r.q.refUrl) {
      if (explainParts.length) explainParts.push(document.createTextNode(' '));
      explainParts.push(
        el('span', {}, document.createTextNode('Reference: '), el('a', { href: r.q.refUrl, target: '_blank', rel: 'noopener noreferrer', text: r.q.refUrl }))
      );
    }
    if (explainParts.length) item.append(el('div', { class: 'explain' }, explainParts));

    list.append(item);
  });
  root.append(list);
}

function retake(data) {
  if (data.mode === 'mock') {
    // Same length, fresh random draw — that is what makes a mock exam "mock".
    const pool = UNIQUE.slice();
    const n = Math.min(data.total, pool.length);
    startExam({ mode: 'mock', questions: shuffle(pool).slice(0, n), setName: null, title: 'Mock Exam', shuffleOn: false });
  } else {
    const set = EXAMS.sets.find((s) => s.set === data.setName);
    const qs = BANK.filter((q) => q.set === data.setName);
    startExam({ mode: 'set', questions: qs, setName: data.setName, title: set ? set.title : `Practice Exam ${data.setName}`, shuffleOn: false });
  }
}

function practiceMissed(data) {
  const qs = data.missedIds.map((id) => BANK_BY_ID.get(id)).filter(Boolean);
  if (!qs.length) return;
  startExam({ mode: 'missed', questions: qs, setName: data.setName, title: 'Practice missed questions', shuffleOn: false });
}

/* ------------------------------------------------------------ data controls */

/**
 * Build the Export / Import / Reset controls into any `.data-controls` element.
 * Kept in app.js (not inline in the two pages) so both pages stay in sync and the
 * reset can reuse the accessible in-page dialog.
 */
function mountDataControls() {
  document.querySelectorAll('[data-data-controls]').forEach((host) => {
    if (host.dataset.mounted === 'true') return;
    host.dataset.mounted = 'true';
    host.textContent = '';

    const fileInput = el('input', {
      type: 'file',
      accept: 'application/json,.json',
      class: 'hide',
      onchange: async (e) => {
        const file = e.target.files && e.target.files[0];
        e.target.value = '';
        if (!file) return;
        try {
          await importStore(file);
          await askConfirm({
            title: 'Backup restored',
            body: 'Your saved progress has been imported.',
            confirmText: 'OK',
            cancelText: 'Close',
          });
          if (document.body.dataset.page === 'sets') renderSets();
          else renderHome();
        } catch (err) {
          await askConfirm({
            title: 'Import failed',
            body: err.message || 'That file could not be imported.',
            confirmText: 'OK',
            cancelText: 'Close',
          });
        }
      },
    });

    host.append(
      el('div', { class: 'data-controls-row' },
        el('button', {
          class: 'btn-link', type: 'button', text: 'Export my progress',
          onclick: () => exportStore(),
        }),
        el('span', { class: 'sep', 'aria-hidden': 'true', text: '·' }),
        el('button', {
          class: 'btn-link', type: 'button', text: 'Import a backup',
          onclick: () => fileInput.click(),
        }),
        el('span', { class: 'sep', 'aria-hidden': 'true', text: '·' }),
        el('button', {
          class: 'btn-link btn-link-danger', type: 'button', text: 'Reset all my data',
          onclick: () => resetAllData(),
        })
      ),
      fileInput
    );
  });
}

/* ------------------------------------------------------------ attribution */

const CREDIT_HIDDEN_KEY = 'ccp:credit-hidden';

/**
 * Subtle bottom-left "Made by Sephus" floater.
 * Collapsed by default; clicking expands to reveal the portfolio link and a
 * Hide control. Hiding is remembered on this device. Annotation only: it must
 * never sit above the exam's sticky action bar or trap keyboard focus.
 */
function mountCredit() {
  if (document.getElementById('credit')) return;

  let hidden = false;
  try {
    hidden = localStorage.getItem(CREDIT_HIDDEN_KEY) === '1';
  } catch {
    /* storage blocked; just show it */
  }
  if (hidden) return;

  const panel = el('div', { class: 'credit-panel is-collapsed' },
    el('p', { class: 'credit-text' },
      document.createTextNode('Made by '),
      el('a', {
        href: 'https://www.sephus.tech/',
        target: '_blank',
        rel: 'noopener noreferrer',
        text: 'Sephus',
      }),
    ),
    el('div', { class: 'credit-actions' },
      el('a', {
        class: 'credit-link',
        href: 'https://www.sephus.tech/',
        target: '_blank',
        rel: 'noopener noreferrer',
        text: 'View portfolio',
      }),
      el('button', {
        class: 'credit-hide',
        type: 'button',
        text: 'Hide',
        onclick: () => hideCredit(),
      }),
    ),
  );

  const toggle = el('button', {
    class: 'credit-toggle',
    type: 'button',
    'aria-expanded': 'false',
    'aria-controls': 'credit-panel',
    onclick: () => setExpanded(!panel.classList.contains('is-open')),
  },
    el('span', { class: 'credit-dot', 'aria-hidden': 'true' }),
    el('span', { text: 'Made by Sephus' }),
  );

  panel.id = 'credit-panel';

  const root = el('div', { class: 'credit', id: 'credit' }, panel, toggle);
  document.body.append(root);

  function setExpanded(open) {
    panel.classList.toggle('is-open', open);
    panel.classList.toggle('is-collapsed', !open);
    toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    root.classList.toggle('is-open', open);
  }
}

function hideCredit() {
  try {
    localStorage.setItem(CREDIT_HIDDEN_KEY, '1');
  } catch {
    /* best effort */
  }
  document.getElementById('credit')?.remove();
}

/* ------------------------------------------------------------------ shell */

/* Reserved for per-page header state; navigation highlighting is static in the HTML. */
function renderShell() {}

/* ------------------------------------------------------------------- home */

function renderHome() {
  const root = $('#app');
  root.textContent = '';
  const store = loadStore();

  root.append(
    el('h1', { text: 'Mock Exam' }),
    el('p', { class: 'lede', text: `Random questions drawn from all ${EXAMS.totalQuestions.toLocaleString()} practice questions (${EXAMS.uniqueQuestions.toLocaleString()} unique).` })
  );

  /* Length picker — Cloudscape segmented control plus a custom amount.
     Presets stay one tap away; "Custom" reveals a number field. */
  const MAX_Q = UNIQUE.length;
  const lengths = [10, 25, 50, 65];
  let chosenLength = 65;

  const seg = el('div', { class: 'segmented', role: 'group', 'aria-label': 'How many questions' });
  const segButtons = [];

  const setPressed = (activeEl) => {
    segButtons.forEach((b) => b.setAttribute('aria-pressed', b === activeEl ? 'true' : 'false'));
  };

  /* Custom number field (hidden until "Custom" is chosen).
     Deliberately NOT type=number: the browser silently clamps out-of-range values to
     max, so "5000" would arrive as "972" and pass validation unnoticed. A text input
     with inputmode=numeric keeps the numeric keypad but lets us validate the real input. */
  const customInput = el('input', {
    type: 'text',
    id: 'custom-count',
    class: 'input',
    inputmode: 'numeric',
    pattern: '[0-9]*',
    autocomplete: 'off',
    maxlength: String(String(MAX_Q).length + 1),
    value: String(chosenLength),
    'aria-describedby': 'custom-count-help',
  });

  const customHelp = el('span', {
    id: 'custom-count-help',
    class: 'field-hint',
    text: `Enter a number from 1 to ${MAX_Q.toLocaleString()}.`,
  });

  const customError = el('span', { class: 'field-error', role: 'alert', 'aria-live': 'polite' });

  const customWrap = el('div', { class: 'custom-count hide' },
    el('label', { class: 'field-label', for: 'custom-count', text: 'Number of questions' }),
    customInput,
    customHelp,
    customError,
  );

  /** Parse and clamp the custom value. Returns null when invalid. */
  const readCustom = () => {
    const raw = String(customInput.value).trim();
    if (raw === '') return null;
    const n = Number(raw);
    if (!Number.isFinite(n) || !Number.isInteger(n)) return null;
    if (n < 1 || n > MAX_Q) return null;
    return n;
  };

  const validateCustom = () => {
    const raw = String(customInput.value).trim();
    const n = Number(raw);
    // Note: do not rely on the browser's own clamping of type=number, and treat an
    // empty field, a fraction, or an out-of-range number as a field error.
    if (raw === '' || !Number.isFinite(n)) {
      customError.textContent = 'Enter a number of questions.';
      customInput.setAttribute('aria-invalid', 'true');
      return false;
    }
    if (!Number.isInteger(n) || n < 1 || n > MAX_Q) {
      customError.textContent = `Enter a whole number between 1 and ${MAX_Q.toLocaleString()}.`;
      customInput.setAttribute('aria-invalid', 'true');
      return false;
    }
    customError.textContent = '';
    customInput.removeAttribute('aria-invalid');
    return true;
  };

  const choosePreset = (n, btn) => {
    chosenLength = n;
    setPressed(btn);
    customWrap.classList.add('hide');
    customInput.value = String(n);
    customError.textContent = '';
    customInput.removeAttribute('aria-invalid');
  };

  for (const n of lengths) {
    const b = el('button', {
      type: 'button',
      'aria-pressed': n === chosenLength ? 'true' : 'false',
      text: String(n),
      onclick: () => choosePreset(n, b),
    });
    segButtons.push(b);
    seg.append(b);
  }

  const customBtn = el('button', {
    type: 'button',
    'aria-pressed': 'false',
    text: 'Custom',
    'aria-controls': 'custom-count',
    'aria-expanded': 'false',
    onclick: () => {
      setPressed(customBtn);
      customBtn.setAttribute('aria-expanded', 'true');
      customWrap.classList.remove('hide');
      customInput.focus();
      customInput.select();
    },
  });
  segButtons.push(customBtn);
  seg.append(customBtn);

  const allChip = el('button', {
    type: 'button',
    'aria-pressed': 'false',
    text: `All (${MAX_Q.toLocaleString()})`,
    onclick: () => choosePreset(MAX_Q, allChip),
  });
  segButtons.push(allChip);
  seg.append(allChip);

  customInput.addEventListener('input', () => {
    // Keep the field to digits so validation reports range problems, not typos.
    const digits = customInput.value.replace(/[^\d]/g, '');
    if (digits !== customInput.value) customInput.value = digits;
    // Typing in the field switches the selection to Custom.
    setPressed(customBtn);
    const ok = validateCustom();
    if (ok) chosenLength = readCustom();
  });
  customInput.addEventListener('blur', validateCustom);

  const lengthField = el('fieldset', {},
    el('span', { class: 'field-label', text: 'How many questions?' }),
    seg,
    customWrap,
  );
  root.append(lengthField);

  /* shuffle toggle */
  const shuffleInput = el('input', { type: 'checkbox', id: 'shuffle', checked: '', 'aria-label': 'Shuffle question order' });
  root.append(
    el('fieldset', {},
      el('label', { class: 'switch', for: 'shuffle' }, shuffleInput, el('span', { text: 'Shuffle question order' })))
  );

  if (store.mock.lastScore != null) {
    root.append(
      el('div', { class: 'notice' },
        el('strong', { text: `Last mock score: ${store.mock.lastScore} / ${store.mock.lastTotal} (${pct(store.mock.lastScore, store.mock.lastTotal)}%)` }),
        el('br'),
        el('span', { text: `Best: ${store.mock.bestScore} / ${store.mock.bestTotal}` }))
    );
  }

  root.append(
    el('button', {
      class: 'btn btn-primary btn-block',
      type: 'button',
      text: 'Start mock exam',
      onclick: () => {
        // Re-validate at the point of action rather than only disabling the button.
        // Cloudscape guidance: validate the field, don't disable the primary action.
        if (!customWrap.classList.contains('hide')) {
          if (!validateCustom()) {
            customInput.focus();
            return;
          }
        }
        const n = Math.min(chosenLength || 1, MAX_Q);
        const picked = shuffle(UNIQUE).slice(0, n);
        startExam({ mode: 'mock', questions: picked, setName: null, title: `Mock Exam · ${n} questions`, shuffleOn: shuffleInput.checked });
      },
    })
  );

  /* Practice a previous mock's missed questions */
  const lastMissed = store.missed.mock || [];
  if (lastMissed.length) {
    root.append(el('div', { class: 'btn-row' },
      el('button', {
        class: 'btn', type: 'button', text: `Practice last mock's ${lastMissed.length} missed`,
        onclick: () => practiceMissed({ missedIds: lastMissed, setName: null }),
      })));
  }

  root.append(el('p', { class: 'toggle-label', style: 'margin-top:1.5rem', text: 'Looking for a fixed exam set? Use Practice Sets.' }));
}

/* ------------------------------------------------------------------- sets */

function renderSets() {
  const root = $('#app');
  root.textContent = '';
  const store = loadStore();

  root.append(
    el('h1', { text: 'Practice Sets' }),
    el('p', { class: 'lede', text: `${EXAMS.sets.length} exam sets, in the order they were published.` })
  );

  const list = el('ul', { class: 'set-list' });
  for (const s of EXAMS.sets) {
    const rec = store.sets[String(s.set)];
    let badge;
    if (!rec || rec.lastScore == null) {
      badge = el('span', { class: 'badge', text: 'Not attempted' });
    } else {
      const p = pct(rec.lastScore, rec.lastTotal);
      badge = el('span', {
        class: 'badge',
        'data-tone': badgeTone(p),
        title: `Best ${rec.bestScore}/${rec.bestTotal}`,
        text: `${p}%`,
      });
    }

    const btn = el('button', {
      class: 'set-item',
      type: 'button',
      'aria-label': `${s.title}, ${s.count} questions`,
      onclick: () => {
        const qs = BANK.filter((q) => q.set === s.set);
        startExam({ mode: 'set', questions: qs, setName: s.set, title: s.title, shuffleOn: false });
      },
    },
      el('span', {},
        el('span', { class: 'name', text: s.title }),
        el('br'),
        el('span', { class: 'meta', text: `${s.count} questions${rec && rec.lastScore != null ? ` · best ${rec.bestScore}/${rec.bestTotal}` : ''}` })),
      badge
    );
    list.append(el('li', {}, btn));
  }
  root.append(list);

  if (!store.history.length) {
    root.append(el('div', { class: 'notice', text: 'Your scores are saved only on this device. Nothing is uploaded anywhere.' }));
  }
}

/* ------------------------------------------------------------------- boot */

async function boot() {
  const page = document.body.dataset.page;
  const root = $('#app');
  try {
    await loadData();
  } catch (err) {
    root.textContent = '';
    root.append(
      el('h1', { text: 'Could not load questions' }),
      el('p', { class: 'lede', text: err.message }),
      el('div', { class: 'notice', text: 'If you are offline, open the app once while online so it can cache the question bank.' })
    );
    return;
  }

  if (page === 'sets') renderSets();
  else renderHome();

  mountDataControls();
  mountCredit();
}

document.addEventListener('DOMContentLoaded', () => {
  boot();
  registerServiceWorker();
});

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  // file:// cannot register a service worker; skip silently there.
  if (location.protocol !== 'http:' && location.protocol !== 'https:') return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch((err) => {
      console.warn('Service worker registration failed:', err);
    });
  });
}
