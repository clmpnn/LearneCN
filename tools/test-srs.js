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
/* Checks the scheduler against the properties FSRS is supposed to have.
   Run with: node tools/test-srs.js */

'use strict';

/* Minimal localStorage so the module can run outside a browser. */
const mem = new Map();
global.localStorage = {
  getItem: k => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: k => mem.delete(k)
};

const SRS = require('../js/srs.js');

let pass = 0, fail = 0;
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

function ok(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  ok    ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
}

const DAY = 864e5;
const T0 = Date.UTC(2026, 0, 1, 9, 0, 0);

console.log('\nForgetting curve');
{
  /* By construction, retrievability at t = S must be exactly 0.90.
     This is the definition stability is anchored to. */
  for (const s of [1, 3.5, 10, 60, 365]) {
    ok(`R(S=${s}) = 0.90`, near(SRS.retrievability(s, s), 0.9, 1e-9),
       String(SRS.retrievability(s, s)));
  }
  ok('R(0) = 1', near(SRS.retrievability(0, 10), 1));
  ok('R decays monotonically',
     SRS.retrievability(1, 10) > SRS.retrievability(5, 10) &&
     SRS.retrievability(5, 10) > SRS.retrievability(50, 10));
  ok('R stays in (0,1]',
     SRS.retrievability(1e5, 1) > 0 && SRS.retrievability(1e5, 1) < 1);
}

console.log('\nInterval inversion');
{
  for (const s of [1, 7, 90, 1000]) {
    ok(`interval(S=${s}, r=0.9) = S`, near(SRS.intervalFor(s, 0.9), s, 1e-9),
       String(SRS.intervalFor(s, 0.9)));
  }
  /* Lower desired retention must buy longer gaps. */
  ok('lower retention → longer interval',
     SRS.intervalFor(10, 0.80) > SRS.intervalFor(10, 0.90));
  ok('higher retention → shorter interval',
     SRS.intervalFor(10, 0.95) < SRS.intervalFor(10, 0.90));
  /* Round trip: the interval we schedule should land R at the target. */
  const i = SRS.intervalFor(30, 0.85);
  ok('round trip R(interval) = target', near(SRS.retrievability(i, 30), 0.85, 1e-9));
}

console.log('\nFirst review');
{
  const news = [1, 2, 3, 4].map(g => SRS.apply(SRS.fresh(), g, T0));
  ok('initial stability rises with rating',
     news[0].s < news[1].s && news[1].s < news[2].s && news[2].s < news[3].s,
     news.map(c => c.s.toFixed(2)).join(' < '));
  ok('initial difficulty falls as rating rises',
     news[0].d > news[1].d && news[1].d > news[2].d && news[2].d > news[3].d,
     news.map(c => c.d.toFixed(2)).join(' > '));
  ok('difficulty stays in 1..10', news.every(c => c.d >= 1 && c.d <= 10));
  ok('Again/Hard/Good enter learning, Easy graduates',
     news[0].state === SRS.LEARNING && news[1].state === SRS.LEARNING &&
     news[2].state === SRS.LEARNING && news[3].state === SRS.REVIEW);
  ok('learning steps are minutes, not days',
     news[0].due - T0 < DAY && news[2].due - T0 < DAY);
  ok('Easy graduates to at least a day', news[3].due - T0 >= DAY);
}

console.log('\nSpaced review');
{
  SRS.setCfg({ fuzz: false, retention: 0.9 });
  /* Take a card to REVIEW state, then review it on time. */
  let card = SRS.apply(SRS.fresh(), 4, T0);           /* Easy → REVIEW */
  const beforeS = card.s;
  const at = card.due;
  const grades = [1, 2, 3, 4].map(g => SRS.apply(card, g, at));

  ok('Again reduces stability', grades[0].s < beforeS,
     `${beforeS.toFixed(2)} → ${grades[0].s.toFixed(2)}`);
  ok('Again increments lapses', grades[0].lapses === 1);
  ok('Again enters relearning', grades[0].state === SRS.RELEARNING);
  ok('Hard/Good/Easy raise stability',
     grades[1].s > beforeS && grades[2].s > beforeS && grades[3].s > beforeS);
  ok('stability gain ordered Hard < Good < Easy',
     grades[1].s < grades[2].s && grades[2].s < grades[3].s,
     grades.slice(1).map(c => c.s.toFixed(1)).join(' < '));
  ok('intervals ordered Again < Hard < Good < Easy',
     grades[0].due < grades[1].due && grades[1].due < grades[2].due &&
     grades[2].due < grades[3].due);
  ok('Again raises difficulty, Easy lowers it',
     grades[0].d > card.d && grades[3].d < card.d);

  /* Reviewing late, when R has fallen further, should buy MORE stability
     than reviewing early. This is the spacing effect and it is the whole
     reason the algorithm tracks retrievability at all. */
  const early = SRS.apply(card, 3, card.last + 1 * DAY);
  const late  = SRS.apply(card, 3, card.last + card.s * DAY);
  ok('a harder (later) recall buys more stability', late.s > early.s,
     `early ${early.s.toFixed(2)} vs late ${late.s.toFixed(2)}`);
}

