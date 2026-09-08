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
"""Sort the question bank into the order the syllabus teaches it.

Every generated question is about one word or one character. They were written
to disk in whatever order the generator happened to emit them, which had two
consequences worth fixing.

The practice page offers three orderings — Spaced, In order, By performance —
and "In order" was in no order at all. Opening HSK 1 vocabulary asked for the
traditional form of 怎么样 first and reached 我 four hundred questions later.
A setting that names an order should have one.

And the large sections are paginated at 4,000 questions, fetched a page at a
time. With the rows unsorted, "the first page" meant four thousand arbitrary
questions out of the sixty thousand in 进阶 vocabulary. Sorted, the first page
is the first page.

Two things are deliberately left alone. Grammar, reading and listening are
hand-written and already in a considered order — easiest first — and sorting
them by subject would break the sequence somebody chose. And the answer is
never touched: this moves whole rows and nothing else.

    python3 tools/order-questions.py           # sort and re-shard
    python3 tools/order-questions.py --check   # exit 1 if anything is out of order
"""

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, 'data')
QDIR = os.path.join(DATA, 'questions')

HAN = re.compile(r'[㐀-鿿豈-﫿]')
QUOTED = re.compile(r'[「『]([^」』]+)[」』]')
SHARD = re.compile(r'^L(\d)-([a-z]+)-(\d+)\.json$')

PAGE = 4000            # rows per shard file, unchanged from the existing layout
UNKNOWN = 10 ** 9      # a subject the syllabus never introduces sorts last

# Only the generated sections are sorted. See the module docstring.
GENERATED = ('vocabulary', 'characters')

# Within one subject, the drills run in the order you would actually want them:
# what it means and how it sounds before how it is built, and stroke-count
# trivia last. Anything unrecognised keeps its place at the end of the group.
TYPES = [
    (re.compile(r'意思'),           0),   # meaning, both directions
    (re.compile(r'拼音|读音|写成汉字'), 1),   # reading, both directions
    (re.compile(r'第几声'),          2),   # tone
    (re.compile(r'读音相同'),        3),   # homophone
    (re.compile(r'部首'),           4),   # radical, both directions
    (re.compile(r'组成|哪个词里有'),   5),   # composition
    (re.compile(r'结构'),           6),   # structure
    (re.compile(r'几画'),           7),   # stroke count
    (re.compile(r'繁体|简体'),       8),   # script conversion
]


def type_rank(q):
    for pattern, rank in TYPES:
        if pattern.search(q):
            return rank
    return 9


def positions():
    """When the syllabus first introduces each word and each character.

    One scale for both, because a question about 我 and a question about the
    word 我们 belong in the same sequence. A character is placed at the first
    word that uses it — that is the day you actually meet the shape. Characters
    no HSK word uses come after the whole word list, in their own order.
    """
    with open(os.path.join(DATA, 'learn', 'order.json'), encoding='utf-8') as fh:
        order = json.load(fh)

    pos = {}
    words = order['words']
    for i, w in enumerate(words):
        pos.setdefault(w, i)
    for i, w in enumerate(words):
        for ch in w:
            if HAN.match(ch):
                pos.setdefault(ch, i)
    base = len(words)
    for i, c in enumerate(order['chars']):
        pos.setdefault(c, base + i)
    return pos


def subject(row, pos):
    """The earliest-taught thing this question is about.

    Every template puts its subject either in 「」 or in the correct answer:
    「小」的拼音是？ quotes it, 拼音「shì」写成汉字是？ answers it, and
    繁体「沒關系」的简体写法是？ quotes the form the learner does not study and
    answers the one they do. Taking the earliest known candidate across both
    places covers all fifteen templates without special-casing any of them.
    """
    best = UNKNOWN
    for token in QUOTED.findall(row.get('q', '')):
        p = pos.get(token)
        if p is not None and p < best:
            best = p
    choices = row.get('choices') or []
    answer = row.get('answer')
    if isinstance(answer, int) and 0 <= answer < len(choices):
        p = pos.get(choices[answer])
        if p is not None and p < best:
            best = p
    return best


def shards():
    """Every generated shard on disk, grouped by level and section."""
    groups = {}
    for name in sorted(os.listdir(QDIR)):
        m = SHARD.match(name)
        if not m:
            continue
        level, section, page = int(m.group(1)), m.group(2), int(m.group(3))
        if section not in GENERATED:
            continue
        groups.setdefault((level, section), []).append((page, name))
    for key in groups:
        groups[key].sort()
    return groups


