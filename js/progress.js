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
/* LearneCN — the progress dashboard.

   Every chart here is inline SVG built from the review log. There is no
   plotting library, and there is no telemetry: the numbers come out of
   localStorage and go nowhere.

   Colour follows one rule throughout. Nothing on this page encodes identity,
   so nothing uses a categorical palette — every mark is a magnitude, drawn
   from a single validated cinnabar ramp that runs light-to-dark on paper and
   dark-to-light in the dark theme. */

(() => {
  const { $, $$, el, data, store, isHan, ID, byWord } = CN;

  const DAY = 864e5;
  const RAMP = n => `var(--ramp-${n})`;
  const fmt = n => n.toLocaleString();

  /* ---------- tooltip ---------- */

  const tip = $('#tip');
  function bindTip(node, html) {
    const show = e => {
      tip.innerHTML = html;
      tip.hidden = false;
      const r = tip.getBoundingClientRect();
      const x = Math.min(Math.max(e.clientX + 12, 8), innerWidth - r.width - 8);
      const y = Math.max(e.clientY - r.height - 12, 8);
      tip.style.transform = `translate(${x}px, ${y}px)`;
    };
    node.addEventListener('pointerenter', show);
    node.addEventListener('pointermove', show);
    node.addEventListener('pointerleave', () => { tip.hidden = true; });
    node.addEventListener('focus', e => {
      const b = node.getBoundingClientRect();
      show({ clientX: b.left + b.width / 2, clientY: b.top });
    });
    node.addEventListener('blur', () => { tip.hidden = true; });
  }

  const svgEl = (tag, attrs = {}, ...kids) => {
    const n = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v === null || v === undefined || v === false) continue;
      n.setAttribute(k, v === true ? '' : String(v));
    }
    kids.flat().forEach(k => k && n.append(k.nodeType ? k : document.createTextNode(String(k))));
    return n;
  };

  /** A collapsed table under every chart, so the data is never colour-only. */
  function tableFor(caption, headers, rows) {
    const t = el('table', { class: 'chart-table' },
      el('thead', {}, el('tr', {}, ...headers.map(h => el('th', {}, h)))),
      el('tbody', {}, ...rows.map(r => el('tr', {}, ...r.map(c => el('td', {}, String(c)))))));
    return el('details', { class: 'table-view' },
      el('summary', {}, caption), t);
  }

  /* ---------- headline numbers ---------- */

  function kpis() {
    const c = SRS.counts();
    const ret = SRS.retention(90, { minStability: 7 });
    const overall = SRS.retention(90);
    const f = SRS.forecast(2);
    const host = $('#kpis');
    host.innerHTML = '';

    const tiles = [
      { v: fmt(SRS.known(21)), label: 'Words holding',
        sub: 'recognition stable past three weeks' },
      { v: ret.rate === null ? '—' : Math.round(ret.rate * 100) + '%', label: 'Retention',
        sub: ret.n ? `over ${fmt(ret.n)} settled reviews` : 'not enough reviews yet' },
      { v: fmt(SRS.streak()), label: 'Day streak', sub: 'consecutive days studied' },
      { v: fmt(c.due + (f.buckets[0] || 0)), label: 'Due today', sub: `${fmt(f.buckets[1] || 0)} more tomorrow` }
    ];
    for (const t of tiles) {
      host.append(el('div', { class: 'kpi' },
        el('b', {}, t.v),
        el('span', { class: 'kpi-label' }, t.label),
        el('span', { class: 'kpi-sub' }, t.sub)));
    }

    const note = $('#kpiNote');
    const target = SRS.cfg().retention;
    if (ret.rate === null || ret.n < 30) {
      note.textContent = 'Retention needs about thirty settled reviews before it means anything.';
    } else if (ret.rate < target - 0.06) {
      note.textContent = `You are recalling ${Math.round(ret.rate * 100)}% where the schedule aims for ` +
        `${Math.round(target * 100)}%. Intervals are running long for you — raise the target retention on the Study page.`;
    } else if (ret.rate > target + 0.06) {
      note.textContent = `You are recalling ${Math.round(ret.rate * 100)}% against a ${Math.round(target * 100)}% target. ` +
        'You could safely lower the target and do fewer reviews for the same knowledge.';
    } else {
      note.textContent = `Measured recall is tracking the ${Math.round(target * 100)}% target. The timetable is honest.`;
    }
    if (overall.n && Math.abs(overall.rate - ret.rate) > 0.04) {
      note.textContent += ` Counting every review including the short ones, it is ${Math.round(overall.rate * 100)}%.`;
    }
  }

  /* ---------- forecast ---------- */

  function forecast() {
    const days = 30;
    const { buckets, backlog } = SRS.forecast(days);
    const host = $('#forecast');
    host.innerHTML = '';
    /* A nice round ceiling: with three reviews due, an axis labelled
       0 / 2 / 3 reads as noise. Round up to something a person would draw. */
    const raw = Math.max(1, ...buckets);
    const step = Math.pow(10, Math.floor(Math.log10(raw)));
    const max = Math.max(4, Math.ceil(raw / step) * step);

    const W = 760, H = 200, padL = 34, padB = 26, padT = 10;
    const plotW = W - padL - 8, plotH = H - padB - padT;
    const bw = plotW / days;
    const svg = svgEl('svg', {
      viewBox: `0 0 ${W} ${H}`, class: 'plot', role: 'img',
      'aria-label': `Reviews due over the next ${days} days`
    });

    const seenLabel = new Set();
    for (const frac of [0, 0.5, 1]) {
      const y = padT + plotH - frac * plotH;
      const label = Math.round(max * frac);
      svg.append(svgEl('line', { x1: padL, x2: W - 8, y1: y, y2: y, class: 'grid' }));
      if (!seenLabel.has(label)) {
        seenLabel.add(label);
        svg.append(svgEl('text', { x: padL - 7, y: y + 3.5, class: 'axis end' }, label));
      }
    }

    buckets.forEach((n, i) => {
      const h = n / max * plotH;
      const x = padL + i * bw;
      /* 2px of surface between neighbouring fills keeps the columns countable */
      const rect = svgEl('rect', {
        x: x + 1, y: padT + plotH - h, width: Math.max(1, bw - 2), height: Math.max(n ? 2 : 0, h),
        rx: Math.min(4, bw / 2 - 1), fill: RAMP(n === 0 ? 1 : n >= max * 0.66 ? 5 : n >= max * 0.33 ? 4 : 3),
        class: 'bar', tabindex: 0, role: 'listitem',
        'aria-label': `${dayLabel(i)}: ${n} reviews`
      });
      bindTip(rect, `<b>${dayLabel(i)}</b><br>${fmt(n)} review${n === 1 ? '' : 's'} due`);
      svg.append(rect);
    });

    for (let i = 0; i < days; i += 7) {
      svg.append(svgEl('text', { x: padL + i * bw + bw / 2, y: H - 8, class: 'axis mid' },
        i === 0 ? 'today' : '+' + i + 'd'));
    }
    host.append(svg);

    const total = buckets.reduce((a, b) => a + b, 0);
    const busiest = buckets.indexOf(Math.max(...buckets));
    host.append(el('figcaption', {},
      backlog
        ? `${fmt(backlog)} already overdue. `
        : '',
      total
        ? `${fmt(total)} reviews across the month, heaviest ${busiest === 0 ? 'today' : 'in ' + busiest + ' days'} at ${fmt(buckets[busiest])}.`
        : 'Nothing scheduled yet.'));
    host.append(tableFor('Forecast as a table', ['Day', 'Reviews due'],
      buckets.map((n, i) => [dayLabel(i), n])));
  }

  const dayLabel = i => {
    const d = new Date(Date.now() + i * DAY);
    return i === 0 ? 'Today' : d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
  };

  /* ---------- activity heatmap ---------- */

  function heatmap() {
    const history = SRS.history();
    const host = $('#heatmap');
    host.innerHTML = '';

    const weeks = 26;
    const today = new Date();
    today.setHours(12, 0, 0, 0);
    const end = new Date(today);
    end.setDate(end.getDate() + (6 - end.getDay()));      /* run to the end of this week */
    const start = new Date(end);
    start.setDate(start.getDate() - weeks * 7 + 1);

    const counts = [];
    let peak = 0;
    for (let i = 0; i < weeks * 7; i++) {
      const d = new Date(start);
      d.setDate(d.getDate() + i);
      const key = d.toISOString().slice(0, 10);
      const n = (history[key] || [0])[0];
      counts.push({ key, n, date: d, future: d > today });
      if (n > peak) peak = n;
    }

    const cell = 13, gap = 3, left = 26, top = 16;
    const W = left + weeks * (cell + gap), H = top + 7 * (cell + gap) + 6;
    const svg = svgEl('svg', {
      viewBox: `0 0 ${W} ${H}`, class: 'plot heat', role: 'img',
      'aria-label': 'Reviews per day over the last six months'
    });

    ['M', 'W', 'F'].forEach((label, i) => {
      svg.append(svgEl('text', { x: left - 7, y: top + (i * 2 + 1) * (cell + gap) + cell - 3, class: 'axis end' }, label));
    });

    let lastMonth = -1;
    counts.forEach((c, i) => {
      const w = Math.floor(i / 7), dow = i % 7;
      const x = left + w * (cell + gap), y = top + dow * (cell + gap);
      const level = c.n === 0 ? 0 : c.n >= peak * 0.75 ? 5 : c.n >= peak * 0.5 ? 4 : c.n >= peak * 0.25 ? 3 : 2;
      const rect = svgEl('rect', {
        x, y, width: cell, height: cell, rx: 2.5,
        fill: level === 0 ? 'var(--rule-soft)' : RAMP(level),
        opacity: c.future ? 0.35 : 1,
        class: 'heat-cell', tabindex: c.n ? 0 : null,
        'aria-label': c.n ? `${c.key}: ${c.n} reviews` : null
      });
      if (!c.future) {
        bindTip(rect, `<b>${c.date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}</b><br>` +
          (c.n ? `${fmt(c.n)} review${c.n === 1 ? '' : 's'}` : 'nothing studied'));
      }
      svg.append(rect);
      if (dow === 0) {
        const m = c.date.getMonth();
        if (m !== lastMonth) {
          lastMonth = m;
          svg.append(svgEl('text', { x, y: top - 5, class: 'axis' },
            c.date.toLocaleDateString(undefined, { month: 'short' })));
        }
      }
    });
    host.append(svg);

    const studied = counts.filter(c => !c.future && c.n > 0).length;
    const totalRev = counts.reduce((a, c) => a + c.n, 0);
    host.append(el('figcaption', {},
      studied
        ? `${fmt(totalRev)} reviews on ${studied} day${studied === 1 ? '' : 's'} in the last six months. Best day: ${fmt(peak)}.`
        : 'No study days recorded yet.'));
  }

  /* ---------- retention by direction ---------- */

  function retentionByMode() {
    const byMode = SRS.retentionByMode(120);
    const host = $('#retention');
    host.innerHTML = '';
    const rows = Object.entries(byMode)
      .filter(([, v]) => v.n >= 5)
      .sort((a, b) => b[1].rate - a[1].rate);

    if (!rows.length) {
      $('#retentionPanel').hidden = true;
      return;
    }
    $('#retentionPanel').hidden = false;

    const W = 760, rowH = 40, padL = 132, padR = 56;
    const H = rows.length * rowH + 22;
    const plotW = W - padL - padR;
    const svg = svgEl('svg', {
      viewBox: `0 0 ${W} ${H}`, class: 'plot', role: 'img',
      'aria-label': 'First-try recall by card direction'
    });

    const target = SRS.cfg().retention;
    const tx = padL + target * plotW;
    svg.append(svgEl('line', { x1: tx, x2: tx, y1: 4, y2: H - 16, class: 'ref' }));
    svg.append(svgEl('text', { x: tx, y: H - 4, class: 'axis mid' }, `target ${Math.round(target * 100)}%`));

    rows.forEach(([mode, v], i) => {
      const y = i * rowH + 6;
      const w = Math.max(2, v.rate * plotW);
      const info = SRS.MODES[mode] || { label: mode, cn: '' };
      svg.append(svgEl('text', { x: padL - 12, y: y + 20, class: 'axis end strong' },
        `${info.cn} ${info.label}`));
      const bar = svgEl('rect', {
        x: padL, y: y + 6, width: w, height: 20, rx: 4,
        fill: RAMP(v.rate >= 0.9 ? 5 : v.rate >= 0.8 ? 4 : v.rate >= 0.7 ? 3 : 2),
        class: 'bar', tabindex: 0,
        'aria-label': `${info.label}: ${Math.round(v.rate * 100)} percent of ${v.n} reviews`
      });
      bindTip(bar, `<b>${info.label}</b><br>${Math.round(v.rate * 100)}% first try<br>${fmt(v.n)} reviews`);
      svg.append(bar);
      svg.append(svgEl('text', { x: padL + w + 9, y: y + 21, class: 'axis value' },
        Math.round(v.rate * 100) + '%'));
    });
    host.append(svg);

    const weakest = rows[rows.length - 1];
    const strongest = rows[0];
    if (rows.length > 1) {
      const gap = Math.round((strongest[1].rate - weakest[1].rate) * 100);
      host.append(el('figcaption', {},
        `${(SRS.MODES[weakest[0]] || {}).label || weakest[0]} is ${gap} point${gap === 1 ? '' : 's'} behind ` +
        `${(SRS.MODES[strongest[0]] || {}).label || strongest[0]}.` +
        (gap > 25 ? ' A gap that size usually means the harder direction was unlocked too early.' : '')));
    }
    host.append(tableFor('Recall by direction as a table', ['Direction', 'First-try recall', 'Reviews'],
      rows.map(([m, v]) => [(SRS.MODES[m] || {}).label || m, Math.round(v.rate * 100) + '%', v.n])));
  }

  /* ---------- calibration ---------- */

  function calibration() {
    const buckets = SRS.calibration(365).filter(b => b.n >= 8);
    const host = $('#calibration');
    if (buckets.length < 3) { $('#calibrationPanel').hidden = true; return; }
    $('#calibrationPanel').hidden = false;
    host.innerHTML = '';

    const W = 372, H = 342, pad = 44;
    const plot = Math.min(W, H) - pad - 14;
    const x0 = pad, y0 = H - pad;
    const sx = p => x0 + p * plot;
    const sy = p => y0 - p * plot;

    const svg = svgEl('svg', {
      viewBox: `0 0 ${W} ${H}`, class: 'plot square', role: 'img',
      'aria-label': 'Predicted recall against observed recall'
    });

    for (let i = 0; i <= 4; i++) {
      const p = i / 4;
      svg.append(svgEl('line', { x1: x0, x2: x0 + plot, y1: sy(p), y2: sy(p), class: 'grid' }));
      svg.append(svgEl('text', { x: x0 - 8, y: sy(p) + 4, class: 'axis end' }, Math.round(p * 100) + '%'));
      svg.append(svgEl('text', { x: sx(p), y: y0 + 18, class: 'axis mid' }, Math.round(p * 100) + '%'));
    }
    /* the diagonal is the claim being tested, so it is drawn as a reference,
       not as a series */
    svg.append(svgEl('line', { x1: sx(0), y1: sy(0), x2: sx(1), y2: sy(1), class: 'ref diag' }));
    /* Sit the label on the low end of the diagonal, rotated to follow it.
       Buckets almost never appear down there, so it cannot collide with a
       dot the way a mid-line label does. */
    svg.append(svgEl('text', {
      x: sx(0.17), y: sy(0.17) - 9, class: 'axis diag-label',
      transform: `rotate(-45 ${sx(0.17)} ${sy(0.17) - 9})`
    }, 'perfectly calibrated'));

    const pts = buckets.map(b => [sx(b.expected), sy(b.actual)]);
    svg.append(svgEl('polyline', {
      points: pts.map(p => p.join(',')).join(' '),
      class: 'series-line'
    }));
    buckets.forEach((b, i) => {
      const r = Math.max(4.5, Math.min(11, Math.sqrt(b.n) * 0.9));
      const dot = svgEl('circle', {
        cx: pts[i][0], cy: pts[i][1], r,
        fill: RAMP(4), class: 'dot', tabindex: 0,
        'aria-label': `predicted ${Math.round(b.expected * 100)} percent, observed ${Math.round(b.actual * 100)} percent, ${b.n} reviews`
      });
      bindTip(dot, `<b>${fmt(b.n)} reviews</b><br>predicted ${Math.round(b.expected * 100)}%<br>observed ${Math.round(b.actual * 100)}%`);
      svg.append(dot);
    });

    svg.append(svgEl('text', { x: x0 + plot / 2, y: H - 6, class: 'axis mid label' }, 'predicted recall'));
    host.append(svg);

    const drift = buckets.reduce((a, b) => a + (b.actual - b.expected) * b.n, 0) /
                  buckets.reduce((a, b) => a + b.n, 0);
    host.append(el('figcaption', {}, Math.abs(drift) < 0.03
      ? 'The scheduler is predicting your recall to within three points. Nothing to change.'
      : drift < 0
        ? `You are recalling about ${Math.round(-drift * 100)} points worse than predicted. Raise the target retention.`
        : `You are recalling about ${Math.round(drift * 100)} points better than predicted. You could lower the target and review less.`));
    host.append(tableFor('Calibration as a table', ['Predicted', 'Observed', 'Reviews'],
      buckets.map(b => [Math.round(b.expected * 100) + '%', Math.round(b.actual * 100) + '%', b.n])));
  }

  /* ---------- HSK coverage ---------- */

  async function coverage() {
    let hsk;
    try { hsk = await data('hsk'); } catch { $('#coveragePanel').hidden = true; return; }
    /* The grammar syllabus is worth a line of its own. A learner holding
       every HSK 4 word and none of its patterns has half the level. */
    const points = await data('learn/grammar').then(g => g.points || []).catch(() => []);
    /* One row per word, at the earliest level that claims it — counting the
       rows instead of the words would put each of hsk.json's six repeated
       headwords into two denominators at once. */
    const totals = {}, known = {};
    for (const [word, row] of byWord(hsk)) {
      totals[row.lv] = (totals[row.lv] || 0) + 1;
      const card = SRS.get(ID.word(word), 'rec');
      if (card && card.s >= 21) known[row.lv] = (known[row.lv] || 0) + 1;
    }
    const host = $('#coverage');
    host.innerHTML = '';
    const rows = [];
    for (let lv = 1; lv <= 6; lv++) {
      const total = totals[lv] || 0, have = known[lv] || 0;
      if (!total) continue;
      const pct = have / total;
      rows.push([`HSK ${lv}`, have, total, Math.round(pct * 100) + '%']);
      const meter = el('div', { class: 'meter-row' },
        el('span', { class: 'meter-label' }, 'HSK ' + lv),
        el('div', { class: 'meter' },
          el('span', {
            class: 'meter-fill',
            style: `width:${(pct * 100).toFixed(1)}%;background:${RAMP(pct >= 0.75 ? 5 : pct >= 0.4 ? 4 : 3)}`
          })),
        el('span', { class: 'meter-value' }, `${fmt(have)} / ${fmt(total)}`));
      bindTip(meter, `<b>HSK ${lv}</b><br>${fmt(have)} of ${fmt(total)} words holding<br>${Math.round(pct * 100)}%`);
      host.append(meter);
    }
    let gramHave = 0;
    if (points.length) {
      for (const p of points) {
        const card = SRS.get(ID.gram(p.id), 'gram');
        if (card && card.s >= 21) gramHave++;
      }
      const pct = gramHave / points.length;
      rows.push(['语法 Grammar', gramHave, points.length, Math.round(pct * 100) + '%']);
      const meter = el('div', { class: 'meter-row grammar-row' },
        el('span', { class: 'meter-label' }, '语法'),
        el('div', { class: 'meter' },
          el('span', {
            class: 'meter-fill',
            style: `width:${(pct * 100).toFixed(1)}%;background:${RAMP(pct >= 0.75 ? 5 : pct >= 0.4 ? 4 : 3)}`
          })),
        el('span', { class: 'meter-value' }, `${fmt(gramHave)} / ${fmt(points.length)}`));
      bindTip(meter, `<b>Grammar</b><br>${fmt(gramHave)} of ${fmt(points.length)} points holding<br>${Math.round(pct * 100)}%`);
      host.append(meter);
    }

    const totalKnown = Object.values(known).reduce((a, b) => a + b, 0);
    const totalAll = Object.values(totals).reduce((a, b) => a + b, 0);
    host.append(el('figcaption', {},
      `${fmt(totalKnown)} of ${fmt(totalAll)} HSK words are holding — ${Math.round(totalKnown / totalAll * 100)}% of the syllabus`
      + (points.length ? `, and ${fmt(gramHave)} of ${fmt(points.length)} grammar points.` : '.')));
    host.append(tableFor('Coverage as a table', ['Level', 'Holding', 'Total', 'Share'], rows));
  }

  /* ---------- tone confusion ---------- */

  function tones() {
    const conf = SRS.toneConfusion();
    const keys = Object.keys(conf);
    if (!keys.length) return;
    $('#tonePanel').hidden = false;
    const host = $('#tones');
    host.innerHTML = '';

    const grid = {}, peak = Math.max(...Object.values(conf));
    for (const k of keys) {
      const [want, got] = k.split('>').map(Number);
      grid[`${want},${got}`] = conf[k];
    }

    const cell = 54, left = 68, top = 34;
    const W = left + 4 * cell + 10, H = top + 4 * cell + 22;
    const svg = svgEl('svg', {
      viewBox: `0 0 ${W} ${H}`, class: 'plot matrix', role: 'img',
      'aria-label': 'Tone confusion matrix'
    });
    svg.append(svgEl('text', { x: left + 2 * cell, y: 12, class: 'axis mid label' }, 'you said'));
    for (let t = 1; t <= 4; t++) {
      svg.append(svgEl('text', { x: left + (t - 1) * cell + cell / 2, y: top - 8, class: 'axis mid' }, 'tone ' + t));
      svg.append(svgEl('text', { x: left - 8, y: top + (t - 1) * cell + cell / 2 + 4, class: 'axis end' }, 'tone ' + t));
    }
    for (let want = 1; want <= 4; want++) {
      for (let got = 1; got <= 4; got++) {
        const n = grid[`${want},${got}`] || 0;
        const same = want === got;
        const level = n === 0 ? 0 : n >= peak * 0.66 ? 5 : n >= peak * 0.33 ? 4 : 3;
        const r = svgEl('rect', {
          x: left + (got - 1) * cell + 1, y: top + (want - 1) * cell + 1,
          width: cell - 2, height: cell - 2, rx: 3,
          fill: n === 0 ? 'var(--rule-soft)' : RAMP(level),
          class: 'heat-cell' + (same ? ' diagonal' : ''),
          tabindex: n ? 0 : null,
          'aria-label': n ? `correct tone ${want}, answered tone ${got}, ${n} times` : null
        });
        if (n) bindTip(r, `<b>${n} time${n === 1 ? '' : 's'}</b><br>it was tone ${want}, you said tone ${got}`);
        svg.append(r);
        if (n) {
          svg.append(svgEl('text', {
            x: left + (got - 1) * cell + cell / 2,
            y: top + (want - 1) * cell + cell / 2 + 4,
            class: 'cell-value' + (level >= 4 ? ' on-dark' : '')
          }, n));
        }
      }
    }
    svg.append(svgEl('text', { x: 11, y: top + 2 * cell, class: 'axis mid label',
      transform: `rotate(-90 11 ${top + 2 * cell})` }, 'it was'));
    host.append(svg);

    const worst = keys.map(k => [k, conf[k]]).sort((a, b) => b[1] - a[1])[0];
    const [w, g] = worst[0].split('>');
    host.append(el('figcaption', {},
      `Most common slip: hearing tone ${w} as tone ${g}, ${worst[1]} time${worst[1] === 1 ? '' : 's'}.`));
  }

  /* ---------- leeches ---------- */

  async function leeches() {
    const list = SRS.leeches(12);
    if (!list.length) return;
    let hsk = [], hanzi = [];
    try { [hsk, hanzi] = await Promise.all([data('hsk'), data('hanzi')]); } catch { /* labels only */ }
    const words = new Map(hsk.map(w => [w.s, w]));
    const chars = new Map(hanzi.map(h => [h.c, h]));

    $('#leechPanel').hidden = false;
    const host = $('#leeches');
    host.innerHTML = '';
    const table = el('table', { class: 'leech-table' },
      el('thead', {}, el('tr', {},
        el('th', {}, 'Item'), el('th', {}, 'Meaning'),
        el('th', {}, 'Asked for'), el('th', {}, 'Forgotten'))),
      el('tbody', {}));
    const body = table.querySelector('tbody');

    for (const l of list) {
      const key = ID.key(l.id);
      const kind = ID.kind(l.id);
      const row = kind === 'w' ? words.get(key) : chars.get(key);
      const pinyin = row ? (kind === 'w' ? row.p : (row.p || [])[0]) : '';
      const gloss = row ? (kind === 'w' ? row.e : (row.d || '').split(';')[0]) : '';
      body.append(el('tr', {},
        el('td', {},
          el('span', { class: 'leech-hanzi', lang: 'zh' }, kind === 't' ? key : key),
          pinyin ? el('span', { class: 'leech-pinyin' }, pinyin) : null),
        el('td', {}, gloss || (kind === 't' ? 'tone contrast' : '')),
        el('td', {}, (SRS.MODES[l.mode] || {}).label || l.mode),
        el('td', { class: 'num' }, `${l.lapses}×`)));
    }
    host.append(table);
  }

  /* ---------- data management ---------- */

  function dataTools() {
    $('#export').addEventListener('click', () => {
      const blob = new Blob([SRS.exportJSON()], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = el('a', { href: url, download: `learnecn-progress-${new Date().toISOString().slice(0, 10)}.json` });
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      $('#dataNote').textContent = 'Exported. Keep it somewhere you will find it again.';
    });

    $('#importBtn').addEventListener('click', () => $('#importFile').click());
    $('#importFile').addEventListener('change', async e => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      try {
        const counts = SRS.importJSON(await file.text());
        $('#dataNote').textContent = `Imported ${fmt(counts.items)} items. Reloading…`;
        setTimeout(() => location.reload(), 700);
      } catch (err) {
        $('#dataNote').textContent = 'That file could not be read as LearneCN progress.';
      }
      e.target.value = '';
    });

    const reset = $('#reset');
    let armed = false;
    reset.addEventListener('click', () => {
      if (!armed) {
        armed = true;
        reset.textContent = 'Really erase everything?';
        $('#dataNote').textContent = 'This cannot be undone. Export first if you want it back.';
        setTimeout(() => {
          armed = false;
          reset.textContent = 'Reset everything';
        }, 6000);
        return;
      }
      SRS.reset();
      location.reload();
    });

    if (SRS.storageFailed()) {
      $('#dataNote').textContent =
        'This browser is refusing to save progress. Nothing studied in this session will survive a reload.';
    }

    offlineTools();
  }

  /* ---------- what is held for offline use ---------- */

  const mb = bytes => bytes < 1048576
    ? `${Math.round(bytes / 1024)} KB`
    : `${(bytes / 1048576).toFixed(1)} MB`;

  async function offlineTools() {
    if (typeof PWA === 'undefined') return;
    const panel = $('#offlinePanel');
    const report = await PWA.usage();
    if (!report) return;                      /* no worker running yet */
    panel.hidden = false;

    const counts = report.counts || {};
    const study = counts['learnecn-study'] || 0;
    const strokes = counts['learnecn-strokes'] || 0;
    const shell = counts['learnecn-shell-v1'] || 0;

    const parts = [];
    if (shell) parts.push('the app itself');
    if (study) parts.push(`${study} word list${study === 1 ? '' : 's'} and question file${study === 1 ? '' : 's'}`);
    if (strokes) parts.push(`stroke data for ${strokes} character${strokes === 1 ? '' : 's'}`);

    $('#offlineSummary').textContent = parts.length
      ? `Saved for use without a connection: ${parts.join(', ')}` +
        (report.bytes ? ` — about ${mb(report.bytes)} in total.` : '.') +
        ' Anything you have not opened yet still needs a connection the first time.'
      : 'Nothing saved for offline use yet. Material is kept as you study it.';

    const note = $('#offlineNote');
    if (PWA.standalone()) {
      note.textContent = 'Running from your home screen, which is where this browser is ' +
        'most willing to hold on to your progress.';
    } else if (PWA.isIOSSafari()) {
      note.textContent = 'Adding LearneCN to your home screen — Share, then Add to Home Screen — ' +
        'makes Safari far less likely to clear your progress, and lets it open without Safari around it.';
    } else {
      note.textContent = 'Clearing this only removes the downloaded study material. ' +
        'What you have learned is stored separately and is not affected.';
    }

    $('#clearOffline').addEventListener('click', async e => {
      e.target.disabled = true;
      const done = await PWA.clearStudyCache();
      $('#offlineSummary').textContent = done
        ? 'Cleared. Study material will be saved again as you use it.'
        : 'Could not clear it — the offline worker is not running.';
      e.target.disabled = false;
    });
  }

  /* ---------- go ---------- */

  (async () => {
    const c = SRS.counts();
    if (!c.total) {
      $('#empty').hidden = false;
      $('#kpis').hidden = true;
      for (const id of ['forecastPanel', 'activityPanel', 'retentionPanel',
                        'calibrationPanel', 'coveragePanel']) {
        const n = document.getElementById(id);
        if (n) n.hidden = true;
      }
      dataTools();
      return;
    }
    kpis();
    forecast();
    heatmap();
    retentionByMode();
    calibration();
    tones();
    dataTools();
    await coverage();
    await leeches();
  })();
})();
