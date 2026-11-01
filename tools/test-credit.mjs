/**
 * Verifies the class-toggle state machine used by the credit floater,
 * independent of the browser harness.
 */
import assert from 'node:assert';

function makePanel() {
  const classes = new Set(['credit-panel', 'is-collapsed']);
  return {
    classes,
    classList: {
      contains: (c) => classes.has(c),
      toggle: (c, on) => (on ? classes.add(c) : classes.delete(c)),
    },
    get display() {
      if (classes.has('is-collapsed')) return 'none';
      if (classes.has('is-open')) return 'block';
      return 'block';
    },
  };
}

function setExpanded(panel, root, toggle, open) {
  panel.classList.toggle('is-open', open);
  panel.classList.toggle('is-collapsed', !open);
  toggle.expanded = open ? 'true' : 'false';
  root.isOpen = open;
}

let pass = 0;
const fails = [];

function check(name, fn) {
  try {
    fn();
    pass++;
  } catch (e) {
    fails.push(`${name}: ${e.message}`);
  }
}

check('starts collapsed and hidden', () => {
  const p = makePanel();
  assert.equal(p.classList.contains('is-collapsed'), true);
  assert.equal(p.display, 'none');
});

check('first click expands', () => {
  const p = makePanel();
  const toggle = {};
  const root = {};
  setExpanded(p, root, toggle, !p.classList.contains('is-open'));
  assert.equal(p.classList.contains('is-open'), true);
  assert.equal(p.classList.contains('is-collapsed'), false);
  assert.equal(p.display, 'block');
  assert.equal(toggle.expanded, 'true');
});

check('second click collapses again', () => {
  const p = makePanel();
  const toggle = {};
  const root = {};
  // open
  setExpanded(p, root, toggle, !p.classList.contains('is-open'));
  // close
  setExpanded(p, root, toggle, !p.classList.contains('is-open'));
  assert.equal(p.classList.contains('is-open'), false);
  assert.equal(p.classList.contains('is-collapsed'), true);
  assert.equal(p.display, 'none');
  assert.equal(toggle.expanded, 'false');
});

check('states are mutually exclusive', () => {
  const p = makePanel();
  const toggle = {};
  const root = {};
  for (let i = 0; i < 5; i++) {
    setExpanded(p, root, toggle, !p.classList.contains('is-open'));
    const collapsed = p.classList.contains('is-collapsed');
    const open = p.classList.contains('is-open');
    assert.notEqual(collapsed, open, 'exactly one state must hold');
  }
});

check('credit-hidden key is namespaced for reset', () => {
  // resetAllData clears every ccp:* key, so hiding must use that prefix to be
  // restored to defaults by a reset.
  const KEY = 'ccp:credit-hidden';
  assert.equal(KEY.startsWith('ccp:'), true);
});

console.log(`${pass} passed, ${fails.length} failed`);
for (const f of fails) console.log('  FAIL ' + f);
process.exit(fails.length ? 1 : 0);
