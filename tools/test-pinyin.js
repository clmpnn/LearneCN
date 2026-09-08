/*
 * LearneCN — https://github.com/clmpnn/LearneCN
 * Copyright (C) 2026 clmpnn
 *
 * This program is free software: you can redistribute it and/or modify it under
 * the terms of the GNU General Public License as published by the Free Software
 * Foundation, either version 3 of the License, or (at your option) any later
 * version.
 *
 * This program is distributed in the hope that it will be useful, but WITHOUT ANY
 * WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A
 * PARTICULAR PURPOSE. See the GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License along with
 * this program. If not, see <https://www.gnu.org/licenses/>.
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
/* Checks how typed readings are compared against the expected one.
   Run with: node tools/test-pinyin.js

   The case that matters most here is ü. In NFD, ǚ is u + diaeresis + caron,
   so any normaliser that strips every combining mark in one pass silently
   turns nǚ into nu — which marks 女 and 努 as the same word and prints 女
   back to the learner as nǔ. */

'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

/* Enough of a browser for app.js to finish evaluating. */
const noop = () => {};
const stubNode = {
  addEventListener: noop, append: noop, setAttribute: noop,
  className: '', textContent: '', style: {}
};
const sandbox = {
  console,
  localStorage: (() => {
    const m = new Map();
    return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) };
  })(),
  document: {
    addEventListener: noop,
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: () => Object.assign({}, stubNode),
    documentElement: stubNode
  },
  getComputedStyle: () => ({ getPropertyValue: () => '' }),
  matchMedia: undefined,
  fetch: undefined,
  setTimeout, clearTimeout
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;

vm.createContext(sandbox);
/* app.js declares `const CN`, and a top-level const is a lexical binding
   rather than a property of the global object, so it has to be handed out
   explicitly to be visible from here. */
const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'app.js'), 'utf8');
vm.runInContext(source + '\n;globalThis.__CN = CN;\n', sandbox);
const CN = sandbox.__CN;
if (!CN) { console.error('app.js did not expose CN'); process.exit(1); }

let pass = 0, fail = 0;
function ok(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  ok    ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
}

console.log('\nReadings that should match');
const same = [
  ['ai4', 'ai4'], ['ài', 'ai4'], ['AI4', 'ai4'], ['  ai4  ', 'ai4'],
  ['ni3 hao3', 'ni3 hao3'], ['nǐ hǎo', 'ni3 hao3'], ['nǐhǎo', 'ni3 hao3'],
  ['ni3hao3', 'ni3 hao3'], ['ba4ba5', 'ba4ba5'], ['bàba', 'ba4ba5'],
  ['ba4ba', 'ba4ba5'], ['xue2xi2', 'xue2 xi2'], ['zhong1guo2', 'zhong1 guo2'],
  /* ü, spelled every way a learner might reach for */
  ['nv3', 'nv3'], ['nǚ', 'nv3'], ['nü3', 'nv3'], ['nu:3', 'nv3'],
  ['lv4', 'lv4'], ['lǜ', 'lv4'], ['lüe4', 'lve4'], ['lve4', 'lüe4'],
  ['sheng3lüe4', 'sheng3lve4']
];
for (const [given, expected] of same) {
  ok(`"${given}" = "${expected}"`, CN.comparePinyin(given, expected).ok === true,
     JSON.stringify(CN.comparePinyin(given, expected)));
}

console.log('\nReadings that should not');
const diff = [
  ['ai1', 'ai4', 'tone'], ['ai', 'ai4', 'notone'], ['e4', 'ai4', 'syllables'],
  ['', 'ai4', 'empty'], ['ni2 hao3', 'ni3 hao3', 'tone'], ['nihao', 'ni3 hao3', 'notone'],
  ['ba4ba4', 'ba4ba5', 'tone'],
  /* 女 is not 努, and 绿 is not 路 — the whole reason ü has to survive */
  ['nu3', 'nv3', 'syllables'], ['nv3', 'nu3', 'syllables'], ['nǔ', 'nv3', 'syllables'],
  ['nv2', 'nv3', 'tone'], ['lu4', 'lv4', 'syllables']
];
for (const [given, expected, reason] of diff) {
  const r = CN.comparePinyin(given, expected);
  ok(`"${given}" ≠ "${expected}" (${reason})`, r.ok === false && r.reason === reason,
     `got ok=${r.ok} reason=${r.reason}`);
}

console.log('\nTone errors are reported as [expected, got]');
{
  const r = CN.comparePinyin('ma1', 'ma3');
  ok('ma1 against ma3 reports [3, 1]',
     r.toneErrors && r.toneErrors[0][0] === 3 && r.toneErrors[0][1] === 1,
     JSON.stringify(r.toneErrors));
}

console.log('\nDictionary search stays lenient');
{
  /* The search normaliser is deliberately the other way round: somebody
     hunting for 绿 may type lu, lü or lv, and all three should find it. */
  const forms = ['lü', 'lǜ', 'lv', 'lu', 'lu:'].map(CN.plainPinyin);
  ok('every spelling of lü folds together', new Set(forms).size === 1, forms.join(' '));
  ok('tones and spacing are dropped',
     CN.plainPinyin('nǐ hǎo') === 'nihao', CN.plainPinyin('nǐ hǎo'));
}

console.log('\nNumbered pinyin renders with marks');
{
  ok('ni3 hao3 → nǐ hǎo', CN.toneMarks('ni3 hao3') === 'nǐ hǎo', CN.toneMarks('ni3 hao3'));
  ok('ma1 → mā', CN.toneMarks('ma1') === 'mā', CN.toneMarks('ma1'));
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
