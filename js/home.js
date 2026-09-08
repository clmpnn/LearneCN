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
/* Homepage hero: a character writes itself, then hands over to the next one. */

(() => {
  const { $, cssVar } = CN;
  const target = $('#heroTarget');
  if (!target || typeof HanziWriter === 'undefined') return;

  const CYCLE = [
    { c: '学', p: 'xué', g: 'to study' },
    { c: '写', p: 'xiě', g: 'to write' },
    { c: '汉', p: 'hàn', g: 'Han, Chinese' },
    { c: '字', p: 'zì',  g: 'character' }
  ];

  const charEl = $('#heroChar'), pinyinEl = $('#heroPinyin'), glossEl = $('#heroGloss');
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let writer = null, i = 0, stopped = false;

  const size = () => Math.max(120, target.parentElement.clientWidth || 190);

  function label(item) {
    charEl.textContent = item.c;
    pinyinEl.textContent = item.p;
    glossEl.textContent = item.g;
  }

  function fallback(item) {
    // No stroke data available — still show the character in its grid.
    target.innerHTML = '';
    target.classList.add('hero-static');
    target.textContent = item.c;
  }

  /* Fetch the strokes before handing anything to Hanzi Writer.

     Letting the library do the fetching means a failed request surfaces as a
     rejected promise inside the library that nobody owns, and the console
     fills with "Failed to load char data" on every offline visit. Loading it
     here keeps the failure ours to handle: the character simply appears in
     the grid without animating. */
  async function show(item) {
    label(item);
    target.innerHTML = '';
    target.classList.remove('hero-static');

    let charData;
    try {
      const res = await fetch(`https://cdn.jsdelivr.net/npm/hanzi-writer-data@2.0/${item.c}.json`);
      if (!res.ok) throw new Error(String(res.status));
      charData = await res.json();
    } catch {
      fallback(item);
      return;
    }
    if (item !== CYCLE[i]) return;          /* moved on while it was in flight */

    try {
      writer = HanziWriter.create(target, item.c, {
        width: size(), height: size(), padding: 8,
        strokeColor: cssVar('--ink', '#1b1815'),
        strokeAnimationSpeed: 1.1,
        delayBetweenStrokes: 110,
        showCharacter: false,
        charDataLoader: (char, onLoad) => onLoad(charData)
      });
      if (still) { writer.showCharacter(); return; }
      writer.animateCharacter({ onComplete: () => {
        if (stopped) return;
        setTimeout(next, 1300);
      }});
    } catch {
      fallback(item);
    }
  }

  function next() {
    i = (i + 1) % CYCLE.length;
    show(CYCLE[i]);
  }

  // Pause when the hero scrolls out of view.
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(entries => {
      stopped = !entries[0].isIntersecting;
      if (!stopped && writer && !still) writer.animateCharacter({
        onComplete: () => { if (!stopped) setTimeout(next, 1300); }
      });
    }, { threshold: .2 }).observe(target);
  }

  show(CYCLE[0]);

  target.parentElement.addEventListener('click', () => {
    CN.speak(CYCLE[i].c);
    if (writer && !still) writer.animateCharacter();
  });
})();
