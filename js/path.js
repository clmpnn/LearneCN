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
/* LearneCN — the path.

   Every other page on this site is a tool. A tool assumes you know what you
   are trying to do with it, and the Study page in particular opens by asking
   which levels, which material and which card types you want — three
   questions a person on their first day has no way to answer and no reason
   to care about.

   This page answers them. It reads the staged route in data/learn/path.json,
   works out where the learner actually is from what the scheduler has seen,
   and offers exactly one thing to do next. */

(() => {
  const { $, el, data, store, ID, byWord } = CN;

  const board = $('#pathBoard'), list = $('#stages'), hint = $('#pathHint');

  const DECK = 'cn.deck';
  const SOUNDS = 'cn.path.sounds';   /* the one stage with nothing to count */
  const wordsOf = stage => stage.items || [];
  const gram = new Map();      /* point id -> point, for the pattern strip */

  let path = null, order = null;

  /** Every item a stage covers, as scheduler ids. */
  function itemsFor(stage, levelWords) {
    if (stage.kind === 'sounds') return [];
    if (stage.items) return stage.items;
    return (levelWords[stage.level] || []).map(ID.word);
  }

  /** How much of a stage the scheduler has already met. */
  function seen(ids) {
    if (!ids.length) return 0;
    let n = 0;
    for (const id of ids) if (SRS.isIntroduced(id)) n++;
    return n;
  }

  function start(stage) {
    if (stage.kind === 'sounds') {
      location.href = 'characters.html#tones';
      return;
    }
    /* Carry the stage into the study session: its level, its card types, and
       the stage itself so the session draws new material from the route
       rather than from the whole level at once. */
    const deck = Object.assign({}, store.get(DECK, {}), {
      levels: [stage.level || 1],
      content: 'words',
      modes: (stage.modes || ['rec']).slice(),
      stage: stage.id
    });
    store.set(DECK, deck);
    location.href = 'study.html';
  }

  function render() {
    const levelWords = {};
    if (order) {
      for (const w of order.words) {
        const lv = (order.levelOf && order.levelOf[w]) || null;
        if (lv) (levelWords[lv] = levelWords[lv] || []).push(w);
      }
    }

    const rows = path.stages.map(s => {
      const ids = itemsFor(s, levelWords);
      return { stage: s, ids, done: seen(ids) };
    });

    /* Where you are: the first stage that is not finished. A stage counts as
       finished at 90% rather than 100%, because the last three words of a
       stage are usually the three you keep failing, and being held at a gate
       by them helps nobody.

       The sounds stage has no items to count, so it is finished when the
       learner says it is, or as soon as they have met a word — nobody who
       has started studying needs to be sent back to the tone chart. */
    let current = rows.findIndex(r => r.ids.length && r.done < r.ids.length * 0.9);
    const finished = current < 0;                 /* nothing left unfinished */
    if (finished) current = rows.length - 1;
    const anyDone = rows.some(r => r.done > 0);
    if (!store.get(SOUNDS, false) && !anyDone) current = 0;

    const total = rows.reduce((a, r) => a + r.ids.length, 0);
    const done = rows.reduce((a, r) => a + r.done, 0);
    /* What is left, not what the last stage cost. Finishing the route and
       still being told there are three hundred days to go is the kind of
       detail that makes a progress display stop being believed. */
    const days = finished ? 0
      : rows.slice(current).reduce((a, r) => a + (r.stage.days || 0), 0);

    board.innerHTML = '';
    const tiles = [
      ['Stage', `${current + 1}/${rows.length}`, rows[current].stage.title],
      ['Words met', done.toLocaleString(), `of ${total.toLocaleString()} on the route`],
      ['This stage', rows[current].ids.length
        ? `${rows[current].done}/${rows[current].ids.length}` : '声音',
        rows[current].ids.length ? 'introduced' : 'no words yet'],
      ['Left to go', finished ? '完' : days < 400 ? days + 'd' : (days / 365).toFixed(1) + 'y',
        finished ? 'the whole list' : 'at this pace']
    ];
    for (const [label, value, sub] of tiles) {
      board.append(el('div', { class: 'due-tile' },
        el('b', {}, String(value)),
        el('span', { class: 'due-label' }, label),
        el('span', { class: 'due-sub' }, sub)));
    }

    hint.textContent = finished
      ? 'Every word on HSK 1–6 is in rotation. From here the scheduler keeps them '
        + 'there, and 进阶 on the Study page holds everything past the official list.'
      : rows[current].stage.goal;

    list.innerHTML = '';
    rows.forEach((r, i) => {
      const s = r.stage;
      const state = i < current ? 'done' : i === current ? 'current' : 'ahead';
      const pct = r.ids.length ? Math.round(100 * r.done / r.ids.length) : (i < current ? 100 : 0);

      const head = el('div', { class: 'stage-head' },
        el('span', { class: 'stage-mark', lang: 'zh', 'aria-hidden': 'true' }, s.cn),
        el('div', { class: 'stage-title' },
          el('h3', {}, s.title),
          el('p', { class: 'stage-goal' }, s.goal)),
        r.ids.length
          ? el('span', { class: 'stage-count' }, `${r.done}/${r.ids.length}`,
              el('span', { class: 'sr-only' }, ' words introduced'))
          : null);

      /* The bar repeats what the count beside the title already says in
         words, so it is decoration and announcing it twice helps nobody. */
      const bar = el('div', { class: 'stage-bar', 'aria-hidden': 'true' },
        el('span', { style: `width:${pct}%` }));

      const body = el('div', { class: 'stage-body' });
      if (s.why) body.append(el('p', { class: 'stage-why' }, s.why));
      if (s.sentence) {
        body.append(el('p', { class: 'stage-say' },
          el('span', { class: 'stage-say-label' }, 'By the end you can read'),
          el('span', { class: 'cn', lang: 'zh' }, s.sentence)));
      }
      if (s.does) {
        const ul = el('ul', { class: 'stage-does' });
        for (const d of s.does) {
          ul.append(el('li', {},
            el('a', { href: d.href }, d.label),
            el('span', {}, ' — ' + d.note)));
        }
        body.append(ul);
      }
      /* The patterns are the half of a stage that a word count cannot show.
         「二级」151 words told a learner nothing about what the level was for;
         把, 被 and 虽然…但是 tell them exactly. */
      if (s.points && s.points.length) {
        const strip = el('p', { class: 'stage-points' },
          el('span', { class: 'stage-say-label' }, 'Patterns'),
          ...s.points.flatMap((id, k) => {
            const g = gram.get(id);
            if (!g) return [];
            return [
              k ? el('span', { class: 'ctx-sep', 'aria-hidden': 'true' }, '·') : '',
              el('span', { class: 'gram-chip', lang: 'zh', title: g.title }, g.cn)
            ];
          }));
        body.append(strip);
      }
      if (s.items && s.items.length) {
        const strip = el('p', { class: 'stage-words cn', lang: 'zh' },
          s.items.slice(0, 14).map(ID.key).join('　') +
          (s.items.length > 14 ? ' …' : ''));
        body.append(strip);
      }
      if (i === current && !finished) {
        const row = el('div', { class: 'row' },
          el('button', {
            class: 'btn primary', type: 'button',
            onclick: () => start(s)
          }, s.kind === 'sounds' ? 'Start with the sounds' : 'Study this stage'));
        if (s.kind === 'sounds') {
          row.append(el('button', {
            class: 'btn', type: 'button',
            title: 'Skip ahead to the first words',
            onclick: () => { store.set(SOUNDS, true); render(); }
          }, 'I can hear the tones'));
        }
        body.append(row);
      }

      list.append(el('li', {
        class: 'stage ' + state,
        'aria-current': i === current && !finished ? 'step' : null
      }, head, bar, body));
    });
  }

  Promise.all([
    data('learn/path'), data('hsk'), data('learn/order'),
    /* The stage list is still worth drawing without it. */
    data('learn/grammar').catch(() => null)
  ])
    .then(([p, hsk, ord, g]) => {
      path = p;
      ((g && g.points) || []).forEach(pt => gram.set(pt.id, pt));
      const index = byWord(hsk);
      const lv = {};
      index.forEach((row, word) => { lv[word] = row.lv; });
      order = { words: ord.words, levelOf: lv };
      render();
    })
    .catch(err => {
      hint.textContent = 'Could not load the path (' + err.message + '). ' +
        'Serve the folder over http rather than opening the file directly.';
    });
})();
