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
/* LearneCN — shared helpers */

const CN = (() => {

  /* ---------- storage (degrades to memory if blocked) ---------- */
  const mem = new Map();
  const store = {
    get(key, fallback) {
      try {
        const v = localStorage.getItem(key);
        return v === null ? fallback : JSON.parse(v);
      } catch {
        return mem.has(key) ? mem.get(key) : fallback;
      }
    },
    set(key, value) {
      try { localStorage.setItem(key, JSON.stringify(value)); }
      catch { mem.set(key, value); }
    }
  };

  /* ---------- DOM ---------- */
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  function el(tag, props = {}, ...kids) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') node.className = v;
      else if (k === 'html') node.innerHTML = v;
      else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat()) {
      if (kid === null || kid === undefined || kid === false) continue;
      node.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    }
    return node;
  }

  /* ---------- data ---------- */
  const cache = new Map();
  function data(name) {
    if (!cache.has(name)) {
      cache.set(name, fetch(`../data/${name}.json`).then(r => {
        if (!r.ok) throw new Error(`${name}.json returned ${r.status}`);
        return r.json();
      }));
    }
    return cache.get(name);
  }

  /* ---------- simplified / traditional ---------- */
  let script = store.get('cn.script', 'simplified');

  function currentScript() { return script; }

  /** Pick the right form given a simplified and (possibly empty) traditional string. */
  function form(simplified, traditional) {
    return (script === 'traditional' && traditional) ? traditional : simplified;
  }

  const scriptListeners = new Set();
  function onScriptChange(fn) { scriptListeners.add(fn); }

  function setScript(next) {
    script = next;
    store.set('cn.script', next);
    $$('.script-toggle button').forEach(b =>
      b.setAttribute('aria-pressed', String(b.dataset.script === next)));
    scriptListeners.forEach(fn => fn(next));
  }

  /* ---------- speech ----------

     iOS is the awkward one. Three things are true there and nowhere else:

       · getVoices() returns an empty list until the engine has been used
       · speak() does nothing at all unless the first call happens inside a
         real user gesture — no error, no warning, just silence
       · the queue is left paused when the app is backgrounded

     So the engine is primed with a silent utterance on the first touch
     anywhere on the page, voices are re-polled rather than read once, and
     anything that depends on hearing Mandarin asks `hasChineseVoice()` at
     the moment it needs it instead of caching the answer. */

  let voice = null, voicesReady = false, primed = false;
  const voiceListeners = new Set();

  function pickVoice() {
    if (!('speechSynthesis' in window)) return;
    const all = speechSynthesis.getVoices();
    if (!all.length) return;
    const had = voice;
    voice = all.find(v => /^zh[-_]CN/i.test(v.lang))
         || all.find(v => /^zh[-_](HK|TW|SG)/i.test(v.lang))
         || all.find(v => /^zh/i.test(v.lang))
         || null;
    voicesReady = true;
    if (voice !== had) voiceListeners.forEach(fn => { try { fn(!!voice); } catch { /* listener's problem */ } });
  }

  /** Wake the speech engine from inside a user gesture. Harmless elsewhere. */
  function primeSpeech() {
    if (primed || !('speechSynthesis' in window)) return;
    primed = true;
    try {
      const silent = new SpeechSynthesisUtterance(' ');
      silent.volume = 0;
      speechSynthesis.speak(silent);
    } catch { /* nothing to do about it */ }
    pickVoice();
    setTimeout(pickVoice, 250);
    setTimeout(pickVoice, 1200);
  }

  if ('speechSynthesis' in window) {
    pickVoice();
    speechSynthesis.addEventListener('voiceschanged', pickVoice);
    for (const evt of ['pointerdown', 'touchend', 'keydown']) {
      addEventListener(evt, primeSpeech, { capture: true, passive: true, once: true });
    }
    /* Coming back from the lock screen can leave the queue paused. */
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible') return;
      try { if (speechSynthesis.paused) speechSynthesis.resume(); } catch { /* fine */ }
    });
  }

  /** Speak Mandarin. Returns false when there is no speech engine at all. */
  function speak(text, rate = 0.85) {
    if (!('speechSynthesis' in window) || !text) return false;
    if (!voicesReady) pickVoice();

    /* Cancelling and speaking in the same tick swallows the new utterance on
       iOS, so only cancel when something is genuinely in flight and let it
       clear first. */
    const busy = speechSynthesis.speaking || speechSynthesis.pending;
    const go = () => {
      const u = new SpeechSynthesisUtterance(String(text));
      u.lang = 'zh-CN';
      u.rate = rate;
      if (voice) u.voice = voice;
      try { speechSynthesis.speak(u); } catch { /* nothing to do */ }
    };
    if (busy) { speechSynthesis.cancel(); setTimeout(go, 90); } else { go(); }
    return true;
  }

  function canSpeak() {
    if (!('speechSynthesis' in window)) return false;
    if (!voicesReady) pickVoice();
    return true;
  }

  /**
   * Whether a Mandarin voice is actually installed, as opposed to the speech
   * API merely existing. Anything that depends on hearing the language —
   * listening cards, tone discrimination — has to check this at the moment
   * it needs it, because on iOS the honest answer is "not yet" until the
   * first touch and "yes" immediately afterwards.
   */
  function hasChineseVoice() {
    if (!('speechSynthesis' in window)) return false;
    if (!voicesReady || !voice) pickVoice();
    return !!voice;
  }

  /** Whether audio can play right now without waiting for another tap. */
  function speechReady() { return primed && !!voice; }

  /** Called when a Mandarin voice appears (or disappears). */
  function onVoiceChange(fn) {
    voiceListeners.add(fn);
    return () => voiceListeners.delete(fn);
  }

  /* ---------- theme colours ---------- */

  /* Hanzi Writer parses colour strings itself and only understands hex or
     rgb(), so CSS variables have to be resolved before they are handed over. */
  function cssVar(name, fallback = '#000000') {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v) ? v : fallback;
  }

  function onSchemeChange(fn) {
    if (!window.matchMedia) return;
    const mq = matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener ? mq.addEventListener('change', fn) : mq.addListener(fn);
  }

  /* ---------- pinyin ---------- */
  const TONES = {
    a: 'āáǎà', e: 'ēéěè', i: 'īíǐì', o: 'ōóǒò',
    u: 'ūúǔù', ü: 'ǖǘǚǜ', v: 'ǖǘǚǜ'
  };

  /** "ni3 hao3" -> "nǐ hǎo" */
  function toneMarks(numbered) {
    return String(numbered).trim().split(/\s+/).map(syl => {
      const m = syl.match(/^([a-zA-ZüÜ:]+)([1-5])$/);
      if (!m) return syl;
      let [, body, tone] = m;
      body = body.replace(/u:/gi, 'ü').replace(/v/gi, 'ü');
      const t = Number(tone);
      if (t === 5) return body;
      let target = /a/i.test(body) ? 'a'
                 : /e/i.test(body) ? 'e'
                 : /ou/i.test(body) ? 'o'
                 : (body.match(/[aeiouü]/gi) || []).pop();
      if (!target) return body;
      const idx = body.toLowerCase().lastIndexOf(target.toLowerCase());
      const marked = TONES[target.toLowerCase()][t - 1];
      return body.slice(0, idx) + (target === target.toUpperCase() && /[A-ZÜ]/.test(target)
        ? marked.toUpperCase() : marked) + body.slice(idx + 1);
    }).join(' ');
  }

  /**
   * Strip tones and spacing so "nǐ hǎo", "ni3hao3" and "nihao" all match.
   *
   * This one is for searching, so it is deliberately lenient: ü, v and u:
   * all fold to plain u. Somebody hunting for 绿 will type lu, lü or lv
   * depending on their keyboard and how much pinyin they know, and all
   * three should find it.
   */
  function plainPinyin(s) {
    return String(s).toLowerCase()
      .normalize('NFD')
      .replace(/u\u0308/g, 'u')      /* ü decomposes to u + diaeresis */
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/ü/g, 'u').replace(/u:/g, 'u').replace(/v/g, 'u')
      .replace(/[^a-z]/g, '');
  }

  const TONE_OF = { '\u0304': 1, '\u0301': 2, '\u030c': 3, '\u0300': 4 };

  /**
   * Break a reading into syllables carrying their tone.
   * "ni3 hao3", "nǐhǎo" and "nihao" all parse; the last reports tone 0,
   * meaning the writer did not commit to one.
   */
  function parsePinyin(text) {
    /* Fold ü to v up front, before any tone mark is stripped.
       ǚ decomposes to u + diaeresis + caron, so removing every combining
       mark in one pass turns nǚ into nu and quietly merges 女 with 努.
       This one is for grading, where that distinction is the whole point. */
    const s = String(text || '').trim().toLowerCase()
      .normalize('NFD')
      .replace(/u\u0308/g, 'v')
      .replace(/ü/g, 'v')
      .replace(/u:/g, 'v');
    if (!s) return [];

    if (/[1-5]/.test(s)) {
      /* The digit is optional on each syllable, because people write the
         neutral one bare: "ba4ba" for 爸爸 is how everybody types it. */
      const clean = s.replace(/[\u0300-\u036f]/g, '');
      const out = [];
      const re = /([a-z]+)([1-5])?/g;
      let m;
      while ((m = re.exec(clean))) {
        if (!m[1]) { re.lastIndex++; continue; }
        out.push({ base: m[1], tone: m[2] ? Number(m[2]) : 0 });
      }
      return out;
    }

    const parts = s.split(/\s+/).filter(Boolean);
    return (parts.length > 1 ? parts : [s]).map(part => {
      let tone = 0;
      for (const ch of part) if (TONE_OF[ch]) tone = TONE_OF[ch];
      const base = part.replace(/[\u0300-\u036f]/g, '').replace(/[^a-z]/g, '');
      return { base, tone };
    }).filter(x => x.base);
  }

  /**
   * Compare a typed reading against the expected one.
   *
   * Separates "wrong syllables" from "right syllables, wrong tone", because
   * they are different mistakes and only the second one is a tone problem
   * worth drilling. A neutral fifth tone is not held against anyone: writing
   * "ba" for "ba5" is accepted.
   */
  function comparePinyin(given, expected) {
    const a = parsePinyin(given);
    const b = parsePinyin(expected);
    if (!a.length || !b.length) return { ok: false, reason: 'empty' };

    const flat = list => list.map(x => x.base).join('');
    const sameLength = a.length === b.length;
    if (flat(a) !== flat(b)) return { ok: false, reason: 'syllables' };

    const toneErrors = [];
    let typedAny = false;
    if (sameLength) {
      for (let i = 0; i < a.length; i++) {
        const want = b[i].tone, got = a[i].tone;
        if (got) typedAny = true;
        if (!got || !want) continue;
        if (want === 5 && got === 5) continue;
        if (want !== got) toneErrors.push([want, got]);
      }
    } else {
      typedAny = a.some(x => x.tone);
    }
    if (toneErrors.length) return { ok: false, reason: 'tone', toneErrors };
    /* Syllables right but no tone offered at all: the tone is the word, so
       this is not yet a correct answer. */
    if (!typedAny && b.some(x => x.tone && x.tone !== 5)) return { ok: false, reason: 'notone' };
    return { ok: true };
  }

  const isHan = s => /[\u3400-\u9fff\uf900-\ufaff]/.test(s);

  /* ---------- what the scheduler calls things ---------- */

  /* Everything with a memory attached is addressed as `<kind>:<key>`:

       w:生日   a word on the HSK list, or one of the phrases beside it
       c:生     a single character
       t:hao    a tone set — every character sharing one toneless syllable
       q:1f4a   a practice question, keyed by a hash of its text

     Five files build and take apart these ids. Until now each of them did it
     with a bare 'w:' + key on one side and slice(0, 1) / slice(2) on the
     other, which is a convention exactly until the day one of them disagrees
     with the rest and nothing says which one is wrong. */
  const ID = {
    word: key => 'w:' + key,
    char: key => 'c:' + key,
    tone: key => 't:' + key,
    gram: key => 'g:' + key,
    quiz: key => 'q:' + key,
    kind: id => String(id).slice(0, 1),
    key:  id => String(id).slice(2),
    is: (id, kind) => String(id).slice(0, 1) === kind
  };

  /* ---------- the HSK list, indexed ---------- */

  /**
   * Index HSK-shaped rows by headword, keeping the earliest level.
   *
   * hsk.json lists six headwords twice — 喂 at levels 1 and 6, and 还 过 得 等
   * 长 at 2 and again at 3 or 4. Built the obvious way, the later row wins,
   * which moves 喂 out of the first level anybody studies and into one almost
   * nobody reaches, and does the same to five HSK 2 words. A word belongs to
   * the earliest level that claims it.
   *
   * Call it more than once to fold extra rows — the phrase list, say — into
   * the same index under the same rule.
   */
  function byWord(rows, into = new Map()) {
    for (const row of rows || []) {
      const cur = into.get(row.s);
      if (!cur || (row.lv || 9) < (cur.lv || 9)) into.set(row.s, row);
    }
    return into;
  }

  /* ---------- chrome ---------- */

  /* Each destination's mark, the same characters the home page cards use.
     On a phone these carry the navigation on their own: six English words
     across a 390px screen is unreadable, six characters is not. */
  const NAV_MARKS = {
    'path.html':       ['路', 'Path'],
    'study.html':      ['复', 'Study'],
    'practice.html':   ['练', 'Practice'],
    'writing.html':    ['写', 'Write'],
    'characters.html': ['音', 'Pinyin'],
    'progress.html':   ['进', 'Progress']
  };
  /* Add is deliberately not in the map. Seven tabs do not fit across a phone
     either, the header still carries it, and of the seven it is the one a
     learner reaches for least. A link with no mark here is simply skipped. */

  /**
   * Build a bottom tab bar from the links already in the header.
   *
   * Six destinations do not fit across the top of a phone — they wrap to
   * three rows and a sticky header then covers most of the screen. Putting
   * them along the bottom is both the iOS convention and the only place on
   * a large phone a thumb comfortably reaches. The bar is generated rather
   * than written into every page, so it cannot drift out of step with the
   * header it mirrors.
   */
  function buildTabBar(here) {
    if (document.querySelector('.tab-bar')) return;
    const links = $$('.site-nav a');
    if (links.length < 2) return;

    const bar = el('nav', { class: 'tab-bar', 'aria-label': 'Sections' });
    for (const a of links) {
      const href = a.getAttribute('href');
      const mark = NAV_MARKS[href];
      if (!mark) continue;
      bar.append(el('a', {
        href,
        class: 'tab' + (href === here ? ' current' : ''),
        'aria-current': href === here ? 'page' : null
      },
        el('span', { class: 'tab-mark', lang: 'zh', 'aria-hidden': 'true' }, mark[0]),
        el('span', { class: 'tab-label' }, mark[1])));
    }
    if (bar.childElementCount) document.body.append(bar);
  }

  function initChrome() {
    const here = location.pathname.split('/').pop() || 'index.html';
    $$('.site-nav a').forEach(a => {
      if (a.getAttribute('href') === here) a.setAttribute('aria-current', 'page');
    });
    buildTabBar(here);
    $$('.script-toggle button').forEach(b => {
      b.setAttribute('aria-pressed', String(b.dataset.script === script));
      b.addEventListener('click', () => setScript(b.dataset.script));
    });
  }

  document.addEventListener('DOMContentLoaded', initChrome);

  return { $, $$, el, data, store, speak, canSpeak, hasChineseVoice,
           speechReady, onVoiceChange, primeSpeech, form, currentScript,
           setScript, onScriptChange, toneMarks, plainPinyin, isHan,
           parsePinyin, comparePinyin, ID, byWord,
           cssVar, onSchemeChange };
})();
