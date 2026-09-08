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
/* LearneCN — HSK practice */

(() => {
  const { $, $$, el, data, store, speak, isHan, ID } = CN;

  const SECTIONS = [
    ['vocabulary', 'Vocabulary', '词汇'],
    ['characters', 'Characters', '汉字'],
    ['grammar', 'Grammar', '语法'],
    ['reading', 'Reading', '阅读'],
    ['listening', 'Listening', '听力']
  ];

  const LEVELS = [1, 2, 3, 4, 5, 6, 7];
  const levelLabel = l => (l === 7 ? '进阶' : `HSK ${l}`);

  let manifest = {};
  let bank = [];      // questions for the level+section on screen
  let extras = [];    // data/questions.json, whatever the Add page saved
  let queue = [];
  let index = 0;
  let loadToken = 0;
  let pages = 0;      // how many shard files this level+section has
  let loadedPages = 0;
  let total = 0;      // the section's true size, from the manifest
  let fetching = false;

  /* Mock exam. While `on` is true nothing is marked on screen and nothing
     reaches the scheduler — an exam you get feedback during is not an exam,
     and a guess made under time pressure is not evidence about memory. */
  const exam = { on: false, answers: new Map(), started: 0, limitMs: 0, timer: 0, advance: 0 };

  /* True while the marked paper is on screen. Nothing may redraw #quiz
     until the learner leaves it. */
  let resultShown = false;

  let level = store.get('cn.level', 1);
  let section = store.get('cn.section', 'vocabulary');
  let order = store.get('cn.order', 'scheduled');
  let scope = store.get('cn.scope', 'all');
  let stats = store.get('cn.stats', {});
  let answered = new Map();

  const idOf = q => `${q.level}|${q.section}|${q.q}|${q.choices.join('|')}`;

  /* Two independent 32-bit hashes, concatenated. One alone would collide a
     dozen times over a bank this size, and a collision means two questions
     sharing a schedule. */
  function hash(str) {
    let a = 0x811c9dc5, b = 5381;
    for (let i = 0; i < str.length; i++) {
      const c = str.charCodeAt(i);
      a = Math.imul(a ^ c, 0x01000193) >>> 0;
      b = ((b << 5) + b + c) >>> 0;
    }
    return a.toString(36) + b.toString(36);
  }
  const srsId = q => ID.quiz(hash(idOf(q)));

  /* ---------- what the question is about ---------- */

  const NAMED = /[「『]([^」』]+)[」』]/g;

  /**
   * Has the learner met anything this question is about?
   *
   * Every generated question names its subject in one of two places — inside
   * 「」 or as the correct answer — which is the same rule
   * tools/order-questions.py uses to sort the bank. Here the question is
   * simpler than ordering: not "which subject is this", just "is any of them
   * already in the scheduler".
   *
   * The point is that a beginner thirty words into HSK 1 opening the practice
   * page currently gets 593 questions about 150 words, of which they have met
   * twenty per cent. Being asked about the other eighty is not practice; it
   * is a test they were never going to pass, four times a minute.
   */
  function met(q) {
    /* A grammar drill says which point it is about, because the thing it
       names — 「A 是 B」, or a whole sentence — is not a headword and no
       amount of looking inside 「」 would find it in the scheduler. */
    if (q.point) return SRS.isIntroduced(ID.gram(q.point));
    const seen = key =>
      SRS.isIntroduced(ID.word(key)) || SRS.isIntroduced(ID.char(key));
    NAMED.lastIndex = 0;
    let m;
    while ((m = NAMED.exec(q.q || '')) !== null) {
      if (seen(m[1])) return true;
    }
    const choices = q.choices || [];
    return typeof q.answer === 'number' && seen(choices[q.answer]);
  }

  /** The bank, narrowed to the chosen scope. */
  const inScope = list => scope === 'met' ? list.filter(met) : list;

  /* How many questions the counter should claim. Unfiltered, that is the
     section's true size from the manifest, most of which has not been fetched
     yet. Filtered, the manifest number is a lie — it counts the questions the
     filter just removed — so the honest answer is what is actually in hand. */
  const shownTotal = () =>
    (scope === 'met' ? queue.length : (total || queue.length)).toLocaleString();

  /* ---------- controls ---------- */

  function buildChips() {
    const lv = $('#levels');
    LEVELS.forEach(i => lv.append(el('button', {
      class: 'chip level', type: 'button', 'data-level': String(i),
      'aria-pressed': String(i === level),
      onclick: () => { level = i; store.set('cn.level', i); syncChips(); loadSection(); }
    }, levelLabel(i))));

    const sc = $('#sections');
    SECTIONS.forEach(([key, label, cn]) => sc.append(el('button', {
      class: 'chip', type: 'button', 'data-section': key,
      'aria-pressed': String(key === section),
      onclick: () => { section = key; store.set('cn.section', key); syncChips(); loadSection(); }
    }, `${label} · ${cn}`)));

    $$('#orders .chip').forEach(b => b.addEventListener('click', () => {
      order = b.dataset.order; store.set('cn.order', order); syncChips(); rebuild();
    }));

    $$('#scope .chip').forEach(b => b.addEventListener('click', () => {
      scope = b.dataset.scope; store.set('cn.scope', scope); syncChips(); rebuild();
    }));
  }

  function syncChips() {
    $$('#levels .chip').forEach(b =>
      b.setAttribute('aria-pressed', String(Number(b.dataset.level) === level)));
    $$('#sections .chip').forEach(b =>
      b.setAttribute('aria-pressed', String(b.dataset.section === section)));
    $$('#orders .chip').forEach(b =>
      b.setAttribute('aria-pressed', String(b.dataset.order === order)));
    $$('#scope .chip').forEach(b =>
      b.setAttribute('aria-pressed', String(b.dataset.scope === scope)));
  }

  /* ---------- loading ---------- */

  /* The bank runs past 340,000 questions, so it is split by level and section
     and paginated. Only the first page is fetched up front; the next arrives
     when you get near the end of what is loaded. Opening 进阶 vocabulary costs
     one 900 KB file, not the 66 MB the section holds. */
  async function loadSection() {
    resultShown = false;
    if (exam.on) {
      clearInterval(exam.timer);
      clearTimeout(exam.advance);
      exam.on = false;
      $('#examBar').hidden = true;
      $('#setupBar').hidden = false;
    }
    const token = ++loadToken;
    const lv = level, sec = section;

    const local = extras.concat(store.get('cn.custom', []))
      .filter(q => q.level === lv && q.section === sec);
    const info = (manifest[lv] || {})[sec] || { pages: 0, count: 0 };
    pages = info.pages;
    loadedPages = 0;
    total = info.count + local.length;
    fetching = false;

    if (!pages) {
      bank = local;
      total = local.length;
      rebuild();
      return;
    }

    $('#quiz').innerHTML = '';
    $('#quiz').append(el('p', { class: 'status' }, '正在加载题库…'));

    let part;
    try {
      part = await data(`questions/L${lv}-${sec}-1`);
    } catch {
      $('#quiz').innerHTML = '';
      $('#quiz').append(el('p', { class: 'empty' },
        'Questions could not load. Serve the site over http rather than opening the file directly.'));
      return;
    }
    if (token !== loadToken) return;   // the user moved on while this was in flight
    loadedPages = 1;
    bank = part.concat(local);
    rebuild();
  }

  async function loadMore() {
    if (fetching || loadedPages >= pages) return;
    fetching = true;
    const token = loadToken, lv = level, sec = section;
    try {
      const part = await data(`questions/L${lv}-${sec}-${loadedPages + 1}`);
      if (token !== loadToken) return;
      loadedPages++;
      bank = bank.concat(part);
      const fresh = inScope(part);
      queue = queue.concat(order === 'performance' ? weigh(fresh) : fresh);
    } catch {
      pages = loadedPages;             // stop trying if a page is missing
    } finally {
      fetching = false;
    }
  }

  /* ---------- queue ---------- */

  function weigh(list) {
    return list.map(q => {
      const s = stats[idOf(q)] || { right: 0, wrong: 0 };
      const seen = s.right + s.wrong;
      // unseen first, then whatever has the worst hit rate; jitter stops looping
      const w = seen === 0 ? -1 : (s.right - s.wrong * 2) / seen;
      return [w + Math.random() * 0.35, q];
    }).sort((a, b) => a[0] - b[0]).map(x => x[1]);
  }

  /**
   * Spaced ordering: whatever is due, worst-slipping first, then material
   * you have never seen. The old "by performance" sort could only ever
   * re-rank what you had already answered; this one knows when to leave a
   * question alone, which is most of the value.
   */
  function schedule(list) {
    const now = Date.now();
    const due = [], fresh = [], resting = [];
    for (const q of list) {
      const card = SRS.get(srsId(q), 'rec');
      if (!card) fresh.push(q);
      else if (card.due <= now) due.push([SRS.retrievability((now - card.last) / 864e5, card.s), q]);
      else resting.push(q);
    }
    due.sort((a, b) => a[0] - b[0]);
    return due.map(x => x[1]).concat(fresh, resting);
  }

  function rebuild() {
    const pool = inScope(bank);
    queue = order === 'scheduled' ? schedule(pool)
          : order === 'performance' ? weigh(pool)
          : pool.slice();
    index = 0;
    answered = new Map();
    show();
    updateDue();
  }

  function updateDue() {
    const el2 = $('#dueCount');
    if (!el2) return;
    const now = Date.now();
    let due = 0, seen = 0;
    for (const q of bank) {
      const card = SRS.get(srsId(q), 'rec');
      if (!card) continue;
      seen++;
      if (card.due <= now) due++;
    }
    el2.textContent = seen
      ? `${due.toLocaleString()} due of ${seen.toLocaleString()} seen`
      : 'none seen yet in this section';
  }

  function updateCount() {
    const meta = $('#quiz .q-meta');
    if (meta && meta.lastElementChild) {
      meta.lastElementChild.textContent =
        `${index + 1} / ${shownTotal()}`;
    }
  }

  /* ---------- rendering ---------- */

  let shownAt = Date.now();

  function show() {
    if (resultShown) return;
    const host = $('#quiz');
    host.innerHTML = '';
    shownAt = Date.now();
    updateScore();

    if (!queue.length) {
      /* An empty bank and an empty filter are different problems, and telling
         someone to go and write questions when the site has 593 of them and
         they have simply not met any of the words yet is unhelpful twice. */
      if (scope === 'met' && bank.length) {
        host.append(el('p', { class: 'empty' },
          `Nothing here yet — none of the ${levelLabel(level)} ${section} questions `
          + 'are about a word you have met. Study a few on ',
          el('a', { href: 'path.html' }, 'the path'),
          ', or switch back to Everything.'));
      } else {
        host.append(el('p', { class: 'empty' },
          `No ${section} questions at ${levelLabel(level)} yet. Write some on the Add page.`));
      }
      return;
    }

    const q = queue[index];
    const id = idOf(q);

    host.append(el('div', { class: 'q-meta' },
      el('span', { class: 'tag' }, levelLabel(q.level)),
      el('span', {}, SECTIONS.find(s => s[0] === q.section)?.[1] || q.section),
      el('span', {}, `${index + 1} / ${shownTotal()}`)));

    if (q.passage) host.append(el('div', { class: 'passage', lang: 'zh' }, q.passage));

    if (q.speak) {
      host.append(el('div', { class: 'row', style: 'margin-bottom:16px' },
        el('button', {
          class: 'btn primary', type: 'button',
          onclick: e => {
            if (!speak(q.speak, 0.78)) {
              e.target.after(el('span', { class: 'hint' }, ' 这个浏览器没有安装中文语音。'));
            }
          }
        }, '🔊 播放'),
        el('button', { class: 'btn', type: 'button', onclick: () => speak(q.speak, 0.55) },
          '🐢 放慢')));
    }

    if (q.audio) {
      host.append(el('audio', { controls: true, src: q.audio,
        style: 'width:100%;margin-bottom:16px' }));
    }
    if (q.image) {
      host.append(el('img', { src: q.image, alt: '题目配图',
        style: 'max-width:100%;border-radius:4px;margin-bottom:16px' }));
    }

    host.append(el('p', {
      class: 'q-text' + (isHan(q.q) ? '' : ' latin'),
      lang: isHan(q.q) ? 'zh' : 'en'
    }, q.q));

    const chosen = exam.on ? exam.answers.get(id) : answered.get(id);
    const choices = el('div', { class: 'choices' });
    q.choices.forEach((text, i) => {
      const classes = ['choice'];
      if (exam.on) {
        if (i === chosen) classes.push('picked');
      } else if (chosen !== undefined) {
        if (i === q.answer) classes.push('correct');
        else if (i === chosen) classes.push('wrong');
      }
      choices.append(el('button', {
        class: classes.join(' '), type: 'button',
        disabled: !exam.on && chosen !== undefined,
        onclick: () => (exam.on ? examAnswer(i) : answer(i))
      },
        el('span', { class: 'key' }, String(i + 1)),
        el('span', { class: isHan(text) ? 'cn' : '', lang: isHan(text) ? 'zh' : 'en' }, text)));
    });
    host.append(choices);

    if (chosen !== undefined && !exam.on) {
      const right = chosen === q.answer;
      host.append(el('div', { class: 'explain' + (right ? '' : ' miss') },
        el('strong', { lang: 'zh' }, right ? '答对了。' : '答错了。'),
        el('span', { lang: 'zh' },
          right ? (q.note || '')
                : `正确答案是「${q.choices[q.answer]}」。${q.note || ''}`)));
    }
  }

  function answer(i) {
    const q = queue[index];
    const id = idOf(q);
    if (answered.has(id)) return;
    const asked = shownAt;
    answered.set(id, i);
    const right = i === q.answer;
    const s = stats[id] || { right: 0, wrong: 0 };
    right ? s.right++ : s.wrong++;
    stats[id] = s;
    store.set('cn.stats', stats);

    /* Feed the same scheduler the Study page uses. A four-way multiple
       choice is a weaker signal than free recall — one in four right
       answers is luck — so a correct pick is worth Good and never Easy. */
    if (!exam.on) {
      SRS.review(srsId(q), 'rec', right ? 3 : 1, Math.min(60000, Date.now() - asked));
    }
    show();
    updateDue();
  }

  function updateScore() {
    let right = 0, wrong = 0;
    bank.forEach(q => {
      const s = stats[idOf(q)];
      if (s) { right += s.right; wrong += s.wrong; }
    });
    const total = right + wrong;
    $('#score').innerHTML = total
      ? `<span><b>${right}</b> right</span><span><b>${wrong}</b> wrong</span>` +
        `<span><b>${Math.round(right / total * 100)}%</b> over ${total} answers</span>`
      : '<span>No answers yet in this section.</span>';
  }

  /* ---------- mock exam ---------- */

  /* A real HSK paper is mostly listening and reading. This bank is mostly
     generated vocabulary and character drills, so the mix below takes every
     listening and reading item the level has and fills the rest — honest
     about what it can offer rather than pretending to be the real paper. */
  const EXAM_SHAPE = [
    ['listening', 6], ['reading', 4], ['grammar', 8],
    ['vocabulary', 12], ['characters', 10]
  ];

  async function startExam() {
    resultShown = false;
    const lv = level;
    const picked = [];
    for (const [sec, want] of EXAM_SHAPE) {
      const info = (manifest[lv] || {})[sec];
      if (!info || !info.pages) continue;
      let rows;
      try { rows = await data(`questions/L${lv}-${sec}-1`); } catch { continue; }
      const shuffled = rows.slice();
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      picked.push(...shuffled.slice(0, want));
    }
    if (!picked.length) return;

    exam.on = true;
    exam.answers = new Map();
    exam.started = Date.now();
    exam.limitMs = Math.max(8, Math.round(picked.length * 0.75)) * 60000;
    queue = picked;
    total = picked.length;
    index = 0;
    answered = new Map();

    $('#examBar').hidden = false;
    $('#setupBar').hidden = true;
    clearInterval(exam.timer);
    exam.timer = setInterval(tickExam, 1000);
    tickExam();
    show();
  }

  function tickExam() {
    if (!exam.on) return;
    const left = exam.limitMs - (Date.now() - exam.started);
    if (left <= 0) { finishExam(true); return; }
    const m = Math.floor(left / 60000), sec = Math.floor(left / 1000) % 60;
    $('#examClock').textContent = `${m}:${String(sec).padStart(2, '0')}`;
    $('#examClock').classList.toggle('urgent', left < 120000);
    $('#examProgress').textContent = `${exam.answers.size} of ${queue.length} answered`;
  }

  function examAnswer(i) {
    const q = queue[index];
    exam.answers.set(idOf(q), i);
    show();
    tickExam();
    clearTimeout(exam.advance);
    if (index < queue.length - 1) exam.advance = setTimeout(() => move(1), 180);
  }

  function finishExam(timedOut) {
    if (!exam.on) return;
    clearInterval(exam.timer);
    clearTimeout(exam.advance);      /* or the pending auto-advance repaints over the result */
    exam.on = false;
    $('#examBar').hidden = true;
    $('#setupBar').hidden = false;

    const bySection = {};
    let right = 0;
    for (const q of queue) {
      const chosen = exam.answers.get(idOf(q));
      const ok = chosen === q.answer;
      if (ok) right++;
      const row = bySection[q.section] || (bySection[q.section] = { n: 0, ok: 0 });
      row.n++;
      if (ok) row.ok++;
      /* Now that it is over, the answers are worth scheduling. */
      if (chosen !== undefined) SRS.review(srsId(q), 'rec', ok ? 3 : 1, 0);
    }
    const pct = Math.round(right / queue.length * 100);
    const mins = Math.round((Date.now() - exam.started) / 60000);

    resultShown = true;
    const host = $('#quiz');
    host.innerHTML = '';
    host.append(el('div', { class: 'exam-result' },
      el('p', { class: 'eyebrow' }, timedOut ? 'Time up' : 'Paper finished'),
      el('div', { class: 'exam-score' }, el('b', {}, pct + '%'),
        el('span', {}, `${right} of ${queue.length} correct · ${mins} min · ${levelLabel(level)}`)),
      el('p', { class: 'hint' }, pct >= 80
        ? 'A comfortable pass at this level. Move up.'
        : pct >= 60
          ? 'Around the pass mark. The sections below show where the marks went.'
          : 'Below a pass. Study the weakest section rather than sitting another paper.')));

    const table = el('table', { class: 'chart-table' },
      el('thead', {}, el('tr', {}, el('th', {}, 'Section'), el('th', {}, 'Score'), el('th', {}, 'Share'))),
      el('tbody', {}));
    const body = table.querySelector('tbody');
    for (const [sec, row] of Object.entries(bySection).sort((a, b) => a[1].ok / a[1].n - b[1].ok / b[1].n)) {
      const label = SECTIONS.find(x => x[0] === sec);
      body.append(el('tr', {},
        el('td', {}, label ? `${label[1]} · ${label[2]}` : sec),
        el('td', {}, `${row.ok} / ${row.n}`),
        el('td', {}, Math.round(row.ok / row.n * 100) + '%')));
    }
    host.append(table);
    host.append(el('div', { class: 'row', style: 'margin-top:22px' },
      el('button', { class: 'btn primary', type: 'button', onclick: () => { resultShown = false; loadSection(); } }, 'Back to practice'),
      el('button', { class: 'btn', type: 'button', onclick: startExam }, 'Another paper'),
      el('a', { class: 'btn', href: 'progress.html' }, 'See progress')));
  }

  /* ---------- navigation ---------- */

  function move(delta) {
    if (!queue.length) return;
    index = (index + delta + queue.length) % queue.length;
    show();
    /* With a filter on, a whole 4,000-question page can contribute almost
       nothing to the queue, so "am I near the end of the queue" would stop
       fetching while most of the section is still on the server. Ask instead
       whether there is more to fetch at all. */
    if (queue.length - index < 400) loadMore();
    else if (scope === 'met' && queue.length < 60 && loadedPages < pages) loadMore();
  }

  $('#startExam').addEventListener('click', () => {
    $('#examLevel').textContent = levelLabel(level);
    startExam();
  });
  $('#finishExam').addEventListener('click', () => finishExam(false));

  $('#next').addEventListener('click', () => move(1));
  $('#prev').addEventListener('click', () => move(-1));
  $('#resetStats').addEventListener('click', () => {
    stats = {};
    store.set('cn.stats', stats);
    rebuild();
  });

  addEventListener('keydown', e => {
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName)) return;
    if (e.key >= '1' && e.key <= '4') {
      const btn = $$('#quiz .choice')[Number(e.key) - 1];
      if (btn && !btn.disabled) btn.click();
    } else if (e.key === 'ArrowRight') move(1);
    else if (e.key === 'ArrowLeft') move(-1);
  });

  /* ---------- start ---------- */

  (async () => {
    try { manifest = await data('questions/index'); } catch { manifest = {}; }
    try { extras = await data('questions'); } catch { extras = []; }
    buildChips();
    await loadSection();
  })();
})();
