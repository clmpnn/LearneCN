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
/* LearneCN — pinyin, zhuyin and hanzi reference */

(() => {
  const { $, $$, el, data, speak } = CN;

  /* ---------- tabs ---------- */

  const panels = {
    pinyin: $('#panel-pinyin'),
    zhuyin: $('#panel-zhuyin'),
    hanzi: $('#panel-hanzi')
  };

  function selectTab(name) {
    $$('#tabs .chip').forEach(b => {
      const on = b.dataset.tab === name;
      b.setAttribute('aria-selected', String(on));
      b.setAttribute('aria-pressed', String(on));
    });
    for (const [k, p] of Object.entries(panels)) p.hidden = k !== name;
    if (name === 'hanzi') buildHanzi();
    history.replaceState(null, '', `?tab=${name}`);
  }

  $$('#tabs .chip').forEach(b => b.addEventListener('click', () => selectTab(b.dataset.tab)));

  /* ---------- pinyin & zhuyin ---------- */

  function soundTile(item, lead) {
    // lead === 'z' puts zhuyin first; otherwise pinyin leads.
    const big = lead === 'z' ? item.z : item.p;
    const small = lead === 'z' ? item.p : item.z;
    return el('button', {
      class: 'sound', type: 'button',
      title: `Hear ${item.ex} (${item.exp})`,
      onclick: () => speak(item.ex)
    },
      el('span', { class: 's-p', lang: lead === 'z' ? 'zh' : 'en' }, big),
      el('span', { class: 's-z', lang: lead === 'z' ? 'en' : 'zh' }, small),
      el('span', { class: 's-ex', html: `<b>${item.ex}</b> ${item.exp} · ${item.gloss}` }));
  }

  function toneTile(t) {
    return el('button', {
      class: 'tone', type: 'button', title: `Hear ${t.ex}`,
      onclick: () => speak(t.ex)
    },
      el('div', { class: 't-n' }, `Tone ${t.n}`),
      el('div', { class: 't-mark' }, t.mark),
      el('div', { class: 't-desc' }, t.desc),
      el('div', { class: 't-ex', html: `<b>${t.ex}</b> ${t.exp} — ${t.gloss}` }));
  }

  data('pinyin').then(p => {
    p.initials.forEach(i => $('#initials').append(soundTile(i, 'p')));
    p.tones.forEach(t => $('#tones').append(toneTile(t)));

    const groups = [];
    p.finals.forEach(f => {
      let g = groups.find(x => x.name === f.group);
      if (!g) groups.push(g = { name: f.group, items: [] });
      g.items.push(f);
    });

    const build = (host, lead) => {
      host.append(el('p', { class: 'group-label' }, 'Finals · 韵母'));
      groups.forEach(g => {
        host.append(el('p', { class: 'hint', style: 'margin:14px 0 8px' }, g.name));
        const grid = el('div', { class: 'sound-grid' });
        g.items.forEach(f => grid.append(soundTile(f, lead)));
        host.append(grid);
      });
    };

    build($('#finals-groups'), 'p');

    const z = $('#zhuyin-body');
    z.append(el('p', { class: 'group-label' }, 'Initials · 声母'));
    const zi = el('div', { class: 'sound-grid' });
    p.initials.forEach(i => zi.append(soundTile(i, 'z')));
    z.append(zi);
    build(z, 'z');
  }).catch(() => {
    $('#initials').append(el('p', { class: 'empty' },
      'The pinyin chart could not load. Serve the site over http rather than opening the file directly.'));
  });

  /* ---------- hanzi ---------- */

  let all = null, level = 1, built = false;

  const LEVELS = [1, 2, 3, 4, 5, 6, 'all'];

  function levelChips() {
    const host = $('#levels');
    LEVELS.forEach(l => host.append(el('button', {
      class: 'chip level', type: 'button',
      'aria-pressed': String(l === level),
      onclick: () => { level = l; $$('#levels .chip').forEach(c =>
        c.setAttribute('aria-pressed', String(c.textContent === (l === 'all' ? 'All' : `HSK ${l}`))));
        render(); }
    }, l === 'all' ? 'All' : `HSK ${l}`)));
  }

  function render() {
    const q = $('#hzFilter').value.trim().toLowerCase();
    let list = level === 'all' ? all : all.filter(c => c.lv === level);
    if (q) {
      list = list.filter(c =>
        c.c === q ||
        (c.p || []).some(p => p.toLowerCase().includes(q) || CN.plainPinyin(p).includes(CN.plainPinyin(q))) ||
        (c.d || '').toLowerCase().includes(q));
    }

    const grid = $('#hanziGrid');
    grid.innerHTML = '';
    $('#hzCount').textContent = `${list.length.toLocaleString()} character${list.length === 1 ? '' : 's'}` +
      (level === 'all' ? ' — everything with stroke data.' : `, HSK ${level}.`);

    const capped = list.slice(0, 1500);
    const frag = document.createDocumentFragment();
    capped.forEach(c => frag.append(el('button', {
      class: 'hz', type: 'button', onclick: () => openModal(c),
      title: `${c.c} — ${(c.p || []).join(', ')}`
    },
      el('span', { class: 'h-c', lang: 'zh' }, c.c),
      el('span', { class: 'h-p' }, (c.p || [''])[0]))));
    grid.append(frag);

    if (list.length > capped.length) {
      grid.append(el('p', { class: 'hint', style: 'grid-column:1/-1;margin-top:10px' },
        `Showing the first ${capped.length.toLocaleString()}. Filter to narrow it down.`));
    }
    if (!list.length) {
      grid.append(el('p', { class: 'empty', style: 'grid-column:1/-1' },
        'Nothing matches that filter.'));
    }
  }

  async function buildHanzi() {
    if (built) return;
    built = true;
    $('#hzCount').textContent = 'Loading characters…';
    try {
      all = await data('hanzi');
    } catch {
      $('#hzCount').textContent = '';
      $('#hanziGrid').append(el('p', { class: 'empty' },
        'Character data could not load. Serve the site over http rather than opening the file directly.'));
      return;
    }
    levelChips();
    render();
    $('#hzFilter').addEventListener('input', render);
  }

  /* ---------- character modal ---------- */

  const modal = $('#charModal');
  let lastFocus = null;

  function openModal(c) {
    lastFocus = document.activeElement;
    $('#modalChar').textContent = c.c;
    $('#modalPinyin').textContent = (c.p || []).join(' · ');
    $('#modalLevel').textContent = [
      typeof c.lv === 'number' ? `HSK ${c.lv}` : 'Beyond HSK 6',
      c.s ? `${c.s} strokes` : null
    ].filter(Boolean).join(' · ');

    const facts = $('#modalFacts');
    facts.innerHTML = '';
    const rows = [];
    if (c.d) rows.push(['Meaning', c.d]);
    if (c.r) rows.push(['Radical', el('span', { class: 'decomp', lang: 'zh' }, c.r)]);
    if (c.dc && !c.dc.includes('？') && c.dc !== c.c)
      rows.push(['Built from', el('span', { class: 'decomp', lang: 'zh' }, c.dc)]);
    rows.forEach(([k, v]) => facts.append(el('div', { class: 'fact' }, el('dt', {}, k), el('dd', {}, v))));
    if (c.h) {
      const safe = c.h.replace(/[&<>]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[ch]));
      facts.append(el('p', { class: 'etym', html: safe.replace(/([\u3400-\u9fff])/g, '<b>$1</b>') }));
    }

    $('#modalTrace').href = `writing.html?c=${encodeURIComponent(c.c)}`;
    $('#modalLookup').href = `writing.html?q=${encodeURIComponent(c.c)}`;
    $('#modalSpeak').onclick = () => speak(c.c);

    modal.hidden = false;
    $('#modalClose').focus();
  }

  function closeModal() {
    modal.hidden = true;
    if (lastFocus) lastFocus.focus();
  }

  $('#modalClose').addEventListener('click', closeModal);
  modal.addEventListener('click', e => { if (e.target === modal) closeModal(); });
  addEventListener('keydown', e => { if (e.key === 'Escape' && !modal.hidden) closeModal(); });

  /* ---------- start ---------- */

  const wanted = new URLSearchParams(location.search).get('tab');
  selectTab(['pinyin', 'zhuyin', 'hanzi'].includes(wanted) ? wanted : 'pinyin');
})();
