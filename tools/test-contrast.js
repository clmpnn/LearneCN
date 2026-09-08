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
/* LearneCN — does the palette actually read?

   The colours are declared once, as custom properties at the top of
   style.css, and then used everywhere. So the place to catch an unreadable
   pairing is the palette itself rather than the eight hundred rules that
   draw on it: if --muted clears 4.5:1 against every ground it can land on,
   every piece of secondary text on the site clears it too.

   That is not a theoretical worry. --muted shipped at #776f61, which is 4.22
   against paper and 3.75 inside a well, and --gamboge-ink shipped with the
   comment "dark enough to read as text" above a value that measured 4.20.
   Both were chosen by eye, both looked fine, and neither passed.

   This reads the real values out of css/style.css — light theme and dark —
   and checks each text colour against each background it is used on.

       node tools/test-contrast.js
*/

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.dirname(__dirname);
const CSS = path.join(ROOT, 'css', 'style.css');

/* WCAG 2.1 AA: 4.5:1 for body text, 3:1 for large text and for the boundary
   of a control. Everything below is body text unless it says otherwise. */
const AA = 4.5;
const AA_LARGE = 3;

/* Which foreground is drawn on which background. A pair listed here is a pair
   the stylesheets actually produce; adding a colour to the palette without
   adding it here is how a check like this quietly stops covering anything. */
const GROUNDS = ['paper', 'paper-deep', 'card'];
const PAIRS = [
  ['ink',         GROUNDS, AA,       'body text'],
  ['ink-2',       GROUNDS, AA,       'secondary text, nav links'],
  ['muted',       GROUNDS, AA,       'hints, labels, captions, empty states'],
  ['cinnabar',    GROUNDS, AA_LARGE, 'headline numerals and marks, all large'],
  ['gamboge-ink', GROUNDS, AA,       'eyebrows and tone labels'],
  /* The boundary of a form field: an empty input has no text of its own, so
     under WCAG 1.4.11 the border is what identifies it and owes 3:1. */
  ['edge',        ['paper', 'card'], AA_LARGE, 'form-field boundaries'],
];

/* --rule is deliberately not in that list. It draws separators — the hairline
   under a heading, the line between two rows — and it draws the outline of
   buttons and chips. Neither is a boundary WCAG 1.4.11 requires: a separator
   is not a user interface component, and a button here is identified by the
   word printed on it in --ink at 12:1, not by its edge. Taking --rule to 3:1
   would put a mid-brown box around every control on the site to satisfy a
   rule that was not asking. Form fields are the case where the boundary
   genuinely is the only identification, and those use --edge above. */

/* --------------------------------------------------------------------- */

function palette(css) {
  /* :root holds the light theme; the prefers-color-scheme block overrides it. */
  const light = {}, dark = {};
  const rootBody = css.slice(css.indexOf(':root {') + 7);
  const decl = /--([a-z0-9-]+)\s*:\s*(#[0-9a-fA-F]{3,8})/g;

  const darkStart = css.indexOf('prefers-color-scheme: dark');
  const lightText = css.slice(0, darkStart < 0 ? css.length : darkStart);
  const darkText = darkStart < 0 ? '' : css.slice(darkStart);

  let m;
  while ((m = decl.exec(lightText)) !== null) if (!(m[1] in light)) light[m[1]] = m[2];
  decl.lastIndex = 0;
  while ((m = decl.exec(darkText)) !== null) if (!(m[1] in dark)) dark[m[1]] = m[2];
  void rootBody;
  return { light, dark: Object.assign({}, light, dark) };
}

const srgb = hex => {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h.slice(0, 6);
  return [0, 2, 4].map(i => parseInt(full.slice(i, i + 2), 16));
};

const channel = c => {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
};

const luminance = rgb =>
  0.2126 * channel(rgb[0]) + 0.7152 * channel(rgb[1]) + 0.0722 * channel(rgb[2]);

function contrast(a, b) {
  const la = luminance(srgb(a)), lb = luminance(srgb(b));
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/* --------------------------------------------------------------------- */

let passed = 0;
const failures = [];

function check(theme, colours) {
  for (const [fg, grounds, need, what] of PAIRS) {
    if (!colours[fg]) {
      failures.push(`${theme}: --${fg} is not defined`);
      continue;
    }
    for (const bg of grounds) {
      if (!colours[bg]) {
        failures.push(`${theme}: --${bg} is not defined`);
        continue;
      }
      const r = contrast(colours[fg], colours[bg]);
      const ok = r >= need;
      if (ok) passed++;
      else failures.push(
        `${theme}: --${fg} (${colours[fg]}) on --${bg} (${colours[bg]}) ` +
        `is ${r.toFixed(2)}:1, needs ${need} — ${what}`);
    }
  }
}

const css = fs.readFileSync(CSS, 'utf8');
const { light, dark } = palette(css);

if (!Object.keys(light).length) {
  console.error('No custom properties found in css/style.css — has the palette moved?');
  process.exit(1);
}

check('light', light);
check('dark', dark);

for (const f of failures) console.log('  fail  ' + f);
console.log(`\n${passed} pairing(s) pass, ${failures.length} fail`);

if (failures.length) {
  console.error('\nThe palette has a pairing that cannot be read. ' +
                'Darken the text colour rather than lightening the ground: ' +
                'the grounds are the paper, and the paper is the design.');
  process.exit(1);
}
console.log('Every text colour reads against every ground it lands on.');