def sort_group(level, section, pages, pos, workdir):
    """Sort one (level, section) across all its pages, and re-paginate.

    Sorting happens through the system sorter over a temporary key file rather
    than in memory: 进阶 vocabulary is a quarter of a million rows and sixty
    megabytes of JSON, and holding all of it as Python objects to sort it once
    is a needless way to run out of room on a small machine.
    """
    keyfile = os.path.join(workdir, f'L{level}-{section}.tsv')
    total = 0
    with open(keyfile, 'w', encoding='utf-8') as out:
        for _, name in pages:
            with open(os.path.join(QDIR, name), encoding='utf-8') as fh:
                rows = json.load(fh)
            for row in rows:
                line = json.dumps(row, ensure_ascii=False, separators=(',', ':'))
                q = row.get('q', '').replace('\t', ' ')
                out.write(f'{subject(row, pos):09d}\t{type_rank(q)}\t{q}\t{line}\n')
                total += 1

    sortedfile = keyfile + '.sorted'
    env = dict(os.environ, LC_ALL='C')          # byte order, so runs agree
    with open(sortedfile, 'w') as out:
        subprocess.run(['sort', '-t', '\t', '-k1,1', '-k2,2', '-k3,3', keyfile],
                       check=True, stdout=out, env=env)

    want_pages = max(1, (total + PAGE - 1) // PAGE)
    written, page, buf = 0, 1, []

    def flush():
        path = os.path.join(QDIR, f'L{level}-{section}-{page}.json')
        with open(path, 'w', encoding='utf-8') as fh:
            json.dump(buf, fh, ensure_ascii=False, separators=(',', ':'))

    with open(sortedfile, encoding='utf-8') as fh:
        for line in fh:
            buf.append(json.loads(line.rsplit('\t', 1)[1]))
            if len(buf) == PAGE:
                flush(); written += len(buf); buf = []; page += 1
    if buf or written == 0:
        flush(); written += len(buf)

    # Fewer pages than before means stale files are still sitting on disk.
    stale = [name for p, name in pages if p > want_pages]
    return total, want_pages, stale


def check(pos):
    """Is every shard already sorted, and does each page hold its own range?"""
    bad = []
    for (level, section), pages in sorted(shards().items()):
        last = None
        for _, name in pages:
            with open(os.path.join(QDIR, name), encoding='utf-8') as fh:
                rows = json.load(fh)
            for i, row in enumerate(rows):
                key = (subject(row, pos), type_rank(row.get('q', '')))
                if last is not None and key < last:
                    bad.append(f'{name}[{i}] comes after a later part of the syllabus')
                    break
                last = key
            if bad and bad[-1].startswith(name):
                break
    return bad


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument('--check', action='store_true',
                    help='report rather than rewrite; exit 1 if anything is out of order')
    args = ap.parse_args()

    pos = positions()

    if args.check:
        bad = check(pos)
        for line in bad[:20]:
            print('  ' + line)
        if bad:
            print(f'\n{len(bad)} section(s) out of order. '
                  f'Run tools/order-questions.py and commit the result.', file=sys.stderr)
            return 1
        print('The question bank is in teaching order.')
        return 0

    index_path = os.path.join(QDIR, 'index.json')
    with open(index_path, encoding='utf-8') as fh:
        index = json.load(fh)

    workdir = tempfile.mkdtemp(prefix='learnecn-order-')
    removed = []
    try:
        for (level, section), pages in sorted(shards().items()):
            total, npages, stale = sort_group(level, section, pages, pos, workdir)
            index.setdefault(str(level), {})[section] = {'pages': npages, 'count': total}
            removed += stale
            print(f'  L{level} {section:<11} {total:>7,} questions, {npages:>2} page(s)')
    finally:
        shutil.rmtree(workdir, ignore_errors=True)

    with open(index_path, 'w', encoding='utf-8') as fh:
        json.dump(index, fh, ensure_ascii=False, separators=(',', ':'), sort_keys=True)

    if removed:
        print('\nThese shards are no longer part of the manifest and can go:')
        for name in removed:
            print('  data/questions/' + name)
    print('\nindex.json updated.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
