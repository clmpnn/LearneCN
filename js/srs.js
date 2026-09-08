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
/* LearneCN — spaced repetition scheduler.

   The memory model is FSRS (Free Spaced Repetition Scheduler), the same
   open algorithm Anki ships. Three numbers describe what you know about
   one card:

     S  stability      — days until recall probability falls to 90%
     D  difficulty     — 1..10, how much work each review buys you
     R  retrievability — probability you would recall it right now

   Forgetting is a power law, not an exponential: memories decay fast at
   first and then flatten out. That is why an item you have seen five
   times can safely wait a year.

       R(t) = (1 + FACTOR·t/S) ^ DECAY

   Scheduling inverts it. Given a stability and the retention you are
   willing to accept, the interval is the point where R falls to that
   number. Lower desired retention means longer gaps, fewer reviews and
   more forgetting; higher means the opposite. Around 0.90 buys the most
   words remembered per minute spent, which is why it is the default.

   Nothing here talks to a server. State lives in localStorage and can be
   exported to a file from the Progress page. */

const SRS = (() => {

  /* ---------- the model ---------- */

  /* FSRS-5 default weights, fitted against ~700 million reviews from
     the open Anki dataset. They are a starting point for a learner with
     no history; the Progress page reports whether your own reviews
     suggest a different desired retention. */
  const W = [
    0.40255, 1.18385, 3.17300, 15.69105,  /* 0-3   initial stability, one per rating */
    7.19490, 0.53450,                     /* 4-5   initial difficulty */
    1.46040, 0.00460,                     /* 6-7   difficulty delta, mean reversion */
    1.54575, 0.11920, 1.01925,            /* 8-10  stability growth on a success */
    1.93950, 0.11000, 0.29605, 2.26980,   /* 11-14 stability after a lapse */
    0.23150, 2.98980,                     /* 15-16 hard penalty, easy bonus */
    0.51655, 0.66210                      /* 17-18 same-day review */
  ];

  const DECAY  = -0.5;
  const FACTOR = Math.pow(0.9, 1 / DECAY) - 1;   /* 19/81 */

  const MIN = 60e3, DAY = 864e5;

  /* card states */
  const NEW = 0, LEARNING = 1, REVIEW = 2, RELEARNING = 3;

  /* ratings */
  const AGAIN = 1, HARD = 2, GOOD = 3, EASY = 4;

  const clamp = (n, lo, hi) => Math.min(Math.max(n, lo), hi);

  /* The only randomness in the scheduler is interval fuzz. Keeping it behind
     a swappable function is what lets a simulated learner be reproducible —
     an unseeded Math.random() makes the test suite flaky, and a flaky test
     is worse than no test. */
  let random = Math.random;
  function setRandom(fn) { random = typeof fn === 'function' ? fn : Math.random; }

  /** Probability of recalling a card whose last review was `days` ago. */
  function retrievability(days, s) {
    if (!(s > 0)) return 0;
    return Math.pow(1 + FACTOR * Math.max(days, 0) / s, DECAY);
  }

  /** Days until retrievability falls to `retention`. */
  function intervalFor(s, retention) {
    return (s / FACTOR) * (Math.pow(retention, 1 / DECAY) - 1);
  }

  const initStability  = g => Math.max(W[g - 1], 0.1);
  const initDifficulty = g => clamp(W[4] - Math.exp(W[5] * (g - 1)) + 1, 1, 10);

  function nextDifficulty(d, g) {
    const delta = d + (-W[6] * (g - 3)) * ((10 - d) / 9);
    return clamp(W[7] * initDifficulty(EASY) + (1 - W[7]) * delta, 1, 10);
  }

  /** Stability after a review you got right. */
  function gainStability(d, s, r, g) {
    const hard = g === HARD ? W[15] : 1;
    const easy = g === EASY ? W[16] : 1;
    return s * (1 + Math.exp(W[8])
      * (11 - d)
      * Math.pow(s, -W[9])
      * (Math.exp((1 - r) * W[10]) - 1)
      * hard * easy);
  }

  /** Stability after a lapse. Never above what you already had. */
  function loseStability(d, s, r) {
    const fail = W[11]
      * Math.pow(d, -W[12])
      * (Math.pow(s + 1, W[13]) - 1)
      * Math.exp((1 - r) * W[14]);
    return Math.min(Math.max(fail, 0.1), s);
  }

  /** Two reviews on the same day move stability far less than a spaced one. */
  function sameDayStability(s, g) {
    return Math.max(s * Math.exp(W[17] * (g - 3 + W[18])), 0.1);
  }

  /* ---------- config ---------- */

  const DEFAULTS = {
    retention:   0.90,   /* desired recall probability at review time */
    newPerDay:   12,     /* fresh items introduced per day */
    maxReviews:  200,    /* ceiling on reviews per day */
    minutes:     20,     /* target session length */
    maxInterval: 3650,   /* days */
    leech:       7,      /* lapses before an item is flagged */
    unlockAfter: 5,      /* stability in days before extra card types open */
    fuzz:        true,
    burySiblings: true
  };

  /* ---------- state ---------- */

  const KEY = 'cn.srs.v3';
  const LOG_CAP = 6000;

  let db = null;
  let dirty = false;
  let saveTimer = 0;
  let saveFailed = false;

  function blank() {
    return {
      v: 3,
      cfg: Object.assign({}, DEFAULTS),
      cards: {},     /* itemId -> mode -> [s, d, dueSec, lastSec, reps, lapses, state] */
      log: [],       /* [tSec, itemId, mode, rating, elapsedDays, ms, stabilityBefore] */
      days: {},      /* 'YYYY-MM-DD' -> [reviews, correct, newIntroduced, ms] */
      tones: {},     /* 'expected>got' -> count */
      seen: {}       /* itemId -> first-introduced day, for pacing */
    };
  }

  function load() {
    if (db) return db;
    let raw = null;
    try { raw = localStorage.getItem(KEY); } catch { /* private mode */ }
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (parsed && parsed.v === 3) {
          db = parsed;
          db.cfg = Object.assign({}, DEFAULTS, db.cfg || {});
          for (const k of ['cards', 'log', 'days', 'tones', 'seen']) {
            if (!db[k]) db[k] = k === 'log' ? [] : {};
          }
          return db;
        }
      } catch { /* corrupt — start clean rather than lose the session */ }
    }
    db = blank();
    return db;
  }

  function save(now) {
    dirty = true;
    if (saveTimer) return;
    saveTimer = setTimeout(flush, now ? 0 : 400);
    if (now) { clearTimeout(saveTimer); saveTimer = 0; flush(); }
  }

  function flush() {
    saveTimer = 0;
    if (!dirty || !db) return;
    dirty = false;
    try {
      localStorage.setItem(KEY, JSON.stringify(db, replacer));
      saveFailed = false;
    } catch {
      /* Quota, or storage blocked. Shed the review log — the daily
         aggregates carry the dashboard, and they are tiny. */
      try {
        db.log = db.log.slice(-500);
        localStorage.setItem(KEY, JSON.stringify(db, replacer));
        saveFailed = false;
      } catch { saveFailed = true; }
    }
  }

  /* Round floats on the way out. Full doubles triple the stored size for
     precision that means nothing to a scheduler working in days. */
  function replacer(key, value) {
    return typeof value === 'number' && !Number.isInteger(value)
      ? Math.round(value * 1e4) / 1e4
      : value;
  }

  if (typeof addEventListener === 'function') {
    addEventListener('pagehide', flush);
    addEventListener('beforeunload', flush);
    document.addEventListener?.('visibilitychange', () => {
      if (document.visibilityState === 'hidden') flush();
    });
  }

  /* ---------- cards ---------- */

  /* An item is a thing you are learning — a word, a character, a tone
     contrast or a grammar point. Each item grows several cards, one per
     direction of recall, because recognising 生日 and producing it from
     "birthday" are genuinely different memories and decay at different rates.

     Tone and grammar items have one card each and are their own kind: 把 is
     not a word you recognise and produce, it is a shape that either fires
     when you need it or does not. But it decays like everything else, which
     is the whole reason it belongs to the scheduler rather than to a page of
     notes you read once. */
  const MODES = {
    rec:  { label: 'Recognition', cn: '认读', hint: 'Chinese → meaning' },
    prod: { label: 'Production',  cn: '默写', hint: 'meaning → Chinese' },
    pin:  { label: 'Pinyin',      cn: '拼音', hint: 'Chinese → pinyin with tone' },
    aud:  { label: 'Listening',   cn: '听力', hint: 'audio → meaning' },
    hand: { label: 'Handwriting', cn: '书写', hint: 'draw it from memory' },
    tone: { label: 'Tone',        cn: '声调', hint: 'which tone is it' },
    gram: { label: 'Grammar',     cn: '语法', hint: 'the pattern, and the word it turns on' }
  };

  const nowSec = () => Math.floor(Date.now() / 1000);
  const dayKey = t => new Date(t).toISOString().slice(0, 10);

  function decode(arr) {
    return {
      s: arr[0], d: arr[1],
      due: arr[2] * 1000, last: arr[3] * 1000,
      reps: arr[4], lapses: arr[5], state: arr[6]
    };
  }
  function encode(c) {
    return [c.s, c.d, Math.round(c.due / 1000), Math.round(c.last / 1000),
            c.reps, c.lapses, c.state];
  }

  function fresh() {
    return { s: 0, d: 0, due: 0, last: 0, reps: 0, lapses: 0, state: NEW };
  }

  /** The stored card, or null when the item has never been introduced. */
  function get(itemId, mode) {
    const d = load();
    const rec = d.cards[itemId];
    return rec && rec[mode] ? decode(rec[mode]) : null;
  }

  function put(itemId, mode, card) {
    const d = load();
    (d.cards[itemId] || (d.cards[itemId] = {}))[mode] = encode(card);
    save();
  }

  const isIntroduced = itemId => !!load().cards[itemId];

  /* ---------- scheduling ---------- */

  /** What each of the four buttons would do, without committing to any. */
  function preview(card, at = Date.now()) {
    const out = {};
    for (const g of [AGAIN, HARD, GOOD, EASY]) out[g] = apply(clone(card), g, at).due - at;
    return out;
  }

  const clone = c => c ? Object.assign({}, c) : fresh();

  /** Advance a card by one review. Pure: returns the next state. */
  function apply(card, rating, at = Date.now()) {
    const cfg = load().cfg;
    const g = clamp(Math.round(rating), 1, 4);
    const c = clone(card);
    const elapsed = c.last ? (at - c.last) / DAY : 0;

    if (c.state === NEW) {
      c.s = initStability(g);
      c.d = initDifficulty(g);
      c.reps = 1;
      if (g === EASY) {
        c.state = REVIEW;
        c.due = at + graduate(c.s, cfg) * DAY;
      } else {
        c.state = LEARNING;
        c.due = at + (g === AGAIN ? 1 : g === HARD ? 6 : 10) * MIN;
      }
    } else if (c.state === LEARNING || c.state === RELEARNING) {
      c.reps++;
      c.s = sameDayStability(c.s, g);
      if (g >= GOOD) {
        c.state = REVIEW;
        c.due = at + graduate(c.s, cfg) * DAY;
      } else {
        c.due = at + (g === AGAIN ? 1 : 6) * MIN;
      }
    } else {
      /* a real, spaced review */
      const r = retrievability(elapsed, c.s);
      c.reps++;
      c.d = nextDifficulty(c.d, g);
      if (g === AGAIN) {
        c.lapses++;
        c.s = loseStability(c.d, c.s, r);
        c.state = RELEARNING;
        c.due = at + 10 * MIN;
      } else {
        c.s = elapsed < 1
          ? sameDayStability(c.s, g)          /* cramming the same day */
          : gainStability(c.d, c.s, r, g);
        c.state = REVIEW;
        c.due = at + graduate(c.s, cfg) * DAY;
      }
    }

    c.last = at;
    return c;
  }

  /** Stability to an interval in whole days, fuzzed and capped. */
  function graduate(s, cfg) {
    let days = intervalFor(s, cfg.retention);
    days = clamp(days, 1, cfg.maxInterval);
    if (cfg.fuzz && days >= 2.5) {
      /* Spread due dates so a big intake day does not become a wall of
         reviews a month later. */
      const spread = days * 0.05 + 1;
      days += (random() * 2 - 1) * spread;
    }
    return Math.max(1, Math.round(days));
  }

  /** Commit a review: update the card, log it, roll the daily counters. */
  function review(itemId, mode, rating, ms = 0, at = Date.now()) {
    const d = load();
    const before = get(itemId, mode) || fresh();
    const wasNew = before.state === NEW;
    const after = apply(before, rating, at);
    put(itemId, mode, after);

    const elapsed = before.last ? (at - before.last) / DAY : 0;
    d.log.push([Math.floor(at / 1000), itemId, mode, rating,
                Math.round(elapsed * 100) / 100, Math.round(ms),
                Math.round(before.s * 100) / 100]);
    if (d.log.length > LOG_CAP) d.log.splice(0, d.log.length - LOG_CAP);

    const key = dayKey(at);
    const row = d.days[key] || (d.days[key] = [0, 0, 0, 0]);
    row[0]++;
    if (rating > AGAIN) row[1]++;
    if (wasNew) { row[2]++; d.seen[itemId] = key; }
    row[3] += Math.round(ms);

    save();
    return after;
  }

  /* ---------- queue ---------- */

  function counts(at = Date.now()) {
    const d = load();
    let due = 0, learning = 0, mature = 0, young = 0, total = 0, leeches = 0;
    for (const id in d.cards) {
      for (const mode in d.cards[id]) {
        const c = decode(d.cards[id][mode]);
        total++;
        if (c.lapses >= d.cfg.leech) leeches++;
        if (c.state === LEARNING || c.state === RELEARNING) {
          learning++;
          if (c.due <= at) due++;
        } else if (c.state === REVIEW) {
          if (c.s >= 21) mature++; else young++;
          if (c.due <= at) due++;
        }
      }
    }
    const today = d.days[dayKey(at)] || [0, 0, 0, 0];
    return {
      due, learning, mature, young, total, leeches,
      items: Object.keys(d.cards).length,
      reviewsToday: today[0], newToday: today[2],
      newLeft: Math.max(0, d.cfg.newPerDay - today[2]),
      reviewsLeft: Math.max(0, d.cfg.maxReviews - today[0])
    };
  }

  /** Every card that is due, worst-overdue first. */
  function dueList(at = Date.now()) {
    const d = load();
    const out = [];
    for (const id in d.cards) {
      for (const mode in d.cards[id]) {
        const c = decode(d.cards[id][mode]);
        if (c.due <= at) {
          const elapsed = c.last ? (at - c.last) / DAY : 0;
          out.push({ id, mode, card: c, r: retrievability(elapsed, c.s) });
        }
      }
    }
    /* Lowest retrievability first: those are the ones actually slipping. */
    out.sort((a, b) => a.r - b.r);
    return out;
  }

  /** Which extra card types this item has earned. */
  function unlocked(itemId, available) {
    const d = load();
    const rec = d.cards[itemId];
    if (!rec) return [];
    const base = rec.rec ? decode(rec.rec) : null;
    const open = [];
    for (const mode of available) {
      if (rec[mode]) { open.push(mode); continue; }
      if (mode === 'rec') { open.push(mode); continue; }
      /* Recognition has to be reasonably solid before production,
         pinyin, listening or handwriting are worth the reps. */
      if (base && base.state === REVIEW && base.s >= d.cfg.unlockAfter) open.push(mode);
    }
    return open;
  }

  /**
   * Assemble one study session.
   *
   * @param opts.pool       ordered candidate item ids for new material
   * @param opts.modesFor   fn(itemId) -> modes that item supports
   * @param opts.limit      hard cap on cards
   * @param opts.includeNew whether to introduce fresh items
   */
  function buildQueue(opts = {}) {
    const d = load();
    const at = opts.at || Date.now();
    const c = counts(at);
    const limit = opts.limit || Math.max(20, Math.min(d.cfg.maxReviews, 120));
    const modesFor = opts.modesFor || (() => ['rec']);

    const queue = dueList(at)
      .slice(0, Math.min(limit, c.reviewsLeft || limit))
      .map(x => ({ id: x.id, mode: x.mode, kind: 'review' }));

    /* Open up card types that existing items have grown into. One new
       direction per item per session — but stagger which one, so a session
       is a mix of writing, reading and listening rather than forty
       production cards in a row. Interleaved practice is harder in the
       moment and remembered better afterwards. */
    if (opts.includeNew !== false) {
      let n = 0;
      for (const id in d.cards) {
        if (queue.length >= limit) break;
        const missing = unlocked(id, modesFor(id)).filter(m => !d.cards[id][m]);
        if (!missing.length) continue;
        queue.push({ id, mode: missing[n++ % missing.length], kind: 'unlock' });
      }
    }

    /* Then genuinely new items, in the pool's order.

       The first card is whichever direction the item leads with, not 'rec'.
       For a word or a character that is recognition and always was. A grammar
       point has no recognition card — 把 is not a shape you read off a page
       and gloss — and hard-coding the mode here is what kept every one of
       them out of every queue no matter what the pool contained. */
    if (opts.includeNew !== false && Array.isArray(opts.pool)) {
      let room = Math.min(c.newLeft, limit - queue.length);
      for (const id of opts.pool) {
        if (room <= 0) break;
        if (d.cards[id]) continue;
        const first = modesFor(id)[0];
        if (!first) continue;
        queue.push({ id, mode: first, kind: 'new' });
        room--;
      }
    }

    return d.cfg.burySiblings ? spaceSiblings(queue) : shuffleWithin(queue);
  }

  /* Two cards for the same word next to each other means the first one
     answers the second. Push them apart. */
  function spaceSiblings(queue, gap = 10) {
    const out = [];
    const pending = queue.slice();
    const lastSeen = new Map();
    while (pending.length) {
      let picked = -1;
      for (let i = 0; i < pending.length; i++) {
        const seen = lastSeen.get(pending[i].id);
        if (seen === undefined || out.length - seen >= gap) { picked = i; break; }
      }
      if (picked === -1) picked = 0;      /* nothing far enough — take the front */
      const item = pending.splice(picked, 1)[0];
      lastSeen.set(item.id, out.length);
      out.push(item);
    }
    return out;
  }

  function shuffleWithin(queue) {
    for (let i = queue.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [queue[i], queue[j]] = [queue[j], queue[i]];
    }
    return queue;
  }

  /* ---------- reporting ---------- */

  /** Reviews falling due over the next `days` days, today first. */
  function forecast(days = 30, at = Date.now()) {
    const d = load();
    const out = new Array(days).fill(0);
    let backlog = 0;
    for (const id in d.cards) {
      for (const mode in d.cards[id]) {
        const c = decode(d.cards[id][mode]);
        if (c.state === NEW) continue;
        const bucket = Math.floor((c.due - at) / DAY);
        if (bucket < 0) backlog++;
        else if (bucket < days) out[bucket]++;
      }
    }
    return { buckets: out, backlog };
  }

  /**
   * True retention: of reviews that were genuinely a memory test, how many
   * held. Same-day repetitions are excluded — they measure short-term
   * memory, not the thing being scheduled.
   *
   * `minStability` filters to cards the model is actually in charge of.
   * Below about a week, the one-day minimum interval forces reviews later
   * than the algorithm would choose, so those cards always come in under
   * target. Anki has the same floor for the same reason. Passing 7 here
   * answers "is the scheduler calibrated"; passing 0 answers "what share
   * of everything I saw did I get right".
   */
  function retention(sinceDays = 90, opts = {}, at = Date.now()) {
    const { minStability = 0, mode = null } = opts;
    const d = load();
    const cut = (at - sinceDays * DAY) / 1000;
    let n = 0, ok = 0;
    for (const row of d.log) {
      if (row[0] < cut) continue;
      if (row[4] < 1) continue;            /* same-day reps are not a memory test */
      if (mode && row[2] !== mode) continue;
      if (minStability && !(row[6] >= minStability)) continue;
      n++;
      if (row[3] > AGAIN) ok++;
    }
    return { n, ok, rate: n ? ok / n : null };
  }

  /**
   * Predicted versus observed recall, bucketed by what the model expected.
   * A well-fitted scheduler sits on the diagonal. Persistent deviation is
   * the signal that the default weights do not describe this learner, and
   * that the desired-retention dial should move.
   */
  function calibration(sinceDays = 180, at = Date.now()) {
    const d = load();
    const cut = (at - sinceDays * DAY) / 1000;
    const buckets = [];
    for (let i = 0; i < 10; i++) buckets.push({ lo: i / 10, hi: (i + 1) / 10, n: 0, ok: 0, predicted: 0 });
    for (const row of d.log) {
      if (row[0] < cut || row[4] < 1 || !(row[6] > 0)) continue;
      const r = retrievability(row[4], row[6]);
      const b = buckets[Math.min(9, Math.floor(r * 10))];
      b.n++; b.predicted += r;
      if (row[3] > AGAIN) b.ok++;
    }
    for (const b of buckets) {
      b.actual = b.n ? b.ok / b.n : null;
      b.expected = b.n ? b.predicted / b.n : null;
    }
    return buckets.filter(b => b.n > 0);
  }

  /** Per-mode retention, so you can see which direction is lagging. */
  function retentionByMode(sinceDays = 90, at = Date.now()) {
    const d = load();
    const cut = (at - sinceDays * DAY) / 1000;
    const acc = {};
    for (const row of d.log) {
      if (row[0] < cut || row[4] < 1) continue;
      const m = acc[row[2]] || (acc[row[2]] = { n: 0, ok: 0 });
      m.n++;
      if (row[3] > AGAIN) m.ok++;
    }
    for (const k in acc) acc[k].rate = acc[k].n ? acc[k].ok / acc[k].n : null;
    return acc;
  }

  /** Items lapsing far more than their peers. */
  function leeches(n = 20) {
    const d = load();
    const out = [];
    for (const id in d.cards) {
      for (const mode in d.cards[id]) {
        const c = decode(d.cards[id][mode]);
        if (c.lapses >= 3) out.push({ id, mode, lapses: c.lapses, s: c.s, d: c.d });
      }
    }
    return out.sort((a, b) => b.lapses - a.lapses || a.s - b.s).slice(0, n);
  }

  /** Daily activity, for the heatmap and the streak. */
  function history() { return load().days; }

  function streak(at = Date.now()) {
    const d = load();
    let n = 0;
    for (let i = 0; ; i++) {
      const k = dayKey(at - i * DAY);
      const row = d.days[k];
      if (row && row[0] > 0) n++;
      else if (i > 0) break;              /* today may legitimately be empty */
      else if (i === 0) continue;
      if (i > 3650) break;
    }
    return n;
  }

  /** Tone mistakes, as expected→heard counts. Drives the tone drills. */
  function noteTone(expected, got) {
    if (!expected || !got || expected === got) return;
    const d = load();
    const k = `${expected}>${got}`;
    d.tones[k] = (d.tones[k] || 0) + 1;
    save();
  }
  function toneConfusion() { return load().tones; }

  /** Total knowledge, in items whose recognition card is mature. */
  function known(minStability = 21) {
    const d = load();
    let n = 0;
    for (const id in d.cards) {
      const rec = d.cards[id].rec;
      if (rec && decode(rec).s >= minStability) n++;
    }
    return n;
  }

  /* ---------- config, export, reset ---------- */

  function cfg() { return Object.assign({}, load().cfg); }
  function setCfg(patch) {
    const d = load();
    Object.assign(d.cfg, patch);
    save(true);
    return cfg();
  }

  function exportJSON() {
    flush();
    return JSON.stringify(Object.assign({}, load(), {
      exported: new Date().toISOString(),
      app: 'LearneCN'
    }));
  }

  function importJSON(text) {
    const parsed = JSON.parse(text);
    if (!parsed || parsed.v !== 3 || !parsed.cards) throw new Error('Not a LearneCN progress file.');
    db = {
      v: 3,
      cfg: Object.assign({}, DEFAULTS, parsed.cfg || {}),
      cards: parsed.cards || {},
      log: parsed.log || [],
      days: parsed.days || {},
      tones: parsed.tones || {},
      seen: parsed.seen || {}
    };
    save(true);
    return counts();
  }

  function reset() { db = blank(); save(true); }

  /** Forget one item entirely — every direction of it. */
  function forget(itemId) {
    const d = load();
    delete d.cards[itemId];
    delete d.seen[itemId];
    save(true);
  }

  const storageFailed = () => saveFailed;

  return {
    /* model */
    retrievability, intervalFor, apply, preview, MODES,
    NEW, LEARNING, REVIEW, RELEARNING, AGAIN, HARD, GOOD, EASY,
    /* cards */
    get, put, review, isIntroduced, unlocked, fresh,
    /* queue */
    buildQueue, dueList, counts,
    /* reporting */
    forecast, retention, retentionByMode, calibration, leeches, history, streak,
    noteTone, toneConfusion, known,
    /* admin */
    cfg, setCfg, exportJSON, importJSON, reset, forget, flush, storageFailed, setRandom,
    DEFAULTS, WEIGHTS: W
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = SRS;