console.log('\nLapses never inflate stability');
{
  SRS.setCfg({ fuzz: false });
  let card = SRS.apply(SRS.fresh(), 4, T0);
  for (let i = 0; i < 6; i++) card = SRS.apply(card, 3, card.due);
  const strong = card.s;
  const lapsed = SRS.apply(card, 1, card.due);
  ok('post-lapse stability <= pre-lapse', lapsed.s <= strong,
     `${strong.toFixed(1)} → ${lapsed.s.toFixed(1)}`);
  ok('post-lapse stability stays positive', lapsed.s > 0);
}

console.log('\nGrowth over a good streak');
{
  SRS.setCfg({ fuzz: false, retention: 0.9, maxInterval: 3650 });
  let card = SRS.apply(SRS.fresh(), 3, T0);
  while (card.state !== SRS.REVIEW) card = SRS.apply(card, 3, card.due);
  const seq = [];
  for (let i = 0; i < 8; i++) {
    const prev = card.due;
    card = SRS.apply(card, 3, card.due);
    seq.push(Math.round((card.due - prev) / DAY));
  }
  ok('intervals grow monotonically', seq.every((v, i) => i === 0 || v >= seq[i - 1]),
     seq.join(', '));
  ok('reaches months within 8 reviews', seq[seq.length - 1] > 60, seq.join(', '));
  ok('never exceeds maxInterval', seq.every(v => v <= 3650));
  console.log(`        interval ladder (all Good): ${seq.join(' → ')} days`);
}

console.log('\nDesired retention changes workload');
{
  const ladder = r => {
    SRS.setCfg({ fuzz: false, retention: r });
    let c = SRS.apply(SRS.fresh(), 4, T0);
    let total = 0;
    for (let i = 0; i < 6; i++) { const p = c.due; c = SRS.apply(c, 3, c.due); total += (c.due - p) / DAY; }
    return total;
  };
  const r80 = ladder(0.80), r90 = ladder(0.90), r95 = ladder(0.95);
  ok('0.80 covers more calendar time than 0.90', r80 > r90, `${r80.toFixed(0)}d vs ${r90.toFixed(0)}d`);
  ok('0.95 covers less than 0.90', r95 < r90, `${r95.toFixed(0)}d vs ${r90.toFixed(0)}d`);
  console.log(`        6 reviews span: r=0.80 ${r80.toFixed(0)}d · r=0.90 ${r90.toFixed(0)}d · r=0.95 ${r95.toFixed(0)}d`);
}

console.log('\nPersistence and reporting');
{
  SRS.reset();
  SRS.setCfg({ fuzz: false, newPerDay: 5, maxReviews: 100 });
  SRS.review('w:爱', 'rec', 3, 1200, T0);
  SRS.review('w:你好', 'rec', 1, 4000, T0);
  SRS.review('w:谢谢', 'rec', 4, 900, T0);
  const c = SRS.counts(T0 + 60e3);
  ok('three items introduced', c.items === 3, String(c.items));
  ok('new-per-day budget consumed', c.newToday === 3, String(c.newToday));
  ok('two left in today\'s new budget', c.newLeft === 2, String(c.newLeft));
  ok('reviews counted', c.reviewsToday === 3, String(c.reviewsToday));

  const round = SRS.exportJSON();
  SRS.reset();
  ok('reset clears cards', SRS.counts().items === 0);
  SRS.importJSON(round);
  ok('import restores cards', SRS.counts(T0 + 60e3).items === 3);

  /* Retention only counts genuinely spaced reviews. */
  SRS.review('w:爱', 'rec', 3, 800, T0 + 10 * DAY);
  SRS.review('w:你好', 'rec', 1, 800, T0 + 10 * DAY);
  const ret = SRS.retention(90, {}, T0 + 10 * DAY);
  ok('retention ignores same-day reps', ret.n === 2, `n=${ret.n}`);
  ok('retention computed', near(ret.rate, 0.5), String(ret.rate));

  const f = SRS.forecast(30, T0 + 10 * DAY);
  ok('forecast has 30 buckets', f.buckets.length === 30);
  ok('forecast counts something', f.buckets.reduce((a, b) => a + b, 0) + f.backlog > 0);

  SRS.noteTone(3, 2); SRS.noteTone(3, 2); SRS.noteTone(1, 4);
  const tc = SRS.toneConfusion();
  ok('tone confusion tallied', tc['3>2'] === 2 && tc['1>4'] === 1, JSON.stringify(tc));
}

