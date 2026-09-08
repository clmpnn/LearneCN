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
/* LearneCN — write your own questions */

(() => {
  const { $, $$, el, data, store, speak } = CN;

  let custom = store.get('cn.custom', []);
  let imageData = '';

  /* ---------- choice rows ---------- */

  const rows = $('#choiceRows');
  for (let i = 0; i < 4; i++) {
    rows.append(el('div', { class: 'choice-row' },
      el('input', {
        type: 'radio', name: 'correct', value: String(i),
        id: `correct-${i}`, checked: i === 0,
        'aria-label': `Choice ${i + 1} is correct`
      }),
      el('input', {
        type: 'text', class: 'choice-text', id: `choice-${i}`,
        'aria-label': `Choice ${i + 1}`, placeholder: `Choice ${i + 1}`
      })));
  }

  /* ---------- section-dependent fields ---------- */

  function syncFields() {
    const s = $('#fSection').value;
    $('#wrapPassage').hidden = s !== 'reading';
    $('#wrapSpeak').hidden = s !== 'listening';
    $('#wrapSpeakTest').hidden = s !== 'listening';
    $('#wrapAudio').hidden = s !== 'listening';
    $('#wrapImage').hidden = s !== 'listening';
    $('#imageHint').hidden = s !== 'listening';
    if (s !== 'listening') clearImage();
  }

  $('#fSection').addEventListener('change', syncFields);
  syncFields();

  $('#testSpeak').addEventListener('click', () => {
    const t = $('#fSpeak').value.trim();
    if (!t) return status('Type something to hear first.');
    if (!speak(t)) status('This browser has no Chinese voice installed.');
  });

  /* ---------- image ---------- */

  function clearImage() {
    imageData = '';
    $('#fImage').value = '';
    $('#imagePreviewRow').hidden = true;
    $('#imagePreview').removeAttribute('src');
  }

  $('#clearImage').addEventListener('click', clearImage);

  $('#fImage').addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) return clearImage();
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const max = 900;
        const scale = Math.min(1, max / Math.max(img.width, img.height));
        const canvas = el('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        imageData = canvas.toDataURL('image/jpeg', 0.82);
        $('#imagePreview').src = imageData;
        $('#imagePreviewRow').hidden = false;
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });

  /* ---------- add ---------- */

  function status(msg) { $('#addStatus').textContent = msg; }

  $('#addQuestion').addEventListener('click', () => {
    const q = $('#fQuestion').value.trim();
    const choices = $$('.choice-text').map(i => i.value.trim());
    const answer = Number($$('input[name="correct"]').find(r => r.checked)?.value ?? 0);

    if (!q) return status('The question is still empty.');
    if (choices.some(c => !c)) return status('Fill in all four choices.');
    if (new Set(choices).size !== 4) return status('The four choices need to be different.');

    const item = {
      level: Number($('#fLevel').value),
      section: $('#fSection').value,
      q, choices, answer
    };
    const note = $('#fNote').value.trim();
    const passage = $('#fPassage').value.trim();
    const spoken = $('#fSpeak').value.trim();
    const audio = $('#fAudio').value.trim();
    if (note) item.note = note;
    if (passage && item.section === 'reading') item.passage = passage;
    if (spoken && item.section === 'listening') item.speak = spoken;
    if (audio && item.section === 'listening') item.audio = audio;
    if (imageData && item.section === 'listening') item.image = imageData;

    custom.push(item);
    store.set('cn.custom', custom);
    renderAdded();
    status(`Added. It is live in Practice under HSK ${item.level}.`);

    $('#fQuestion').value = '';
    $('#fNote').value = '';
    $('#fPassage').value = '';
    $('#fSpeak').value = '';
    $('#fAudio').value = '';
    $$('.choice-text').forEach(i => (i.value = ''));
    $('#correct-0').checked = true;
    clearImage();
    $('#fQuestion').focus();
  });

  $('#clearAll').addEventListener('click', () => {
    if (!custom.length) return status('Nothing to clear.');
    custom = [];
    store.set('cn.custom', custom);
    renderAdded();
    status('Your additions are gone. The built-in questions are untouched.');
  });

  /* ---------- download ---------- */

  $('#download').addEventListener('click', async () => {
    let base = [];
    try {
      base = await data('questions');
    } catch {
      status('Could not read the existing questions — downloading just your additions.');
    }
    const merged = base.concat(custom);
    const blob = new Blob([JSON.stringify(merged, null, 0)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = el('a', { href: url, download: 'questions.json' });
    document.body.append(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    status(`Downloaded ${merged.length.toLocaleString()} questions. Drop it into data/ to make it permanent.`);
  });

  /* ---------- list ---------- */

  function renderAdded() {
    const list = $('#addedList');
    list.innerHTML = '';
    if (!custom.length) {
      list.append(el('li', { class: 'empty', style: 'border-style:dashed' },
        'Nothing yet. Your questions will be listed here.'));
      return;
    }
    custom.forEach((c, i) => {
      list.append(el('li', {},
        el('span', { class: 'tag' }, `HSK${c.level} ${c.section}`),
        el('span', { style: 'flex:1' }, c.q),
        el('button', {
          class: 'mini', type: 'button',
          onclick: () => {
            custom.splice(i, 1);
            store.set('cn.custom', custom);
            renderAdded();
            status('Removed.');
          }
        }, 'Remove')));
    });
  }

  renderAdded();
})();
