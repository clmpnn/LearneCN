#!/usr/bin/env python3
# LearneCN — https://github.com/clmpnn/LearneCN
# Copyright (C) 2026 clmpnn
#
# This program is free software: you can redistribute it and/or modify it under
# the terms of the GNU General Public License as published by the Free Software
# Foundation, either version 3 of the License, or (at your option) any later
# version.
#
# This program is distributed in the hope that it will be useful, but WITHOUT ANY
# WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A
# PARTICULAR PURPOSE. See the GNU General Public License for more details.
#
# You should have received a copy of the GNU General Public License along with
# this program. If not, see <https://www.gnu.org/licenses/>.
#
# SPDX-License-Identifier: GPL-3.0-or-later
"""Turn the grammar syllabus into drills.

The bank had 343,562 questions in it and eighty-six of them were about grammar
— eight per level from HSK 3 up, for levels that introduce two and a half
thousand words between them. Vocabulary and characters were generated and so
there were hundreds of thousands of them; grammar was hand-written and so there
were eight. That is a fact about how the files were made, not a judgement about
what a learner needs.

Every point in tools/grammar-points.json carries worked examples, the terms it
is confused with, and the shape it belongs to, which is enough to generate
three drills that are worth answering:

  填空  the example with the pattern's own word taken out. The distractors are
        the points the learner actually fuses with this one — 不免 against 不禁,
        只要 against 只有 — because a cloze whose wrong answers are unrelated
        tests nothing but reading.
  格式  the sentence, and which of four shapes it is built on.
  例句  the shape, and which of four sentences is built on it. The reverse
        direction, for the same reason recognition and production are separate
        cards in the scheduler.

Each generated row carries `point`, the id it drills. Without it the practice
page's "only what I've met" filter — which works by looking for a subject it
recognises inside 「」 or in the answer — would throw away every 格式 and 例句
question, because the thing those name is a pattern and the scheduler files
patterns under an id, not a headword.

The eighty-six hand-written items are not replaced. They were written as whole
small lessons rather than as one point drilled, they are good, and they lead
each level. tools/grammar-written.json holds them so that regenerating the
bank cannot lose them.

Deterministic: distractors are chosen by a seeded shuffle keyed on the point's
id, so the same input always writes the same bytes and CI's staleness check
means something.

    python3 tools/build-grammar-questions.py           # write
    python3 tools/build-grammar-questions.py --check   # exit 1 if stale
"""

import json
import os
import random
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
QDIR = os.path.join(ROOT, 'data', 'questions')
LEARN = os.path.join(ROOT, 'data', 'learn')
PAGE = 4000            # rows per shard, the same everywhere in the bank
BLANK = ' ___ '


def load(path):
    with open(path, encoding='utf-8') as fh:
        return json.load(fh)


def distractors(point, by_id, pool, want=10, avoid=()):
    """Three wrong answers, nearest confusion first.

    A cloze is only as good as what it offers instead. The points listed in
    `near` are the ones the syllabus already believes get fused with this one,
    so they come first; `wrong` tops up from terms in the same register; and
    the level's other points fill any gap left. Anything that would also be
    correct — a term that appears in the sentence, or the answer itself — is
    dropped rather than risked.

    `avoid` is the answer as this particular example spells it, which is not
    always the point's name: 然而 is filed under 然而 and one of its examples
    turns on 不过, and 与其…不如 has an example whose blank is 不如. Without it
    the answer can be offered twice under the same question.
    """
    rng = random.Random(point['id'])
    seen = {point['cn'], term(point['cn'])} | {term(a) for a in avoid} | set(avoid)
    out = []
    near = [term(by_id[n]['cn']) for n in point['near'] if n in by_id]
    rest = [term(p['cn']) for p in pool if p['id'] != point['id']]
    rng.shuffle(rest)
    for cand in near + list(point['wrong']) + rest:
        cand = term(cand)
        if cand in seen or not cand:
            continue
        seen.add(cand)
        out.append(cand)
        if len(out) == want:
            break
    return out


def shuffled(correct, wrong, key):
    """Four choices with the answer somewhere among them, placed by seed."""
    rng = random.Random(key)
    choices = [correct] + list(wrong)
    rng.shuffle(choices)
    return choices, choices.index(correct)


def term(name):
    """The one word to offer as a wrong answer.

    A point can be named for a pair — 以前/以后, 只要…就, 与其…不如 — and the
    name is the right label for a syllabus and the wrong thing to put in a
    cloze, where it reads as an instruction rather than a choice. Take the
    first half. It also stops 只要 and 只要…就 turning up as two of the four
    choices under the same question, which is not a distractor, it is the same
    answer written twice.
    """
    for sep in ('…', '/', ' ', '，'):
        name = name.split(sep)[0]
    return name.strip()


def marks(point):
    """The literal words this point puts on the page.

    `cn` is not always one of them — 量词, 方位词 and 结果补语 name a category
    rather than a word — but every worked example carries the exact span the
    point turns on, and that is what has to be searched for.
    """
    return {span for _s, span, _en in point['eg']}


def uses(sentence, point):
    """Could this sentence be an example of that point? Then it is not a distractor.

    「我不是老师，我是学生。」 is filed under 不, and it is also a perfectly good
    example of 是. Offered as the wrong answer to a question about 是 it is not
    wrong, and a multiple-choice item with two right answers is worse than no
    item at all.
    """
    return any(m in sentence for m in marks(point))