console.log('\nQueue assembly');
{
  SRS.reset();
  SRS.setCfg({ newPerDay: 10, maxReviews: 200, burySiblings: true });
  const pool = Array.from({ length: 40 }, (_, i) => `w:词${i}`);
  const q = SRS.buildQueue({ pool, modesFor: () => ['rec', 'prod'], at: T0 });
  ok('queue respects the new-per-day cap', q.length === 10, String(q.length));
  ok('every queued card is new', q.every(x => x.kind === 'new'));

  /* Introduce, mature, then confirm extra directions unlock. */
  SRS.reset();
  SRS.setCfg({ newPerDay: 50, unlockAfter: 5, fuzz: false });
  let card = SRS.apply(SRS.fresh(), 4, T0);
  SRS.put('w:测试', 'rec', card);
  const open = SRS.unlocked('w:测试', ['rec', 'prod', 'pin']);
  ok('extra directions unlock once recognition is stable',
     open.includes('prod') && open.includes('pin'), open.join(','));

  const weak = SRS.apply(SRS.fresh(), 1, T0);
  SRS.put('w:难', 'rec', weak);
  const closed = SRS.unlocked('w:难', ['rec', 'prod', 'pin']);
  ok('a shaky item does not unlock production', !closed.includes('prod'), closed.join(','));

  /* Sibling spacing: same item must not appear back to back. */
  SRS.reset();
  const many = [];
  for (let i = 0; i < 6; i++) {
    SRS.put(`w:s${i}`, 'rec', SRS.apply(SRS.fresh(), 4, T0 - 40 * DAY));
    SRS.put(`w:s${i}`, 'prod', SRS.apply(SRS.fresh(), 4, T0 - 40 * DAY));
    many.push(`w:s${i}`);
  }
  const q2 = SRS.buildQueue({ pool: [], modesFor: () => ['rec', 'prod'], at: T0 });
  let adjacent = 0;
  for (let i = 1; i < q2.length; i++) if (q2[i].id === q2[i - 1].id) adjacent++;
  ok('siblings never sit next to each other', adjacent === 0,
     `${adjacent} adjacent pairs in ${q2.length} cards`);
}

