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
/* LearneCN — tracing canvas + dictionary */

(() => {
  const { $, $$, el, data, speak, toneMarks, plainPinyin, isHan, form,
          onScriptChange, cssVar, onSchemeChange, ID } = CN;

  /* =====================================================================
     Stroke-order canvas
     ===================================================================== */

  const grid = $('#writeGrid');
  const target = $('#writeTarget');
  const strip = $('#charStrip');
  const feedback = $('#feedback');
  const factsChar = $('#factsChar');
  const facts = $('#charFacts');

  let writer = null;
  let current = '';
  let numberLayer = null;
  let charData = null;
  let hanziIndex = null;
  let showOutline = true;
  let showNumbers = true;

  const CDN = c => `https://cdn.jsdelivr.net/npm/hanzi-writer-data@2.0/${encodeURIComponent(c)}.json`;
  const dataCache = new Map();

  function loadCharData(char) {
    if (!dataCache.has(char)) {
      dataCache.set(char, fetch(CDN(char))
        .then(r => r.ok ? r.json() : Promise.reject(new Error('no stroke data')))
        .catch(err => { dataCache.delete(char); throw err; }));
    }
    return dataCache.get(char);
  }

  const gridSize = () => Math.min(grid.clientWidth || 300, 340);

  function say(msg, tone) {
    feedback.textContent = msg;
    feedback.className = 'quiz-feedback' + (tone ? ' ' + tone : '');
  }

  /* ---- stroke numbers drawn over the character ---- */

  function clearNumbers() {
    if (numberLayer) { numberLayer.remove(); numberLayer = null; }
  }

  function drawNumbers() {
    clearNumbers();
    if (!showNumbers || !charData || !charData.medians) return;
    const size = gridSize(), pad = 12;
    const scale = (size - pad * 2) / 1024;
    const svgNS = 'http://www.w3.org/2000/svg';
    const layer = document.createElementNS(svgNS, 'svg');
    layer.setAttribute('width', size);
    layer.setAttribute('height', size);
    layer.setAttribute('viewBox', `0 0 ${size} ${size}`);
    Object.assign(layer.style, {
      position: 'absolute', inset: '0', pointerEvents: 'none'
    });

    charData.medians.forEach((median, i) => {
      const [mx, my] = median[0] || [0, 0];
      const x = pad + mx * scale;
      const y = (size - pad) - my * scale;
      const t = document.createElementNS(svgNS, 'text');
      t.setAttribute('x', x);
      t.setAttribute('y', y);
      t.setAttribute('class', 'stroke-num');
      t.setAttribute('font-size', Math.max(10, size * 0.055));
      t.setAttribute('text-anchor', 'middle');
      t.setAttribute('dominant-baseline', 'central');
      t.textContent = String(i + 1);
      layer.append(t);
    });

    grid.style.position = 'relative';
    grid.append(layer);
    numberLayer = layer;
  }

  /* ---- facts panel ---- */

  async function showFacts(char) {
    if (!hanziIndex) {
      const list = await data('hanzi');
      hanziIndex = new Map(list.map(c => [c.c, c]));
    }
    const c = hanziIndex.get(char);
    factsChar.textContent = char;
    facts.innerHTML = '';

    if (!c) {
      facts.append(el('p', { class: 'hint' },
        'No character notes for this one — the stroke order still works.'));
      return;
    }

    const rows = [];
    if (c.p && c.p.length) rows.push(['Pinyin', el('span', { class: 'pinyin' }, c.p.join(' · '))]);
    if (c.d) rows.push(['Meaning', c.d]);
    if (c.s) rows.push(['Strokes', String(c.s)]);
    if (c.r) rows.push(['Radical', el('span', { class: 'decomp' }, c.r)]);
    if (c.dc && !c.dc.includes('？') && c.dc !== char)
      rows.push(['Built from', el('span', { class: 'decomp' }, c.dc)]);
    if (typeof c.lv === 'number') rows.push(['Level', `HSK ${c.lv}`]);

    for (const [k, v] of rows) {
      facts.append(el('div', { class: 'fact' }, el('dt', {}, k), el('dd', {}, v)));
    }
    if (c.h) {
      const safe = c.h.replace(/[&<>]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[ch]));
      facts.append(el('p', { class: 'etym', html: safe.replace(/([\u3400-\u9fff])/g, '<b>$1</b>') }));
    }
  }

  /* ---- loading a character ---- */

  async function loadChar(char) {
    current = char;
    $$('#charStrip button').forEach(b =>
      b.setAttribute('aria-pressed', String(b.textContent === char)));
    say('Loading strokes…');
    clearNumbers();
    target.classList.remove('write-static');
    target.innerHTML = '';
    showFacts(char);

    try {
      charData = await loadCharData(char);
    } catch {
      charData = null;
      target.classList.add('write-static');
      target.textContent = char;
      say('No stroke data for this character.', 'bad');
      return;
    }

    const size = gridSize();
    writer = HanziWriter.create(target, char, {
      width: size, height: size, padding: 12,
      showOutline,
      showCharacter: false,
      strokeAnimationSpeed: 1,
      delayBetweenStrokes: 130,
      drawingWidth: 26,
      showHintAfterMisses: 3,
      highlightOnComplete: true,
      leniency: 1.1,
      strokeColor: cssVar('--ink', '#1b1815'),
      outlineColor: cssVar('--rule', '#ddd2bd'),
      highlightColor: cssVar('--celadon', '#5c8a7b'),
      drawingColor: cssVar('--cinnabar', '#a82a1c'),
      charDataLoader: (c, onLoad) => onLoad(charData)
    });

    drawNumbers();
    say('Ready — press Trace it, or Watch it first.');
  }

  /* ---- character strip ---- */

  function setChars(text) {
    const chars = Array.from(text).filter(isHan);
    strip.innerHTML = '';
    if (!chars.length) {
      strip.append(el('span', { class: 'hint' }, 'Type some Chinese above, then press Load.'));
      return;
    }
    chars.forEach(c => strip.append(
      el('button', { type: 'button', 'aria-pressed': 'false', onclick: () => loadChar(c) }, c)));
    loadChar(chars[0]);
  }

  $('#loadChars').addEventListener('click', () => setChars($('#writeInput').value));
  $('#writeInput').addEventListener('keydown', e => {
    if (e.key === 'Enter') setChars(e.target.value);
  });

  $('#btnWatch').addEventListener('click', () => {
    if (!writer) return;
    writer.cancelQuiz();
    say('Watch the order…');
    writer.animateCharacter({ onComplete: () => say('Now try it yourself.') });
  });

  $('#btnTrace').addEventListener('click', () => {
    if (!writer) return;
    let misses = 0;
    const startedAt = Date.now();
    const blind = !showOutline;      /* copying an outline is not recall */
    const target = current;
    writer.quiz({
      onMistake(d) {
        misses++;
        say(`Stroke ${d.strokeNum + 1} — not quite. ${d.mistakesOnStroke} ${
          d.mistakesOnStroke === 1 ? 'try' : 'tries'} on this one.`, 'bad');
      },
      onCorrectStroke(d) {
        const total = charData && charData.strokes ? charData.strokes.length : '?';
        say(`Stroke ${d.strokeNum + 1} of ${total} — good.`, 'good');
      },
      onComplete(d) {
        const clean = d.totalMistakes === 0;
        let tail = '';
        /* Only a blind attempt is evidence about memory, so only a blind
           attempt is worth scheduling. Tracing over the outline still
           teaches the stroke order — it just does not prove anything. */
        if (blind && typeof SRS !== 'undefined' && target) {
          const rating = clean ? 4 : d.totalMistakes <= 2 ? 3 : d.totalMistakes <= 4 ? 2 : 1;
          SRS.review(ID.char(target), 'hand', rating, Date.now() - startedAt);
          tail = ' Counted towards your handwriting schedule.';
        } else if (!blind) {
          tail = ' Turn the outline off to have it count towards your schedule.';
        }
        say((clean
          ? 'Whole character, no mistakes. 太棒了!'
          : `Done — ${d.totalMistakes} ${d.totalMistakes === 1 ? 'mistake' : 'mistakes'}. Go again?`) + tail,
          clean ? 'good' : null);
      }
    });
    say(blind ? 'Draw stroke 1 — from memory.' : 'Draw stroke 1.');
  });

  $('#btnOutline').addEventListener('click', e => {
    showOutline = !showOutline;
    e.target.setAttribute('aria-pressed', String(showOutline));
    e.target.textContent = showOutline ? 'Outline on' : 'Outline off';
    if (writer) showOutline ? writer.showOutline() : writer.hideOutline();
  });

  $('#btnNumbers').addEventListener('click', e => {
    showNumbers = !showNumbers;
    e.target.setAttribute('aria-pressed', String(showNumbers));
    e.target.textContent = showNumbers ? 'Numbers on' : 'Numbers off';
    drawNumbers();
  });

  $('#btnHear').addEventListener('click', () => {
    if (!current) return;
    if (!speak(current)) say('This browser has no speech voice installed.', 'bad');
  });

  addEventListener('resize', () => { if (current) loadChar(current); }, { passive: true });

  // Deep link: writing.html?c=学
  const wanted = new URLSearchParams(location.search).get('c');
  $('#writeInput').value = wanted || $('#writeInput').value;
  setChars($('#writeInput').value);

  /* =====================================================================
     Dictionary
     ===================================================================== */

  const dictInput = $('#dictInput');
  const dictResults = $('#dictResults');
  const dictStatus = $('#dictStatus');
  const dictProgress = $('#dictProgress');

  let dict = null, dictLoading = null;

  async function loadDict() {
    if (dict) return dict;
    if (dictLoading) return dictLoading;

    dictLoading = (async () => {
      dictStatus.textContent = 'Loading dictionary…';
      dictProgress.hidden = false;
      const res = await fetch('../data/cedict.json');
      if (!res.ok) throw new Error(`cedict.json returned ${res.status}`);

      const total = Number(res.headers.get('content-length')) || 0;
      let text;
      if (res.body && total) {
        const reader = res.body.getReader();
        const chunks = [];
        let got = 0;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
          got += value.length;
          dictProgress.value = Math.min(100, Math.round(got / total * 100));
        }
        const merged = new Uint8Array(got);
        let offset = 0;
        for (const chunk of chunks) { merged.set(chunk, offset); offset += chunk.length; }
        text = new TextDecoder().decode(merged);
      } else {
        dictProgress.removeAttribute('value');
        text = await res.text();
      }

      const raw = JSON.parse(text);
      // [simplified, traditional, pinyin(numbered), definitions]
      dict = raw.map(([s, t, p, d]) => ({
        s, t, p, d,
        key: plainPinyin(p),
        eng: d.toLowerCase()
      }));
      dictProgress.hidden = true;
      dictStatus.textContent = `${dict.length.toLocaleString()} entries ready.`;
      return dict;
    })();

    return dictLoading;
  }

  function score(entry, q, qp, isHanQuery) {
    if (isHanQuery) {
      if (entry.s === q || entry.t === q) return 0;
      if (entry.s.startsWith(q) || entry.t.startsWith(q)) return 1;
      if (entry.s.includes(q) || entry.t.includes(q)) return 2;
      return -1;
    }
    if (qp) {
      if (entry.key === qp) return 0;
      if (entry.key.startsWith(qp)) return 1;
    }
    const lower = q.toLowerCase();
    if (new RegExp(`(^|[^a-z])${lower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z]|$)`).test(entry.eng)) return 2;
    if (entry.eng.includes(lower)) return 3;
    if (qp && entry.key.includes(qp)) return 4;
    return -1;
  }

  function renderEntry(e) {
    const primary = form(e.s, e.t);
    const other = primary === e.s ? e.t : e.s;
    const defs = e.d.split('/').filter(Boolean);

    return el('div', { class: 'entry' },
      el('div', { class: 'entry-head' },
        el('span', { class: 'entry-word', lang: 'zh' }, primary),
        other ? el('span', { class: 'entry-alt', lang: 'zh' }, other) : null),
      el('div', { class: 'entry-body' },
        el('div', { class: 'entry-pinyin' }, toneMarks(e.p)),
        el('ol', { class: 'entry-defs' }, defs.map(d => el('li', {}, d)))),
      el('div', { class: 'entry-tools' },
        el('button', { class: 'mini', type: 'button', onclick: () => speak(e.s) }, '🔊 Hear'),
        el('button', {
          class: 'mini', type: 'button', onclick: () => {
            $('#writeInput').value = e.s;
            setChars(e.s);
            grid.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }
        }, '✎ Trace')));
  }

  async function search() {
    const q = dictInput.value.trim();
    dictResults.innerHTML = '';
    if (!q) return;

    try {
      await loadDict();
    } catch (err) {
      dictResults.append(el('p', { class: 'empty' },
        'The dictionary file could not be loaded. Serve the site over http rather than opening the file directly.'));
      dictProgress.hidden = true;
      dictStatus.textContent = '';
      return;
    }

    const hanQuery = isHan(q);
    const qp = hanQuery ? '' : plainPinyin(q);
    const hits = [];
    for (const e of dict) {
      const s = score(e, q, qp, hanQuery);
      if (s >= 0) hits.push([s, e.s.length, e]);
      if (hits.length > 4000) break;
    }
    hits.sort((a, b) => a[0] - b[0] || a[1] - b[1]);

    if (!hits.length) {
      dictResults.append(el('p', { class: 'empty' },
        `Nothing matched “${q}”. Try fewer characters, or drop the tone numbers.`));
      return;
    }

    const shown = hits.slice(0, 60);
    shown.forEach(([, , e]) => dictResults.append(renderEntry(e)));
    dictStatus.textContent = `${hits.length.toLocaleString()} match${hits.length === 1 ? '' : 'es'}` +
      (hits.length > shown.length ? ` — showing the first ${shown.length}.` : '.');
  }

  $('#dictGo').addEventListener('click', search);
  dictInput.addEventListener('keydown', e => { if (e.key === 'Enter') search(); });
  onScriptChange(() => { if (dictResults.children.length) search(); });

  const q0 = new URLSearchParams(location.search).get('q');
  if (q0) { dictInput.value = q0; search(); }
})();
