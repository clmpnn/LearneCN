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
"""Report what the teaching order is actually worth.

The README makes numerical claims about the syllabus — that ten ordinary
sentences become readable at word 49 on average rather than 128, that
look-alikes no longer land next to each other, that 937 characters arrive
before one of their own components. A claim in a README with no way to check
it is decoration. This prints the same numbers from the committed data.

    python3 tools/measure-order.py
"""

import json
import os
import sys
from collections import defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, 'data')

# The same ten sentences build-learning-data.py reports on. Every word is on
# the HSK list, and between them they need pronouns, the copula, negation,
# possession, a question particle, a measure word, a number and an adjective —
# which is to say: if you can read these, you have a language rather than a
# vocabulary.
TEMPLATES = [
    ('你好！', ['你好']),
    ('谢谢！——不客气。', ['谢谢', '不客气']),
    ('我叫…，你叫什么名字？', ['我', '叫', '你', '什么', '名字']),
    ('对不起。——没关系。', ['对不起', '没关系']),
    ('这是我的朋友。', ['这', '是', '我', '的', '朋友']),
    ('我不是老师，我是学生。', ['我', '不', '是', '老师', '学生']),
    ('你在哪儿？', ['你', '在', '哪儿']),
    ('我很喜欢喝茶。', ['我', '很', '喜欢', '喝', '茶']),
    ('这个多少钱？', ['这', '个', '多少', '钱']),
    ('明天天气怎么样？', ['明天', '天气', '怎么样']),
]

GAP = 12          # how far apart two confusable characters should sit
HEAD = 2000       # collisions are only interesting where a learner will be


def load(*parts):
    with open(os.path.join(DATA, *parts), encoding='utf-8') as fh:
        return json.load(fh)


def main():
    order = load('learn', 'order.json')
    hanzi = load('hanzi.json')
    words, chars = order['words'], order['chars']
    at = {w: i + 1 for i, w in enumerate(words)}
    rank = {c: i for i, c in enumerate(chars)}

    print('When each sentence becomes readable, by word number')
    total = 0
    for cn, parts in TEMPLATES:
        pos = [at.get(p) for p in parts]
        n = None if any(p is None for p in pos) else max(pos)
        total += n if n else 999
        print(f'  {n if n else "never":>6}  {cn}')
    print(f'  {total / len(TEMPLATES):>6.1f}  mean')

    groups = [[m['c'] for m in g['m']] for g in load('learn', 'confusables.json')]
    groups += [[m['c'] for m in g['m']] for g in load('learn', 'tones.json')['sets']]
    of = defaultdict(set)
    for i, g in enumerate(groups):
        for m in g:
            of[m].add(i)
    seen, clashes = {}, 0
    for i, ch in enumerate(chars[:HEAD]):
        for g in of.get(ch, ()):
            if g in seen and i - seen[g] < GAP:
                clashes += 1
            seen[g] = i
    print(f'\nLook-alikes or tone twins within {GAP} positions of each other, '
          f'in the first {HEAD:,} characters')
    print(f'  {clashes}')

    known = {h['c']: h for h in hanzi}
    IDC = set('⿰⿱⿲⿳⿴⿵⿶⿷⿸⿹⿺⿻')
    inverted = pairs = 0
    hsk_chars = {c for w in load('hsk.json') for c in w['s']}
    hsk_inverted = 0
    for h in hanzi:
        for c in (h.get('dc') or ''):
            if c in IDC or c == h['c'] or c not in known or c not in rank:
                continue
            pairs += 1
            if rank[c] > rank.get(h['c'], 0):
                inverted += 1
                if c in hsk_chars and h['c'] in hsk_chars:
                    hsk_inverted += 1
    print(f'\nCharacters arriving before one of their own components')
    print(f'  {inverted} of {len(chars):,} ({100 * inverted / len(chars):.1f}%), '
          f'{hsk_inverted} inside HSK 1-6')

    print('\nThe pairs that actually matter')
    for a, b in [('木', '林'), ('林', '森'), ('日', '明'), ('月', '明'),
                 ('女', '好'), ('子', '好'), ('人', '从'), ('口', '品')]:
        ra, rb = rank.get(a), rank.get(b)
        ok = ra is not None and rb is not None and ra < rb
        print(f'  {a} before {b}: {"yes" if ok else "NO"}  ({ra} → {rb})')
        if not ok:
            return 1

    # ---- the grammar syllabus ----
    points = load('learn', 'grammar.json')['points']
    where = {p['id']: p['pos'] for p in points}
    gap = 4
    collisions = sum(1 for p in points for n in p['near']
                     if n in where and abs(where[p['id']] - where[n]) < gap) // 2
    print(f'\nGrammar points a learner fuses, within {gap} positions of each other')
    print(f'  {collisions} of {len(points)}')

    print('\nThe grammar prerequisites that actually matter')
    for a, b in [('jieguo', 'ba'), ('ba', 'bei'), ('zhiyao', 'zhiyou'),
                 ('bi', 'meiyoubi'), ('le1', 'le2'), ('ruguo', 'tangruo'),
                 ('miande', 'yimian'), ('budan', 'bujin')]:
        ra, rb = where.get(a), where.get(b)
        ok = ra is not None and rb is not None and ra < rb
        cn = {p['id']: p['cn'] for p in points}
        print(f'  {cn.get(a, a)} before {cn.get(b, b)}: {"yes" if ok else "NO"}  ({ra} \u2192 {rb})')
        if not ok:
            return 1

    stages = load('learn', 'path.json')['stages']
    longest = max(st.get('days', 0) for st in stages)
    print(f'\nThe route')
    print(f'  {len(stages)} stages, longest {longest} days, '
          f'{sum(len(st.get("points", [])) for st in stages)} grammar points placed')
    if longest > 60:
        print(f'  a {longest}-day stage is not a stage, it is the syllabus with a name on it')
        return 1

    print('\nThe first twenty words')
    print('  ' + ' '.join(words[:20]))
    return 0


if __name__ == '__main__':
    sys.exit(main())