def cloze(point, by_id, pool):
    """The example, minus the thing the point is about."""
    out = []
    for n, (sentence, span, _en) in enumerate(point['eg']):
        if span not in sentence:
            raise SystemExit(f"{point['id']}: 「{span}」 is not in 「{sentence}」")
        # Ask for more than three and filter afterwards. A candidate that
        # already appears elsewhere in the sentence is not a wrong answer, it
        # is a word the learner can see; dropping it out of a list of exactly
        # three used to cost the point a drill.
        wrong = [w for w in distractors(point, by_id, pool, avoid=(span,))
                 if w not in sentence.replace(span, '', 1)][:3]
        if len(wrong) < 3:
            raise SystemExit(f"{point['id']}: fewer than three usable distractors")
        choices, answer = shuffled(span, wrong[:3], f"{point['id']}-c{n}")
        out.append({
            'level': point['level'],
            'section': 'grammar',
            'q': sentence.replace(span, BLANK, 1),
            'choices': choices,
            'answer': answer,
            'note': point['note'],
            'point': point['id'],
        })
    return out


def which_pattern(point, pool):
    """The sentence, and which of four shapes it is built on."""
    rng = random.Random('p' + point['id'])
    sentence = point['eg'][0][0]
    others = [p['pattern'] for p in pool
              if p['pattern'] != point['pattern'] and p['level'] <= point['level'] + 1
              and not uses(sentence, p)]
    others = list(dict.fromkeys(others))
    rng.shuffle(others)
    if len(others) < 3:
        return []
    choices, answer = shuffled(point['pattern'], others[:3], 'p' + point['id'])
    return [{
        'level': point['level'],
        'section': 'grammar',
        'q': f"「{sentence}」用的是哪个格式？",
        'choices': choices,
        'answer': answer,
        'note': point['note'],
        'point': point['id'],
    }]


def which_sentence(point, pool):
    """The shape, and which of four sentences is built on it."""
    rng = random.Random('s' + point['id'])
    mine = {s for s, _sp, _en in point['eg']}
    others = [p['eg'][0][0] for p in pool
              if p['id'] != point['id'] and p['eg'][0][0] not in mine
              and abs(p['level'] - point['level']) <= 1
              and not uses(p['eg'][0][0], point)]
    others = list(dict.fromkeys(others))
    rng.shuffle(others)
    if len(others) < 3:
        return []
    choices, answer = shuffled(point['eg'][0][0], others[:3], 's' + point['id'])
    return [{
        'level': point['level'],
        'section': 'grammar',
        'q': f"哪一句用了「{point['pattern']}」？",
        'choices': choices,
        'answer': answer,
        'note': point['note'],
        'point': point['id'],
    }]


def build():
    """Every grammar shard, hand-written items first, then the syllabus in order."""
    points = load(os.path.join(LEARN, 'grammar.json'))['points']
    written = load(os.path.join(ROOT, 'tools', 'grammar-written.json'))['questions']
    by_id = {p['id']: p for p in points}

    rows = {lv: [q for q in written if q['level'] == lv] for lv in range(1, 8)}
    made = 0
    for point in points:                       # already in teaching order
        pool = [p for p in points if abs(p['level'] - point['level']) <= 1]
        drills = (cloze(point, by_id, points)
                  + which_pattern(point, pool)
                  + which_sentence(point, pool))
        rows[point['level']] += drills
        made += len(drills)
    return rows, made


def shard_name(level, page):
    return f'L{level}-grammar-{page}.json'


def main():
    check = '--check' in sys.argv
    rows, made = build()

    index_path = os.path.join(QDIR, 'index.json')
    index = load(index_path)
    stale, wrote = [], 0

    for level in sorted(rows):
        items = rows[level]
        if not items:
            continue
        pages = [items[i:i + PAGE] for i in range(0, len(items), PAGE)] or [[]]
        for n, page in enumerate(pages, 1):
            path = os.path.join(QDIR, shard_name(level, n))
            body = json.dumps(page, ensure_ascii=False, separators=(',', ':'))
            current = None
            if os.path.exists(path):
                with open(path, encoding='utf-8') as fh:
                    current = fh.read()
            if current != body:
                stale.append(shard_name(level, n))
                if not check:
                    with open(path, 'w', encoding='utf-8') as fh:
                        fh.write(body)
            wrote += len(page)
        entry = {'pages': len(pages), 'count': len(items)}
        if index.get(str(level), {}).get('grammar') != entry:
            stale.append(f'index.json (L{level})')
            index.setdefault(str(level), {})['grammar'] = entry
        print(f'  L{level} grammar   {len(items):>5,} questions, {len(pages)} page(s)')

    if not check:
        with open(index_path, 'w', encoding='utf-8') as fh:
            json.dump(index, fh, ensure_ascii=False, separators=(',', ':'), sort_keys=True)

    print(f'\n{wrote:,} grammar questions — {wrote - made} hand-written, {made} generated '
          f'from {len(load(os.path.join(LEARN, "grammar.json"))["points"])} points.')

    if check and stale:
        print('\nThe grammar bank is stale. Run tools/build-grammar-questions.py:',
              file=sys.stderr)
        for name in stale:
            print('  ' + name, file=sys.stderr)
        return 1
    if check:
        print('The grammar bank matches the syllabus.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