console.log('\nA simulated learner');
{
  /* Ten weeks of honest study: 12 new words a day, reviewing everything that
     comes due. The simulated learner recalls each card with exactly the
     probability the model predicts, which turns this into a calibration
     test — if the scheduler is sound, measured retention lands on the target
     it was asked for.

     Two independent seeded streams: one for the learner's recall, one for
     the scheduler's interval fuzz. Sharing a stream would correlate "how far
     the interval was nudged" with "was it recalled", which is exactly the
     relationship being measured.

     Mature retention is the number that should hit the target. It covers the
     cards the model is actually in charge of; cards whose ideal interval is
     under a day have to wait a full day regardless, so an overall figure
     always reads a little low. */
  const stream = seed => {
    let s = seed;
    return () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  };

  function run({ target, fuzz, days = 70, newPerDay = 12, seed = 987654321 }) {
    const learner = stream(seed);
    SRS.setRandom(stream(seed ^ 0x5f3759df));
    SRS.reset();
    SRS.setCfg({ newPerDay, maxReviews: 500, retention: target, fuzz });
    const pool = Array.from({ length: 2000 }, (_, i) => `w:x${i}`);
    let reviews = 0;
    const loads = [];
    for (let day = 0; day < days; day++) {
      const at = T0 + day * DAY;
      const q = SRS.buildQueue({ pool, modesFor: () => ['rec'], at });
      loads.push(q.length);
      for (const c of q) {
        const card = SRS.get(c.id, c.mode);
        const p = (!card || card.state === SRS.NEW)
          ? 0.70
          : SRS.retrievability((at - card.last) / DAY, card.s);
        SRS.review(c.id, c.mode, learner() < p ? (learner() < 0.2 ? 4 : 3) : 1, 3000, at);
        reviews++;
      }
    }
    const end = T0 + days * DAY;
    const counts = SRS.counts(end);
    return {
      reviews, counts,
      mature: SRS.retention(90, { minStability: 7 }, end).rate,
      all: SRS.retention(90, {}, end).rate,
      lastWeek: loads.slice(-7).reduce((a, b) => a + b, 0) / 7,
      perItem: reviews / counts.items
    };
  }

  console.log('  without interval fuzz — the algorithm on its own');
  const clean = {};
  for (const target of [0.85, 0.90, 0.95]) {
    const r = clean[target] = run({ target, fuzz: false });
    console.log(`        target ${target.toFixed(2)} → mature ${(r.mature * 100).toFixed(1)}%` +
      ` · overall ${(r.all * 100).toFixed(1)}%` +
      ` · ${r.counts.items} items · ${r.perItem.toFixed(2)} reviews each` +
      ` · ${r.lastWeek.toFixed(0)}/day at week 10`);
    ok(`mature retention hits the ${target} target within 2 points`,
       Math.abs(r.mature - target) < 0.02, `measured ${(r.mature * 100).toFixed(1)}%`);
  }
  ok('measured retention rises with the target',
     clean[0.85].mature < clean[0.9].mature && clean[0.9].mature < clean[0.95].mature,
     [0.85, 0.9, 0.95].map(t => (clean[t].mature * 100).toFixed(1)).join(' < '));
  ok('chasing higher retention costs more reviews per item',
     clean[0.85].perItem < clean[0.95].perItem,
     `${clean[0.85].perItem.toFixed(2)} at 0.85 vs ${clean[0.95].perItem.toFixed(2)} at 0.95`);

  console.log('  with interval fuzz — what a learner actually gets');
  const fuzzed = run({ target: 0.90, fuzz: true });
  console.log(`        target 0.90 → mature ${(fuzzed.mature * 100).toFixed(1)}%` +
    ` · ${fuzzed.counts.items} items · ${fuzzed.lastWeek.toFixed(0)}/day at week 10`);
  /* Fuzz spreads due dates so one heavy intake day does not come back as a
     wall a month later. It costs a little retention, because recall
     probability falls faster than it rises as the interval moves, so a
     symmetric nudge is not a symmetric outcome. A couple of points is the
     expected price; more than that would mean the spread is too wide. */
  ok('fuzz costs less than 3 points of retention',
     fuzzed.mature > 0.90 - 0.03 && fuzzed.mature < 0.90 + 0.02,
     `${(fuzzed.mature * 100).toFixed(1)}% against a clean ${(clean[0.9].mature * 100).toFixed(1)}%`);
  ok('load stays bounded rather than compounding', fuzzed.lastWeek < 250,
     `${fuzzed.lastWeek.toFixed(0)} cards/day at week 10`);
  ok('the whole run stays efficient', fuzzed.perItem < 6,
     `${fuzzed.perItem.toFixed(2)} reviews per item learned`);

  /* The calibration report should sit near the diagonal. */
  const cal = SRS.calibration(180, T0 + 70 * DAY);
  const heavy = cal.filter(b => b.n >= 40);
  console.log('        calibration  predicted → observed:');
  let offBy = 0;
  for (const b of heavy) {
    const se = Math.sqrt(Math.max(b.expected * (1 - b.expected), 1e-6) / b.n);
    const z = Math.abs(b.actual - b.expected) / se;
    if (z > 3) offBy++;
    console.log(`          ${(b.expected * 100).toFixed(0)}% → ${(b.actual * 100).toFixed(0)}%` +
      `  (n=${b.n}, ${z.toFixed(1)}σ)`);
  }
  ok('every calibration bucket sits within 3σ of prediction', offBy === 0,
     `${offBy} of ${heavy.length} buckets off`);

  SRS.setRandom(null);   /* hand the scheduler back to Math.random */
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
