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
/* LearneCN — the study session.

   One item — a word or a character — grows several cards, because
   recognising 生日 and producing it from "birthday" are different memories
   that decay at different rates. Recognition is always first. The rest
   unlock only once recognition is holding, since drilling production of a
   word you cannot yet read is time spent building nothing.

   The scheduler lives in srs.js. This file is what a review looks like. */

(() => {
  const { $, $$, el, data, store, speak, canSpeak, hasChineseVoice,
          speechReady, onVoiceChange, isHan,
          toneMarks, plainPinyin, comparePinyin, form, currentScript,
          onScriptChange, cssVar, ID, byWord } = CN;

  /* ---------- source material ---------- */

  let wordIndex = new Map();     /* 简体 -> hsk row */
  let charIndex = new Map();     /* 汉字 -> hanzi row */
  let order = { chars: [], words: [] };
  let sentences = {};
  let charWords = {};
  let toneSets = [];
  let toneIndex = new Map();   /* toneless syllable -> the set of characters sharing it */
  let grammar = [];            /* the grammar syllabus, in teaching order */
  let gramIndex = new Map();   /* point id -> point */
  let wordPos = new Map();     /* 简体 -> where the syllabus teaches it */
  let pathData = null;         /* the staged route, when the learner is following it */
  let tonesReady = null;       /* the tone sets, which load without blocking a session */
  let ready = false;

  const CDN = c => `https://cdn.jsdelivr.net/npm/hanzi-writer-data@2.0/${encodeURIComponent(c)}.json`;

  async function loadAll() {
    const [hsk, hanzi, ord, phrases, route, gram] = await Promise.all([
      data('hsk'), data('hanzi'), data('learn/order'),
      /* None of these should ever stop a session starting. */
      data('learn/phrases').catch(() => []),
      data('learn/path').catch(() => null),
      data('learn/grammar').catch(() => null)
    ]);
    /* byWord keeps the earliest level where hsk.json repeats a headword —
       see app.js. 你好 and 请问 are folded in through the same index: they are
       not on the HSK list, because the list is a word list and those are
       phrases, and a beginner needs them on the first day regardless. */
    byWord(hsk, wordIndex);
    byWord(phrases, wordIndex);
    pathData = route;
    hanzi.forEach(h => charIndex.set(h.c, h));
    order = ord;
    /* Awaited rather than deferred, unlike the tone sets: pool() has to know
       where each point belongs in the word order before it can build a queue,
       and a queue built without it would quietly be a vocabulary-only queue. */
    grammar = (gram && gram.points) || [];
    grammar.forEach(g => gramIndex.set(g.id, g));
    order.words.forEach((w, i) => wordPos.set(w, i));
    /* context is nice to have, not required — never block the session on it */
    data('learn/sentences').then(s => { sentences = s; }).catch(() => {});
    data('learn/charwords').then(s => { charWords = s; }).catch(() => {});
    /* Not awaited: a study session does not need the tone sets, and making
       one wait on them would delay every visit for a feature most of them do
       not use. The promise is kept so the deep link below can wait on the one
       occasion it does matter. */
    tonesReady = data('learn/tones').then(t => {
      toneSets = t.sets || [];
      toneSets.forEach(g => toneIndex.set(g.base, g));
      const btn = $('#toneDrill');
      if (btn && toneSets.length) btn.hidden = false;
    }).catch(() => {});
    ready = true;
  }

  /** Turn an item id into everything a card needs to render. */
  function resolve(id) {
    const kind = ID.kind(id), key = ID.key(id);
    if (kind === 'w') {
      const w = wordIndex.get(key);
      if (!w) return null;
      return {
        id, kind: 'word', key,
        simplified: w.s, traditional: w.t || '',
        pinyin: w.p, numbered: w.n, meaning: w.e, level: w.lv
      };
    }
    if (kind === 'g') {
      const g = gramIndex.get(key);
      if (!g) return null;
      return {
        id, kind: 'gram', key, point: g, level: g.level,
        simplified: g.cn, traditional: '', pinyin: '', numbered: '',
        meaning: g.title
      };
    }
    if (kind === 't') {
      const g = toneIndex.get(key);
      if (!g) return null;
      return { id, kind: 'tone', key, set: g, level: g.lv, meaning: '', pinyin: key, simplified: g.m[0].c, traditional: '' };
    }
    const h = charIndex.get(key);
    if (!h) return null;
    return {
      id, kind: 'char', key,
      simplified: h.c, traditional: '',
      pinyin: (h.p || [])[0] || '', numbered: '',
      readings: h.p || [], meaning: h.d || '', level: h.lv || 7,
      radical: h.r, strokes: h.s, decomposition: h.dc, note: h.h
    };
  }

  const shown = item => form(item.simplified, item.traditional);

  /* Which directions of recall make sense for this item. Handwriting needs
     stroke data, so it is offered only where we know it exists. */
  function modesFor(id) {
    if (ID.is(id, 't')) return ['tone'];
    if (ID.is(id, 'g')) return ['gram'];
    const item = resolve(id);
    if (!item) return [];
    const list = ['rec'];
    for (const m of cfg.modes) {
      if (m === 'rec') continue;
      if (m === 'hand') {
        const chars = Array.from(item.simplified).filter(isHan);
        if (chars.length && chars.length <= 3 && chars.every(c => charIndex.has(c))) list.push(m);
      } else {
        list.push(m);
      }
    }
    return list;
  }

  /* ---------- deck settings ---------- */

  const ALL_MODES = ['rec', 'prod', 'pin', 'aud', 'hand'];

  let cfg = Object.assign({
    levels: [1],
    content: 'words',
    grammar: true,
    modes: ['rec', 'prod', 'pin']
  }, store.get('cn.deck', {}));
  if (!Array.isArray(cfg.levels) || !cfg.levels.length) cfg.levels = [1];
  if (!Array.isArray(cfg.modes) || !cfg.modes.length) cfg.modes = ['rec'];
  if (!cfg.modes.includes('rec')) cfg.modes.unshift('rec');

  const saveDeck = () => store.set('cn.deck', cfg);

  /** Everything the route covers up to and including one stage. */
  function stageItems(id) {
    const stages = (pathData && pathData.stages) || [];
    const end = stages.findIndex(st => st.id === id);
    if (end < 0) return [];
    const out = [];
    for (let i = 0; i <= end; i++) {
      const st = stages[i];
      if (st.items) { out.push(...st.items); continue; }
      if (!st.level) continue;
      for (const w of order.words) {
        const row = wordIndex.get(w);
        if (row && row.lv === st.level) out.push(ID.word(w));
      }
    }
    return out;
  }

  /** Every grammar point the route has reached by the end of one stage. */
  function stagePoints(id) {
    const stages = (pathData && pathData.stages) || [];
    const end = stages.findIndex(st => st.id === id);
    if (end < 0) return null;
    const out = new Set();
    for (let i = 0; i <= end; i++) (stages[i].points || []).forEach(p => out.add(p));
    return out;
  }

  /** Candidate items for new material, in teaching order.

      On the path, new material comes from the route rather than from the
      whole level at once — 150 words is a level, thirty is a fortnight, and
      the difference between the two is whether the first fortnight is spent
      on things you can say. Finished stages contribute nothing: the
      scheduler drops anything it has already introduced. */
  /** Fold the grammar syllabus into a stream of words and characters.

      A point is not due when its level opens. 把 is HSK 3 and needs a result
      complement behind the verb; 只有…才 is only worth teaching once 只要…就
      is there to be confused with. build-learning-data.py already worked out
      where each one becomes learnable and wrote it into `unlockAt`, as a
      position in the word order — so walk the stream, keep track of how far
      through that order it has got, and let each point in as it is passed.

      Anything left over is flushed at the end rather than dropped: a learner
      studying one level in isolation has not met the words an earlier point
      wanted, and withholding the grammar of the level they actually chose
      would be a strange way to honour a prerequisite. `allowed` is what keeps
      that flush honest — on a stage it is that stage's own points and nothing
      past them, so finishing a fortnight cannot dump the rest of HSK 6 into
      the queue. */
  function withGrammar(seq, allowed) {
    if (!cfg.grammar || !grammar.length) return seq;
    const want = allowed ? grammar.filter(g => allowed.has(g.id)) : grammar;
    if (!want.length) return seq;

    const out = [];
    let at = -1, next = 0;
    for (const id of seq) {
      out.push(id);
      if (id[0] === 'w') {
        const p = wordPos.get(ID.key(id));
        if (p !== undefined && p > at) at = p;
      }
      while (next < want.length && want[next].unlockAt <= at) out.push(ID.gram(want[next++].id));
    }
    while (next < want.length) out.push(ID.gram(want[next++].id));
    return out;
  }

  function pool() {
    if (cfg.stage && pathData) {
      const route = stageItems(cfg.stage).filter(id => wordIndex.has(ID.key(id)));
      if (route.length) return withGrammar(route, stagePoints(cfg.stage));
    }
    const levels = new Set(cfg.levels);
    const wanted = new Set(grammar.filter(g => levels.has(g.level)).map(g => g.id));
    const out = [];
    const wantWords = cfg.content !== 'chars';
    const wantChars = cfg.content !== 'words';

    if (wantWords) {
      for (const w of order.words) {
        const row = wordIndex.get(w);
        if (row && levels.has(row.lv)) out.push(ID.word(w));
      }
    }
    if (wantChars) {
      for (const c of order.chars) {
        const row = charIndex.get(c);
        if (row && levels.has(row.lv || 7)) out.push(ID.char(c));
      }
    }
    /* Interleave the two streams rather than teaching every word and then
       every character — a character is easier to hold when a word using it
       showed up nearby. */
    if (wantWords && wantChars) {
      const words = out.filter(x => x[0] === 'w');
      const chars = out.filter(x => x[0] === 'c');
      const mixed = [];
      const ratio = words.length / Math.max(1, chars.length);
      let wi = 0, ci = 0;
      while (wi < words.length || ci < chars.length) {
        for (let k = 0; k < Math.max(1, Math.round(ratio)) && wi < words.length; k++) mixed.push(words[wi++]);
        if (ci < chars.length) mixed.push(chars[ci++]);
      }
      return withGrammar(mixed, wanted);
    }
    return withGrammar(out, wanted);
  }

  /* ---------- answer checking ---------- */

  const cleanHan = s => String(s || '').replace(/\s+/g, '').trim();

  /* ---------- session ---------- */

  let queue = [], pos = 0, cram = false;
  let started = 0, answeredCount = 0, correctCount = 0, newCount = 0;
  let cardStart = 0, currentCard = null, currentItem = null, revealed = false;
  let recommended = 3, autoGraded = false;
  let writer = null;
  let handState = null;

  const setup = $('#setup'), sessionEl = $('#session'), summaryEl = $('#summary');

  function humanInterval(ms) {
    const m = ms / 6e4, h = m / 60, d = h / 24;
    if (m < 1) return '<1m';
    if (m < 60) return Math.round(m) + 'm';
    if (h < 24) return Math.round(h) + 'h';
    if (d < 31) return Math.round(d) + 'd';
    if (d < 365) return (d / 30.44).toFixed(1) + 'mo';
    return (d / 365.25).toFixed(1) + 'y';
  }

  function refreshBoard() {
    const c = SRS.counts();
    const board = $('#dueBoard');
    board.innerHTML = '';
    const tiles = [
      ['Due now', c.due, 'ready to review'],
      ['New today', Math.min(c.newLeft, Math.max(0, pool().length - c.items)), 'waiting to be met'],
      ['Learned', c.mature + c.young, 'items in rotation'],
      ['Streak', SRS.streak(), 'days running']
    ];
    for (const [label, value, sub] of tiles) {
      board.append(el('div', { class: 'due-tile' },
        el('b', {}, String(value)),
        el('span', { class: 'due-label' }, label),
        el('span', { class: 'due-sub' }, sub)));
    }
    const hint = $('#startHint');
    const here = cfg.stage && pathData &&
      pathData.stages.find(st => st.id === cfg.stage);
    const banner = $('#stageBanner');
    if (banner) {
      banner.hidden = !here;
      if (here) {
        banner.innerHTML = '';
        banner.append(
          el('span', { class: 'cn', lang: 'zh' }, here.cn),
          el('b', {}, here.title),
          el('span', {}, here.goal),
          el('a', { href: 'path.html' }, 'the path'));
      }
    }
    if (c.due) {
      hint.textContent = `${c.due} card${c.due === 1 ? '' : 's'} due. Reviews come first, then new material.`;
    } else if (c.newLeft) {
      hint.textContent = 'Nothing due — this session will be fresh material.';
    } else {
      hint.textContent = 'Nothing due and today\'s new items are done. Cram ahead if you want more.';
    }
    if (SRS.storageFailed()) {
      const warn = $('#storageWarn');
      warn.hidden = false;
      warn.textContent = 'This browser is refusing to save progress — private browsing, or storage is full. ' +
        'The session will work, but it will not be remembered. Export from the Progress page to keep it.';
    }
  }

  function begin(ahead) {
    if (!ready) return;
    cram = !!ahead;
    const s = SRS.cfg();
    if (cram) {
      /* Cramming pulls the nearest-due cards forward without touching the
         timetable's shape — useful the night before an exam, useless as a
         daily habit, and the summary says so. */
      const all = [];
      for (const id of pool()) {
        for (const mode of modesFor(id)) {
          if (SRS.get(id, mode)) all.push({ id, mode, kind: 'cram' });
        }
      }
      all.sort(() => Math.random() - 0.5);
      queue = all.slice(0, 60);
    } else {
      queue = SRS.buildQueue({ pool: pool(), modesFor, limit: Math.max(20, s.maxReviews) });
    }
    if (!queue.length) {
      refreshBoard();
      $('#startHint').textContent =
        'Nothing to study right now. Raise "new items a day", add a level, or cram ahead.';
      return;
    }
    pos = 0; answeredCount = 0; correctCount = 0; newCount = 0;
    started = Date.now();
    setup.hidden = true; summaryEl.hidden = true; sessionEl.hidden = false;
    nextCard();
  }

  function overBudget() {
    const mins = SRS.cfg().minutes;
    return mins > 0 && (Date.now() - started) / 6e4 >= mins;
  }

  function nextCard() {
    if (pos >= queue.length || (overBudget() && !cram)) return finish();
    currentCard = queue[pos];
    currentItem = resolve(currentCard.id);
    if (!currentItem) { pos++; return nextCard(); }
    revealed = false; autoGraded = false; recommended = 3;
    cardStart = Date.now();
    if (dropVoiceWatch) { dropVoiceWatch(); dropVoiceWatch = null; }
    handState = null;
    if (writer) { try { writer.cancelQuiz(); } catch { /* already gone */ } writer = null; }
    render();
  }

  function updateChrome() {
    const done = pos, total = queue.length;
    $('#progressFill').style.width = `${Math.round(done / total * 100)}%`;
    const kinds = queue.slice(pos).reduce((a, c) => (a[c.kind] = (a[c.kind] || 0) + 1, a), {});
    const counts = $('#counts');
    counts.innerHTML = '';
    const parts = [
      ['new', kinds.new || 0, 'new'],
      ['unlock', kinds.unlock || 0, 'unlocking'],
      ['review', (kinds.review || 0) + (kinds.cram || 0), 'to review']
    ];
    for (const [cls, n, label] of parts) {
      if (!n) continue;
      counts.append(el('span', { class: 'count ' + cls }, el('b', {}, String(n)), ' ' + label));
    }
    counts.append(el('span', { class: 'count time' }, `${done} / ${total}`));
  }

  /* ---------- card rendering ---------- */

  function render() {
    updateChrome();
    const host = $('#card');
    host.innerHTML = '';
    host.classList.remove('tappable', 'revealed');
    host.onclick = null;
    $('#grades').hidden = true;
    $('#revealRow').hidden = true;

    const item = currentItem, mode = currentCard.mode;
    host.append(el('div', { class: 'card-meta' },
      el('span', { class: 'tag' }, item.level >= 7 ? '进阶' : 'HSK ' + item.level),
      el('span', { class: 'mode-tag' }, `${SRS.MODES[mode].cn} · ${SRS.MODES[mode].label}`),
      currentCard.kind === 'new' ? el('span', { class: 'tag fresh' }, 'new') : null,
      currentCard.kind === 'unlock' ? el('span', { class: 'tag fresh' }, 'new direction') : null));

    (RENDER[mode] || RENDER.rec)(host, item);
  }

  const RENDER = {};

  /* --- recognition: see the Chinese, recall what it means --- */
  RENDER.rec = (host, item) => {
    host.append(el('div', { class: 'prompt' },
      el('div', { class: 'big-hanzi', lang: 'zh' }, shown(item))));
    if (currentCard.kind === 'new') {
      /* A brand-new item is not a test. Show it, say it, then let the
         first rating record how well it landed. */
      host.append(answerBlock(item, true));
      showGrades('This is new — rate how familiar it already feels.');
    } else {
      host.append(el('p', { class: 'ask' }, 'What does it mean, and how is it read?'));
      waitForReveal(item);
    }
  };

  /* --- production: see the meaning, write the Chinese --- */
  RENDER.prod = (host, item) => {
    host.append(el('div', { class: 'prompt' },
      el('div', { class: 'gloss-large' }, item.meaning),
      el('div', { class: 'gloss-sub' }, item.kind === 'word' ? 'word' : 'character')));
    typedAnswer(host, item, {
      placeholder: 'Type the Chinese…',
      lang: 'zh',
      check: value => {
        const given = cleanHan(value);
        const ok = given === cleanHan(item.simplified) ||
                   (item.traditional && given === cleanHan(item.traditional));
        return { ok, detail: ok ? '' : `You wrote ${given || '—'}` };
      }
    });
  };

  /* --- pinyin: see the Chinese, produce the reading with its tone --- */
  RENDER.pin = (host, item) => {
    host.append(el('div', { class: 'prompt' },
      el('div', { class: 'big-hanzi', lang: 'zh' }, shown(item))));
    const expected = item.numbered || item.pinyin;
    typedAnswer(host, item, {
      placeholder: 'ni3 hao3  or  nǐ hǎo',
      lang: 'en',
      check: value => {
        const res = comparePinyin(value, expected);
        if (res.ok) return { ok: true };
        if (res.reason === 'tone') {
          for (const [want, got] of res.toneErrors) SRS.noteTone(want, got);
          const [want, got] = res.toneErrors[0];
          return {
            ok: false, near: true,
            detail: `Right syllables, wrong tone — you said tone ${got}, it is tone ${want}.`
          };
        }
        if (res.reason === 'notone') {
          return { ok: false, near: true, detail: 'The syllables are right, but the tone is the word. Give it one.' };
        }
        return { ok: false, detail: '' };
      }
    });
  };

  /* --- listening: hear it with nothing on screen --- */
  RENDER.aud = (host, item) => {
    const text = item.simplified;
    const play = rate => () => {
      if (!speak(text, rate)) {
        $('#audioNote').textContent = 'This browser has no Chinese voice installed.';
      }
    };
    host.append(el('div', { class: 'prompt audio-prompt' },
      el('button', { class: 'btn primary speaker', type: 'button', onclick: play(0.8) }, '🔊 Play'),
      el('button', { class: 'btn', type: 'button', onclick: play(0.5) }, '🐢 Slower'),
      el('p', { class: 'hint', id: 'audioNote' }, 'Press play, then write down what you heard.')));

    /* Only start it unprompted once the engine is awake. On iOS nothing can
       speak until the page has been touched, and a card that silently plays
       nothing is worse than one that waits to be asked. */
    if (speechReady()) setTimeout(play(0.8), 220);
    else watchVoice(available => {
      const note = $('#audioNote');
      if (!note) return;
      note.textContent = available
        ? 'Press play, then write down what you heard.'
        : 'No Mandarin voice on this device. Turn Listening off under "What to study", ' +
          'or add one in Settings → Accessibility → Spoken Content → Voices.';
    });
    typedAnswer(host, item, {
      placeholder: 'Chinese or pinyin…',
      lang: 'zh',
      check: value => {
        const given = cleanHan(value);
        if (given === cleanHan(item.simplified) ||
            (item.traditional && given === cleanHan(item.traditional))) return { ok: true };
        const res = comparePinyin(value, item.numbered || item.pinyin);
        if (res.ok) return { ok: true };
        if (res.reason === 'tone') {
          for (const [want, got] of res.toneErrors) SRS.noteTone(want, got);
          return { ok: false, near: true, detail: 'Heard the syllables, missed the tone.' };
        }
        return { ok: false, detail: '' };
      }
    });
  };

  /* --- handwriting: produce the strokes with no outline to copy --- */
  RENDER.hand = (host, item) => {
    const chars = Array.from(item.simplified).filter(isHan);
    host.append(el('div', { class: 'prompt' },
      el('div', { class: 'gloss-large' }, item.meaning),
      el('div', { class: 'gloss-sub pinyin' }, item.pinyin)));

    const grid = el('div', { class: 'tianzige write-pad', id: 'handGrid' });
    const target = el('div', { id: 'handTarget' });
    grid.append(target);
    host.append(el('div', { class: 'hand-wrap' }, grid,
      el('p', { class: 'quiz-feedback', id: 'handFeedback' },
        chars.length > 1 ? `Character 1 of ${chars.length}. Draw it from memory.` : 'Draw it from memory.')));

    host.append(el('div', { class: 'row', style: 'margin-top:14px' },
      el('button', { class: 'btn', type: 'button', onclick: () => giveUpHand(item) }, 'I cannot recall it'),
      el('button', { class: 'btn', type: 'button', onclick: () => { if (writer) writer.animateCharacter(); } }, 'Show me')));

    handState = { chars, index: 0, mistakes: 0, revealed: false };
    mountHand(item);
  };

  async function mountHand(item) {
    const st = handState;
    const char = st.chars[st.index];
    const target = $('#handTarget');
    if (!target) return;
    target.innerHTML = '';
    let charData = null;
    try {
      charData = await (await fetch(CDN(char))).json();
    } catch {
      $('#handFeedback').textContent = 'No stroke data for this character — rate it yourself.';
      showGrades('');
      return;
    }
    if (handState !== st || !$('#handTarget')) return;   /* moved on while loading */
    const size = Math.min(340, $('#handGrid').clientWidth || 260);
    writer = HanziWriter.create(target, char, {
      width: size, height: size, padding: 10,
      showOutline: false, showCharacter: false,
      drawingWidth: 26, showHintAfterMisses: false,
      highlightOnComplete: true, leniency: 1.15,
      strokeColor: cssVar('--ink', '#1b1815'),
      outlineColor: cssVar('--rule', '#ddd2bd'),
      highlightColor: cssVar('--celadon', '#5c8a7b'),
      drawingColor: cssVar('--cinnabar', '#a82a1c'),
      charDataLoader: (c, onLoad) => onLoad(charData)
    });
    writer.quiz({
      onMistake(d) {
        st.mistakes++;
        $('#handFeedback').textContent =
          `Stroke ${d.strokeNum + 1} — not that one. ${st.mistakes} slip${st.mistakes === 1 ? '' : 's'} so far.`;
        $('#handFeedback').className = 'quiz-feedback bad';
      },
      onComplete() {
        st.index++;
        if (st.index < st.chars.length) {
          $('#handFeedback').textContent = `Character ${st.index + 1} of ${st.chars.length}.`;
          $('#handFeedback').className = 'quiz-feedback';
          mountHand(item);
          return;
        }
        const m = st.mistakes;
        $('#handFeedback').className = 'quiz-feedback' + (m === 0 ? ' good' : '');
        $('#handFeedback').textContent = st.revealed
          ? 'Shown rather than recalled.'
          : m === 0 ? 'Every stroke, from memory. 太棒了!'
          : `Done, with ${m} slip${m === 1 ? '' : 's'}.`;
        recommended = st.revealed ? 1 : m === 0 ? 4 : m <= 2 ? 3 : 2;
        autoGraded = true;
        host_reveal(item);
      }
    });
  }

  function giveUpHand(item) {
    if (!handState) return;
    handState.revealed = true;
    recommended = 1;
    autoGraded = true;
    if (writer) { try { writer.cancelQuiz(); } catch { /* fine */ } writer.animateCharacter(); }
    host_reveal(item);
  }

  /* --- tone: hear one of a minimal set, say which one it was ---

     妈 麻 马 骂 are one syllable wearing four tones. An English speaker hears
     them as the same word for a long time, and no amount of vocabulary study
     fixes that on its own — the ear has to be trained against the contrast
     directly. Sets the learner has already confused come round more often. */
  RENDER.tone = (host, item) => {
    const members = item.set.m;
    const asked = members[Math.floor(Math.random() * members.length)];
    let answered = false;

    const say = rate => () => {
      if (!speak(asked.c, rate)) {
        $('#toneNote').textContent = 'This browser has no Chinese voice, so pick from the spelling instead.';
        $('#toneNote').classList.add('bad');
        revealSpelling();
      }
    };

    let audible = hasChineseVoice();
    const syllable = el('div', { class: 'tone-syllable' },
      audible ? item.key.replace(/v/g, 'ü') : asked.p);
    host.append(el('div', { class: 'prompt audio-prompt' },
      syllable,
      el('button', { class: 'btn primary speaker', type: 'button', onclick: say(0.75) }, '🔊 Play'),
      el('button', { class: 'btn', type: 'button', onclick: say(0.45) }, '🐢 Slower'),
      el('p', { class: 'hint', id: 'toneNote' }, audible
        ? 'Which one did you hear?'
        : 'Waiting for a Mandarin voice — press play, or read the tone mark.')));

    /* A voice can arrive a moment after the page is first touched. If it
       does while this card is still up, hide the answer again and let the
       drill be what it is meant to be — a listening test. */
    watchVoice(available => {
      if (answered || available === audible) return;
      audible = available;
      const note = $('#toneNote');
      syllable.textContent = available ? item.key.replace(/v/g, 'ü') : asked.p;
      if (note) {
        note.textContent = available
          ? 'Which one did you hear?'
          : 'No Mandarin voice on this device — read the tone mark instead.';
      }
      if (available) say(0.75)();
    });

    function revealSpelling() {
      $$('.tone-option .to-pinyin').forEach(n => { n.hidden = false; });
    }

    const options = el('div', { class: 'tone-options' });
    for (const m of members) {
      options.append(el('button', {
        class: 'tone-option', type: 'button', 'data-char': m.c,
        onclick: () => pick(m)
      },
        el('span', { class: 'to-char', lang: 'zh' }, m.c),
        el('span', { class: 'to-pinyin', hidden: true }, m.p),
        el('span', { class: 'to-gloss' }, m.g)));
    }
    host.append(options);

    function pick(chosen) {
      if (answered) return;
      answered = true;
      const right = chosen.c === asked.c;
      if (!right) SRS.noteTone(asked.t, chosen.t);
      $$('.tone-option').forEach(btn => {
        btn.disabled = true;
        const c = btn.dataset.char;
        if (c === asked.c) btn.classList.add('right');
        else if (c === chosen.c) btn.classList.add('wrong');
        btn.querySelector('.to-pinyin').hidden = false;
      });
      const note = $('#toneNote');
      note.className = 'hint ' + (right ? 'good' : 'bad');
      note.textContent = right
        ? `Yes — ${asked.p}, tone ${asked.t}.`
        : `It was ${asked.c} ${asked.p}, tone ${asked.t}. You picked tone ${chosen.t}.`;
      recommended = right ? 3 : 1;
      autoGraded = true;
      revealed = true;
      showGrades('');
      if (!right) setTimeout(() => speak(asked.c, 0.55), 320);
    }

    if (audible && speechReady()) setTimeout(say(0.75), 240);
  };

  /* --- grammar: the pattern, and the word it turns on ---

     A grammar point is not a word you recognise and produce, so it gets one
     card rather than six. It is still a memory that decays, which is why it
     is here and not on a page of notes read once and never again: 把 learned
     in March and never met after it is 把 forgotten by June.

     The wrong answers are the points the syllabus already believes get fused
     with this one — 不免 against 不禁, 只要 against 只有. A cloze whose
     distractors are unrelated tests reading, not grammar. */
  RENDER.gram = (host, item) => {
    const point = item.point;
    const [sentence, span, english] = point.eg[Math.floor(Math.random() * point.eg.length)];
    const rest = sentence.replace(span, '');
    let answered = false;

    const head = el('div', { class: 'prompt gram-prompt' },
      el('div', { class: 'gram-pattern', lang: 'zh' }, point.pattern),
      el('div', { class: 'gram-title' }, point.title));
    host.append(head);

    if (currentCard.kind === 'new') {
      /* Brand new: this is an introduction, not a test. */
      host.append(el('div', { class: 'answer gram-answer' },
        el('p', { class: 'answer-gloss' }, point.gloss),
        el('p', { class: 'answer-extra sentence', lang: 'zh' }, sentence),
        el('p', { class: 'answer-extra' }, english),
        el('p', { class: 'answer-extra etym-note', lang: 'zh' }, point.note)));
      revealed = true;
      showGrades('This is new — rate how familiar the pattern already feels.');
      return;
    }

    host.append(el('p', { class: 'ask' }, 'Which one does this sentence need?'));
    host.append(el('div', { class: 'gram-cloze', lang: 'zh' },
      sentence.replace(span, ' ___ ')));

    /* 只要…就 and 只要 are the same answer written twice, and offering both
       under one question is not a choice. Take the first half of a paired
       name, the same rule build-grammar-questions.py uses. */
    const firstHalf = text => {
      let word = String(text || '');
      for (const sep of ['…', '/', ' ', '\uff0c']) word = word.split(sep)[0];
      return word.trim();
    };
    /* The point's own name is barred as well as this example's answer. 然而
       is filed under 然而 and one of its examples turns on 不过 — offering
       然而 against that blank is not a wrong answer, it is a second right
       one. */
    const seen = new Set([span, point.cn, firstHalf(point.cn)]);
    const options = [span];
    const pick = cand => {
      if (options.length >= 4) return;
      const word = firstHalf(cand);
      if (!word || seen.has(word) || rest.includes(word)) return;
      seen.add(word);
      options.push(word);
    };
    point.near.forEach(id => { const g = gramIndex.get(id); if (g) pick(g.cn); });
    point.wrong.forEach(pick);
    /* Top up from the rest of the syllabus if the point's own lists came up
       short after filtering, so a card is never a choice of three. */
    for (let i = 0; options.length < 4 && i < grammar.length; i++) {
      const g = grammar[(point.pos + i * 7) % grammar.length];
      if (g.level === point.level) pick(g.cn);
    }
    for (let i = options.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [options[i], options[j]] = [options[j], options[i]];
    }

    const box = el('div', { class: 'gram-options' });
    for (const word of options) {
      box.append(el('button', {
        class: 'gram-option', type: 'button', lang: 'zh', 'data-word': word,
        onclick: () => choose(word)
      }, word));
    }
    host.append(box);
    const note = el('p', { class: 'hint', id: 'gramNote' }, '');
    host.append(note);

    function choose(word) {
      if (answered) return;
      answered = true;
      const right = word === span;
      $$('.gram-option').forEach(btn => {
        btn.disabled = true;
        if (btn.dataset.word === span) btn.classList.add('right');
        else if (btn.dataset.word === word) btn.classList.add('wrong');
      });
      note.className = 'hint ' + (right ? 'good' : 'bad');
      note.textContent = right ? '对。' : `It is 「${span}」.`;
      host.append(el('div', { class: 'answer gram-answer' },
        el('p', { class: 'answer-extra sentence', lang: 'zh' }, sentence),
        el('p', { class: 'answer-extra' }, english),
        el('p', { class: 'answer-extra etym-note', lang: 'zh' }, point.note)));
      recommended = right ? 3 : 1;
      autoGraded = true;
      revealed = true;
      showGrades('');
    }
  };

  /* ---------- shared card furniture ---------- */

  /* Run `fn` with the current availability of a Mandarin voice, and again if
     that changes while this same card is still on screen. Unsubscribes when
     the card is replaced, so a stale card cannot repaint a live one. */
  let dropVoiceWatch = null;
  function watchVoice(fn) {
    if (dropVoiceWatch) { dropVoiceWatch(); dropVoiceWatch = null; }
    const mine = currentCard;
    dropVoiceWatch = onVoiceChange(available => {
      if (currentCard !== mine) return;
      fn(available);
    });
  }


  /** The answer, with whatever context we have for it. */
  function answerBlock(item, isNew) {
    const box = el('div', { class: 'answer' });
    box.append(el('div', { class: 'answer-head' },
      el('span', { class: 'answer-hanzi', lang: 'zh' }, shown(item)),
      el('span', { class: 'answer-pinyin' }, item.pinyin),
      canSpeak() ? el('button', {
        class: 'mini', type: 'button', title: 'Hear it',
        onclick: () => speak(item.simplified, 0.8)
      }, '🔊') : null));
    box.append(el('p', { class: 'answer-gloss' }, item.meaning));

    if (item.kind === 'char') {
      const bits = [];
      if (item.radical) bits.push(`radical ${item.radical}`);
      if (item.strokes) bits.push(`${item.strokes} strokes`);
      if (item.decomposition && item.decomposition !== '？') bits.push(item.decomposition);
      if (bits.length) box.append(el('p', { class: 'answer-extra' }, bits.join(' · ')));
      if (item.note) box.append(el('p', { class: 'answer-extra etym-note' }, item.note));
      const uses = charWords[item.key];
      if (uses && uses.length) {
        box.append(el('p', { class: 'answer-extra' },
          el('span', { class: 'ctx-label' }, 'appears in '),
          ...uses.slice(0, 4).flatMap((u, i) => [
            i ? el('span', { class: 'ctx-sep' }, ' · ') : '',
            el('span', { lang: 'zh', class: 'ctx-word' }, u.w),
            el('span', { class: 'ctx-gloss' }, ` ${u.e}`)
          ])));
      }
    } else {
      const ex = sentences[item.key];
      if (ex && ex.length) {
        box.append(el('p', { class: 'answer-extra sentence', lang: 'zh' }, ex[0]));
      }
      const chars = Array.from(item.simplified).filter(isHan);
      if (chars.length > 1) {
        const parts = chars.map(c => {
          const h = charIndex.get(c);
          return h ? `${c} ${(h.p || [''])[0]} ${(h.d || '').split(';')[0].trim()}` : c;
        });
        box.append(el('p', { class: 'answer-extra breakdown' }, parts.join('  ·  ')));
      }
    }
    if (isNew) box.classList.add('is-new');
    return box;
  }

  function waitForReveal(item) {
    $('#revealRow').hidden = false;
    $('#reveal').onclick = () => host_reveal(item);
    /* On a phone the whole card is the button. Aiming a thumb at one small
       control, hundreds of times a session, is the difference between an app
       you use on the bus and one you do not. */
    const stage = $('#card');
    stage.classList.add('tappable');
    stage.onclick = e => {
      if (e.target.closest('button, a, input, .answer')) return;
      host_reveal(item);
    };
  }

  function host_reveal(item) {
    if (revealed) return;
    revealed = true;
    $('#revealRow').hidden = true;
    const stage = $('#card');
    stage.classList.remove('tappable');
    stage.classList.add('revealed');
    stage.onclick = null;
    const host = $('#card');
    if (!host.querySelector('.answer')) host.append(answerBlock(item, false));
    showGrades(autoGraded ? '' : 'How did that go?');
  }

  /** A typed answer field that grades itself on submit. */
  function typedAnswer(host, item, opts) {
    const input = el('input', {
      type: 'text', class: 'answer-input', autocomplete: 'off',
      autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false',
      lang: opts.lang, placeholder: opts.placeholder
    });
    const verdict = el('p', { class: 'quiz-feedback' });
    const submit = el('button', { class: 'btn primary', type: 'button' }, 'Check');

    const run = () => {
      if (revealed) return;
      const value = input.value;
      if (!value.trim()) { host_reveal(item); recommended = 1; autoGraded = true; return; }
      const res = opts.check(value);
      input.disabled = true;
      submit.disabled = true;
      verdict.className = 'quiz-feedback ' + (res.ok ? 'good' : 'bad');
      verdict.textContent = res.ok
        ? 'Correct.'
        : (res.detail || 'Not quite.');
      recommended = res.ok ? 3 : res.near ? 2 : 1;
      autoGraded = true;
      host_reveal(item);
    };

    input.addEventListener('keydown', e => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      /* Submitting disables the field, which moves focus to the body. Without
         this the very same keypress carries on up to the window handler,
         which sees no focused input, reads it as "accept the suggested
         grade" and skips the card before the answer is ever on screen. */
      e.stopPropagation();
      run();
    });
    submit.addEventListener('click', run);

    host.append(el('div', { class: 'typed' }, input,
      el('div', { class: 'row', style: 'margin-top:12px' }, submit,
        el('button', {
          class: 'btn', type: 'button',
          onclick: () => { if (!revealed) { recommended = 1; autoGraded = true; host_reveal(item); } }
        }, 'I do not know'))));
    host.append(verdict);
    setTimeout(() => input.focus(), 30);
  }

  /* ---------- grading ---------- */

  function showGrades(note) {
    const bar = $('#grades');
    bar.hidden = false;
    const card = SRS.get(currentCard.id, currentCard.mode) || SRS.fresh();
    const previews = SRS.preview(card);
    $$('#grades .grade').forEach(btn => {
      const rating = Number(btn.dataset.rating);
      btn.querySelector('[data-int]').textContent = humanInterval(previews[rating]);
      btn.classList.toggle('suggested', autoGraded && rating === recommended);
    });
    const host = $('#card');
    const old = host.querySelector('.grade-note');
    if (old) old.remove();
    if (note) host.append(el('p', { class: 'hint grade-note' }, note));
    else if (autoGraded) {
      host.append(el('p', { class: 'hint grade-note' },
        `Suggested: ${['', 'Again', 'Hard', 'Good', 'Easy'][recommended]} — press Enter to take it, or pick another.`));
    }
  }

  function grade(rating) {
    if (!currentCard || $('#grades').hidden) return;
    const ms = Date.now() - cardStart;
    if (!cram) {
      SRS.review(currentCard.id, currentCard.mode, rating, ms);
    }
    answeredCount++;
    if (rating > 1) correctCount++;
    if (currentCard.kind === 'new') newCount++;

    /* Anything you could not recall comes back before the session ends,
       which is what turns a miss into a memory rather than a statistic. */
    if (rating === 1 && queue.length - pos < 120) {
      const back = Math.min(queue.length, pos + 1 + Math.floor(Math.random() * 6) + 4);
      queue.splice(back, 0, Object.assign({}, currentCard, { kind: 'again' }));
    }
    pos++;
    nextCard();
  }

  $$('#grades .grade').forEach(btn =>
    btn.addEventListener('click', () => grade(Number(btn.dataset.rating))));

  /* ---------- finishing ---------- */

  function finish() {
    SRS.flush();
    sessionEl.hidden = true;
    summaryEl.hidden = false;
    const mins = Math.max(1, Math.round((Date.now() - started) / 6e4));
    const acc = answeredCount ? Math.round(correctCount / answeredCount * 100) : 0;
    const board = $('#summaryBoard');
    board.innerHTML = '';
    const tiles = [
      ['Reviewed', answeredCount, 'cards'],
      ['Recalled', acc + '%', 'first try'],
      ['New', newCount, 'items met'],
      ['Time', mins, mins === 1 ? 'minute' : 'minutes']
    ];
    for (const [label, value, sub] of tiles) {
      board.append(el('div', { class: 'due-tile' },
        el('b', {}, String(value)),
        el('span', { class: 'due-label' }, label),
        el('span', { class: 'due-sub' }, sub)));
    }
    const notes = $('#summaryNotes');
    notes.innerHTML = '';
    const c = SRS.counts();
    if (cram) {
      notes.append(el('p', { class: 'hint' },
        'That was a cram run — nothing was rescheduled, so your timetable is untouched.'));
    }
    if (c.due) {
      notes.append(el('p', { class: 'hint' }, `${c.due} card${c.due === 1 ? '' : 's'} still due.`));
    } else {
      const f = SRS.forecast(7);
      const next = f.buckets.findIndex(n => n > 0);
      notes.append(el('p', { class: 'hint' }, next < 0
        ? 'Nothing else scheduled this week.'
        : next === 0 ? 'Everything due today is done.'
        : `Next batch: ${f.buckets[next]} card${f.buckets[next] === 1 ? '' : 's'} in ${next} day${next === 1 ? '' : 's'}.`));
    }
    if (answeredCount >= 12 && acc < 70) {
      notes.append(el('p', { class: 'hint' },
        'That was a hard run. If most sessions look like this, take fewer new items a day — ' +
        'the backlog is what makes reviews feel impossible, not the difficulty of the words.'));
    }
    refreshBoard();
  }

  $('#endSession').addEventListener('click', finish);
  $('#again').addEventListener('click', () => { summaryEl.hidden = true; begin(cram); });
  /**
   * A session made only of tone contrasts, weighted towards the confusions
   * this learner has actually made. Scheduled through the same algorithm as
   * everything else, so a contrast you have nailed stops coming back.
   */
  function beginTones() {
    if (!toneSets.length) {
      /* Returning quietly here is how study.html?tones=1 — the home-screen
         shortcut, and the last step of the sounds stage — spent its life
         showing the setup panel and looking like it had ignored the click. */
      $('#startHint').textContent =
        'The tone sets could not load, so the tone drill is unavailable. '
        + 'Everything else on this page still works.';
      return;
    }
    const confusion = SRS.toneConfusion();
    const heat = {};
    for (const key in confusion) {
      const [want, got] = key.split('>').map(Number);
      heat[want] = (heat[want] || 0) + confusion[key];
      heat[got] = (heat[got] || 0) + confusion[key];
    }
    const levels = new Set(cfg.levels);
    const scored = toneSets
      .filter(g => g.m.some(m => levels.has(m.lv)) || g.lv <= Math.max(...cfg.levels))
      .map(g => {
        const id = ID.tone(g.base);
        const card = SRS.get(id, 'tone');
        const due = !card || card.due <= Date.now();
        const trouble = g.m.reduce((a, m) => a + (heat[m.t] || 0), 0);
        return { id, due, score: (due ? 100 : 0) + trouble * 3 + Math.random() * 8 };
      })
      .sort((a, b) => b.score - a.score);

    queue = scored.slice(0, 30).map(x => ({ id: x.id, mode: 'tone', kind: 'review' }));
    if (!queue.length) return;
    cram = false;
    pos = 0; answeredCount = 0; correctCount = 0; newCount = 0;
    started = Date.now();
    setup.hidden = true; summaryEl.hidden = true; sessionEl.hidden = false;
    nextCard();
  }

  $('#toneDrill').addEventListener('click', beginTones);
  $('#start').addEventListener('click', () => begin(false));
  $('#cram').addEventListener('click', () => begin(true));

  /* ---------- keyboard ---------- */

  addEventListener('keydown', e => {
    if (sessionEl.hidden) return;
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName);
    if (e.key === ' ' && !typing && !$('#revealRow').hidden) {
      e.preventDefault();
      $('#reveal').click();
      return;
    }
    if (typing) return;
    if (e.key >= '1' && e.key <= '4' && !$('#grades').hidden) {
      e.preventDefault();
      grade(Number(e.key));
    } else if (e.key === 'Enter' && !$('#grades').hidden) {
      e.preventDefault();
      grade(autoGraded ? recommended : 3);
    } else if (e.key === 'Escape') {
      finish();
    }
  });

  /* ---------- settings UI ---------- */

  function buildControls() {
    const levels = $('#levels');
    for (let i = 1; i <= 7; i++) {
      levels.append(el('button', {
        class: 'chip', type: 'button', 'data-level': String(i),
        'aria-pressed': String(cfg.levels.includes(i)),
        onclick: () => {
          const at = cfg.levels.indexOf(i);
          if (at >= 0) { if (cfg.levels.length > 1) cfg.levels.splice(at, 1); }
          else cfg.levels.push(i);
          cfg.levels.sort((a, b) => a - b);
          delete cfg.stage;          /* chose by hand — off the path */
          saveDeck(); syncControls(); refreshBoard();
        }
      }, i === 7 ? '进阶' : 'HSK ' + i));
    }

    $$('#content .chip').forEach(b => b.addEventListener('click', () => {
      cfg.content = b.dataset.content;
      delete cfg.stage;
      saveDeck(); syncControls(); refreshBoard();
    }));

    $$('#grammar .chip').forEach(b => b.addEventListener('click', () => {
      cfg.grammar = !cfg.grammar;
      saveDeck(); syncControls(); refreshBoard();
    }));

    const modes = $('#modes');
    for (const m of ALL_MODES) {
      modes.append(el('button', {
        class: 'chip', type: 'button', 'data-mode': m,
        'aria-pressed': String(cfg.modes.includes(m)),
        title: SRS.MODES[m].hint,
        onclick: () => {
          if (m === 'rec') return;                  /* always on */
          const at = cfg.modes.indexOf(m);
          if (at >= 0) cfg.modes.splice(at, 1); else cfg.modes.push(m);
          saveDeck(); syncControls();
        }
      }, `${SRS.MODES[m].cn} · ${SRS.MODES[m].label}`));
    }

    const s = SRS.cfg();
    $('#newPerDay').value = s.newPerDay;
    $('#minutes').value = String(s.minutes);
    $('#retention').value = String(s.retention);

    $('#newPerDay').addEventListener('change', e => {
      const v = Math.max(0, Math.min(200, Number(e.target.value) || 0));
      e.target.value = v;
      SRS.setCfg({ newPerDay: v });
      refreshBoard();
    });
    $('#minutes').addEventListener('change', e => SRS.setCfg({ minutes: Number(e.target.value) }));
    $('#retention').addEventListener('change', e => {
      SRS.setCfg({ retention: Number(e.target.value) });
      syncControls();
    });
  }

  function syncControls() {
    $$('#levels .chip').forEach(b =>
      b.setAttribute('aria-pressed', String(cfg.levels.includes(Number(b.dataset.level)))));
    $$('#content .chip').forEach(b =>
      b.setAttribute('aria-pressed', String(b.dataset.content === cfg.content)));
    $$('#grammar .chip').forEach(b =>
      b.setAttribute('aria-pressed', String(!!cfg.grammar)));
    $$('#modes .chip').forEach(b => {
      b.setAttribute('aria-pressed', String(cfg.modes.includes(b.dataset.mode)));
      if (b.dataset.mode === 'rec') b.classList.add('locked-on');
    });
    const r = SRS.cfg().retention;
    $('#retentionNote').textContent = r <= 0.8
      ? 'Long gaps and the fewest reviews. You will forget roughly one item in five at review time and have to relearn it.'
      : r <= 0.85 ? 'Close to the sweet spot: the most words remembered per minute spent.'
      : r <= 0.9 ? 'The default. Slightly more reviews than 85%, slightly less forgetting.'
      : 'Short gaps and many more reviews for a small gain in recall. Worth it in the fortnight before an exam, not before.';
  }

  onScriptChange(() => { if (!sessionEl.hidden && currentItem) render(); });

  /* ---------- start ---------- */

  (async () => {
    try {
      await loadAll();
    } catch {
      $('#dueBoard').innerHTML = '';
      $('#dueBoard').append(el('p', { class: 'empty' },
        'The word lists could not load. Serve the site over http rather than opening the file directly.'));
      return;
    }
    buildControls();
    syncControls();
    refreshBoard();
    /* Deep links: ?go=1 starts a session immediately, for the home-screen
       shortcut; ?tones=1 opens the tone drill, which the sounds stage of the
       path ends on. The drill needs data the session deliberately does not
       wait for, so this is the one place that waits for it. */
    if (/[?&]tones=1/.test(location.search)) { await tonesReady; beginTones(); }
    else if (/[?&]go=1/.test(location.search)) begin(false);
  })();
})();
