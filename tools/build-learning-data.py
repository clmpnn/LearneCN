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
"""Precompute everything the study engine needs that is expensive to work out
in a browser.

The point of all of this is ordering, and ordering has two costs, not one.

The cost the graph can see: a learner who meets 森 before 木 pays twice, once
for a shape with no structure yet and again when the structure turns up. Sort
components ahead of what is built from them and that tax disappears.

The cost it cannot: a learner who reaches 谢谢 at word 146 of 150 has spent
three months unable to say thank you. Cheapest-next-word is a claim about what
a word costs and says nothing about what it is worth, and optimising it alone
produced exactly that syllabus — opening on the numerals and six bare strokes.

So the first stretch is written by hand in tools/beginner-path.json, ordered by
what a person can say, and the component rule is kept as a strong preference
that high-value words are allowed to outvote. What that costs is counted and
printed rather than hidden.

The grammar in tools/grammar-points.json goes through the same mill. A point
is placed where the words it needs have been taught rather than where its HSK
level falls, its prerequisites are a graph rather than a hope, and the pairs a
learner fuses — 不免 and 不禁, 只要…就 and 只有…才 — are spaced apart by the
same greedy that separates 天 from 夫.

Writes into data/learn/. Run from the repository root:

    python3 tools/build-learning-data.py
"""

import json
import os
import re
import sys
import unicodedata
from collections import defaultdict, Counter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, 'data')
OUT = os.path.join(DATA, 'learn')

HAN = re.compile(r'[㐀-鿿豈-﫿]')
# Ideographic Description Characters — the structural glue in a decomposition,
# not components in their own right.
IDC = set('⿰⿱⿲⿳⿴⿵⿶⿷⿸⿹⿺⿻')

TONE_MARKS = {
    'a': 'āáǎà', 'e': 'ēéěè', 'i': 'īíǐì',
    'o': 'ōóǒò', 'u': 'ūúǔù', 'ü': 'ǖǘǚǜ',
}


def load(name):
    with open(os.path.join(DATA, name), encoding='utf-8') as fh:
        return json.load(fh)


def write(name, obj):
    """Write canonically.

    Keys are sorted on the way out so the output depends only on the input.
    Several passes below walk sets, and Python randomises set iteration order
    between runs, so without this the files come out semantically identical
    but byte-different every time — which would make the CI staleness check
    fail on every push and teach everyone to ignore it.
    """
    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, name)
    with open(path, 'w', encoding='utf-8') as fh:
        json.dump(obj, fh, ensure_ascii=False, separators=(',', ':'), sort_keys=True)
    size = os.path.getsize(path)
    print(f'  {name:<20} {size / 1024:8.1f} KB')
    return size


def split_tone(syllable):
    """'hǎo' -> ('hao', 3). Accepts marked or numbered pinyin."""
    s = str(syllable).strip().lower()
    if not s:
        return '', 0
    m = re.match(r'^([a-zü:v]+)([1-5])$', s)
    if m:
        body = m.group(1).replace('u:', 'v').replace('ü', 'v')
        return body, int(m.group(2))
    # Fold ü to v before any combining mark is dropped. ǚ decomposes to
    # u + diaeresis + caron, so stripping every combining mark in one pass
    # turns nǚ into nu — which would file 女 in the same tone set as 努 and
    # then print it back as nǔ.
    decomposed = unicodedata.normalize('NFD', s).replace('u\u0308', 'v')
    tone = 5
    out = []
    for ch in decomposed:
        if unicodedata.combining(ch):
            tone = {0x300: 4, 0x301: 2, 0x304: 1, 0x30c: 3}.get(ord(ch), tone)
        else:
            out.append(ch)
    body = ''.join(out).replace('ü', 'v').replace('u:', 'v')
    body = re.sub(r'[^a-z]', '', body)
    return body, tone


def add_marks(body, tone):
    """('hao', 3) -> 'hǎo'."""
    if tone in (0, 5) or not body:
        return body.replace('v', 'ü')
    body = body.replace('v', 'ü')
    if 'a' in body:
        target = 'a'
    elif 'e' in body:
        target = 'e'
    elif 'ou' in body:
        target = 'o'
    else:
        vowels = [c for c in body if c in 'aeiouü']
        if not vowels:
            return body
        target = vowels[-1]
    idx = body.rfind(target)
    return body[:idx] + TONE_MARKS[target][tone - 1] + body[idx + 1:]


# --------------------------------------------------------------------------


def components_of(entry, known):
    """Characters that make up this one, from its decomposition."""
    dc = entry.get('dc') or ''
    out = []
    for ch in dc:
        if ch in IDC or ch == '？':
            continue
        if ch == entry['c']:
            continue                      # 口 decomposes to 口; not a dependency
        if HAN.match(ch) and ch in known:
            out.append(ch)
    return out


def build_components(hanzi):
    known = {h['c']: h for h in hanzi}
    comps = {}
    used_by = defaultdict(list)
    for h in hanzi:
        cs = components_of(h, known)
        if cs:
            comps[h['c']] = cs
            for c in sorted(set(cs)):
                used_by[c].append(h['c'])
    return comps, used_by


def hsk_index(rows):
    """Headword -> row, keeping the lowest level where the list repeats a word.

    data/hsk.json carries six headwords twice — 喂 at 1 and 6, 还 过 得 等 长 at
    2 and 3 or 4. Every index built the obvious way keeps whichever came last,
    which quietly promotes 喂 to HSK 6 and takes it out of the first level a
    beginner studies. The word belongs to the earliest level that asks for it.
    """
    idx = {}
    for w in rows:
        cur = idx.get(w['s'])
        if cur is None or (w.get('lv') or 9) < (cur.get('lv') or 9):
            idx[w['s']] = w
    return idx


def utility(rows):
    """How much of the syllabus each character unlocks.

    A character is worth teaching early in proportion to how much of the rest
    of the course it opens: how many HSK words contain it, counting the early
    levels for more, since a character that turns up in HSK 1 words pays out
    now and one that only appears in HSK 6 words pays out in three years.
    """
    weight = {1: 6, 2: 5, 3: 4, 4: 3, 5: 2, 6: 1}
    score = Counter()
    for w in rows:
        for ch in set(w['s']):
            if HAN.match(ch):
                score[ch] += weight.get(w.get('lv') or 6, 1)
    return score


def percentile(score, keys):
    """Map a score into 0–999, so it can tie-break inside an integer cost."""
    ranked = sorted(keys, key=lambda k: (score.get(k, 0), k))
    n = max(1, len(ranked) - 1)
    return {k: int(999 * i / n) for i, k in enumerate(ranked)}


def word_order(hsk, core, util, util_pct):
    """Order words so the learner can say something as early as possible.

    The old rule was one line long: inside a level, repeatedly take the word
    that introduces the fewest unfamiliar characters. It is a good rule and on
    its own it produced a syllabus that opens with the numerals and reaches
    谢谢 at word 146 of 150 — because "cheapest next word" is a statement about
    cost and says nothing at all about value. A beginner who cannot yet say
    thank you has not been served by saving them two character lookups.

    So value leads and cost follows:

      1. The hand-written sequence in tools/beginner-path.json, where it has an
         opinion. This is the whole of HSK 1 and the function words of HSK 2 —
         the stretch where what you can *say* matters more than what the graph
         says is cheap. 谢谢 costs two brand-new characters and is taught
         eighth anyway.
      2. Failing that, fewest new characters, exactly as before.
      3. Inside an equal cost, the word whose characters unlock the most of
         what is still to come.

    Level stays the outer band, so the syllabus still reads as HSK 1 … 6.
    """
    by_level = defaultdict(list)
    for i, w in enumerate(hsk):
        by_level[w['lv']].append((i, w))

    core_rank = {w: i for i, w in enumerate(core)}
    FAR = 10 ** 6

    seen = set()
    out = []
    for lv in sorted(by_level):
        pending = by_level[lv][:]
        while pending:
            best = None
            for pos, (i, w) in enumerate(pending):
                chars = [c for c in w['s'] if HAN.match(c)]
                new = sum(1 for c in chars if c not in seen)
                gain = max((util_pct.get(c, 0) for c in chars), default=0)
                cost = (core_rank.get(w['s'], FAR),   # curated order, where curated
                        new * 1000 - gain,            # cheapest, then most useful
                        len(chars),                   # shorter words first
                        i)                            # then the official order
                if best is None or cost < best[0]:
                    best = (cost, pos)
            _, pos = best
            i, w = pending.pop(pos)
            seen.update(c for c in w['s'] if HAN.match(c))
            out.append(w['s'])
    return out


def character_order(hanzi, comps, word_seq, util):
    """Characters in the order the words actually need them.

    The old rule sorted by HSK level, then stroke count, under a hard
    constraint that no character may precede one of its own components. The
    constraint is right — meeting 森 before 木 costs two memorisations instead
    of one — and taken as an absolute it opened the syllabus with 一 丨 十 人 八
    几 二 儿 … : the numerals and six bare strokes that are not words, ahead of
    every character a beginner could use in a sentence.

    The fix is to keep the constraint as a preference and let it be outvoted.
    A character is ranked by the first word that needs it. Its components are
    pulled in ahead of it only when they earn the place on their own account —
    a character in its own right at the same level or lower, or a shape
    productive enough that learning it once pays across many characters. A
    component that is neither (戈 in 我, 尔 in 你) is left to arrive when its
    own usefulness brings it, and 我 and 你 are taught in week one.

    Characters that end up before one of their components are counted and
    reported, not hidden. The number is the price of the trade and belongs in
    the open.
    """
    known = {h['c']: h for h in hanzi}

    fan_out = Counter()
    for ch, cs in comps.items():
        for c in set(cs):
            fan_out[c] += 1

    # When the syllabus first asks for each character.
    need = {}
    for i, word in enumerate(word_seq):
        for ch in word:
            if ch in known and ch not in need:
                need[ch] = i
    FAR = 10 ** 6

    def level(ch):
        return known[ch].get('lv') or 8

    def rank(ch):
        h = known[ch]
        return (level(ch), need.get(ch, FAR), -util.get(ch, 0),
                h.get('s') or 30, ch)

    # A component goes first only if it stands on its own: it is taught at this
    # level or earlier anyway, or it builds enough other characters to repay the
    # detour. FAN_MIN is deliberately high — the point is to admit 木, 口 and 人,
    # not every stroke that happens to appear twice.
    FAN_MIN = 24

    def earns_its_place(c, ch):
        return level(c) <= level(ch) or fan_out.get(c, 0) >= FAN_MIN

    order = []
    placed = set()
    visiting = set()

    def visit(ch, depth=0):
        if ch in placed or ch not in known:
            return
        if ch in visiting or depth > 24:
            return                        # cyclic or pathological decomposition
        visiting.add(ch)
        for c in sorted(set(comps.get(ch, [])), key=rank):
            if c in known and earns_its_place(c, ch):
                visit(c, depth + 1)
        visiting.discard(ch)
        if ch not in placed:
            placed.add(ch)
            order.append(ch)

    for ch in sorted(known, key=rank):
        visit(ch)
    return order


def space_interference(seq, groups, gap=12, ready=None):
    """Push look-alikes and tone twins apart in the sequence.

    Two characters that differ by one stroke, or one syllable wearing two
    tones, are the two things a learner most reliably fuses into a single
    wrong memory. The data to avoid it is already computed — confusables and
    tone sets — and until now it was only used to *test* on the confusion
    after it had formed. It is cheaper to not cause it.

    Same greedy as srs.js uses to keep two cards for one word out of the same
    session: walk the sequence, and whenever the next item shares a group with
    something inside the last `gap` positions, take the next item that does
    not. Nothing is dropped and nothing moves far; 天 and 夫 simply stop being
    neighbours.

    `ready(item, placed)` guards the swap where one exists. Characters have no
    hard prerequisites — 森 before 木 is a cost, not an error — but a grammar
    point can genuinely require another, and pulling 只有…才 in front of
    只要…就 to break up a pair would be a worse trade than the collision.
    """
    of = defaultdict(set)
    for gi, members in enumerate(groups):
        for m in members:
            of[m].add(gi)

    out = []
    placed = set()
    pending = list(seq)
    last = {}                              # group -> position in `out`
    while pending:
        picked = next(i for i, item in enumerate(pending)
                      if ready is None or ready(item, placed))
        for i, item in enumerate(pending[:gap * 4]):
            if ready is not None and not ready(item, placed):
                continue
            gs = of.get(item)
            if not gs or all(len(out) - last.get(g, -gap) >= gap for g in gs):
                picked = i
                break
        item = pending.pop(picked)
        placed.add(item)
        for g in of.get(item, ()):
            last[g] = len(out)
        out.append(item)
    return out



def load_grammar():
    """The hand-written grammar syllabus."""
    path = os.path.join(ROOT, 'tools', 'grammar-points.json')
    with open(path, encoding='utf-8') as fh:
        return json.load(fh)['points']


def grammar_order(points, word_seq, level_of):
    """Order the grammar points the way the words are ordered, for the same reason.

    A grammar point is not learnable on the day its level begins. 把 is HSK 3
    and needs a result complement after the verb, which is HSK 2; 只有…才 is
    only meaningful once 只要…就 is there to contrast with. Sorted by level
    alone the syllabus asks for 被 before the learner has met 把, and teaches
    不免 and 不禁 — which differ by whether what follows is a feeling or an
    action — back to back, which is the reliable way to fuse two memories into
    one wrong one.

    So each point is anchored at the position where the word syllabus has
    finished teaching what it needs, then Kahn's algorithm walks the
    prerequisite graph taking whichever available point the syllabus reaches
    first. Level breaks ties, not the other way round: a point is placed when
    it is learnable, and its level is a fact about the exam.

    Words the HSK list does not carry are ignored for anchoring rather than
    silently dropped. 动辄 is its own prerequisite and no vocabulary syllabus
    will ever introduce it; the point still has to go somewhere, and its level
    and its dependencies are enough to say where.

    The level is a floor under the anchor, not a tie-break above it. 对…来说
    needs 对, which is HSK 2, and 来说, which is on no list at all — anchored
    on words alone it lands at point 39, between 让 and 还, and an HSK 4 frame
    is not the fortieth thing a beginner should meet. Where the words push a
    point later than its level, they win; they are never allowed to pull it
    earlier.
    """
    at = {w: i for i, w in enumerate(word_seq)}
    by_id = {p['id']: p for p in points}

    opens = {}
    for i, w in enumerate(word_seq):
        opens.setdefault(level_of.get(w, 6), i)
    floor = {lv: min(v for k, v in opens.items() if k >= lv) if any(k >= lv for k in opens) else 0
             for lv in range(1, 8)}

    anchor, lifted = {}, 0
    for p in points:
        have = [at[w] for w in p['needs'] if w in at]
        words = max(have) if have else -1
        anchor[p['id']] = max(words, floor.get(p['level'], 0))
        lifted += anchor[p['id']] > words

    # A prerequisite can sit later in the word order than the point that needs
    # it — 把 leans on 结果补语, which needs no word 把 does not. Lift each
    # anchor to clear everything it depends on, longest chain first.
    order_by_depth = sorted(by_id, key=lambda i: len(by_id[i]['after']))
    for _ in range(len(points)):
        moved = False
        for pid in order_by_depth:
            need = [anchor[a] for a in by_id[pid]['after'] if a in anchor]
            if need and anchor[pid] <= max(need):
                anchor[pid] = max(need) + 1
                moved = True
        if not moved:
            break

    waiting = {p['id']: set(p['after']) for p in points}
    seq, done = [], set()
    while waiting:
        free = [i for i, need in waiting.items() if not (need - done)]
        if not free:
            raise SystemExit('grammar-points.json: `after` has a cycle: '
                             + ' '.join(sorted(waiting)))
        pick = min(free, key=lambda i: (anchor[i], by_id[i]['level'], i))
        seq.append(pick)
        done.add(pick)
        del waiting[pick]

    groups = [[p['id']] + list(p['near']) for p in points if p['near']]
    ready = lambda pid, placed: not (set(by_id[pid]['after']) - placed)
    return space_interference(seq, groups, gap=4, ready=ready), anchor, lifted


def grammar_collisions(seq, points, gap=4):
    """How many points a learner confuses still land inside `gap` of each other."""
    where = {pid: i for i, pid in enumerate(seq)}
    return sum(1 for p in points for n in p['near']
               if n in where and abs(where[p['id']] - where[n]) < gap) // 2

def tone_sets(hanzi, hsk):
    """Characters that differ only in tone — the drill English speakers need most.

    妈 麻 马 骂 are one segmental syllable wearing four different tones. Nothing
    else in Mandarin trips up a new learner as reliably, and nothing else is as
    easy to practise once the sets are laid out.

    Only characters that actually turn up in HSK 1-6 are eligible. Drawing from
    all 9,534 means the tone for a syllable is often carried by something like
    殍 ("to starve to death") — a contrast nobody will ever need to hear, sat
    next to two words they use daily.
    """
    useful = {c for w in hsk for c in w['s']}
    useful |= {c for w in hsk if w.get('t') for c in w['t']}

    groups = defaultdict(dict)
    gloss = {}
    for h in hanzi:
        readings = h.get('p') or []
        if not readings:
            continue
        if h['c'] not in useful and not h.get('lv'):
            continue
        body, tone = split_tone(readings[0])
        if not body or tone == 5:
            continue
        lv = h.get('lv') or 8
        slot = groups[body].setdefault(tone, [])
        slot.append((lv, h['c']))
        gloss[h['c']] = (h.get('d') or '').split(';')[0].strip()[:40]

    out = []
    for body, tones in groups.items():
        if len(tones) < 2:
            continue
        members = []
        for tone in sorted(tones):
            # the most elementary character carrying this tone
            lv, ch = sorted(tones[tone])[0]
            members.append({'c': ch, 't': tone, 'p': add_marks(body, tone),
                            'g': gloss.get(ch, ''), 'lv': lv})
        if len(members) < 2:
            continue
        hardest = min(m['lv'] for m in members)
        out.append({'base': body, 'lv': hardest, 'm': members})

    out.sort(key=lambda g: (g['lv'], -len(g['m']), g['base']))
    return out


def tone_pairs(hsk):
    """Two-syllable words grouped by their tone contour.

    Single tones in isolation are the easy half. What actually breaks down in
    speech is the contour across a word — 买东西 vs 卖东西 — so these are
    grouped by tone pattern for contrastive drilling.
    """
    by_pattern = defaultdict(list)
    for w in hsk:
        syls = str(w.get('n') or '').split()
        if len(syls) != 2:
            continue
        tones = []
        for s in syls:
            _, t = split_tone(s)
            tones.append(t)
        if any(t == 0 for t in tones):
            continue
        key = f'{tones[0]}{tones[1]}'
        by_pattern[key].append({'w': w['s'], 'p': w['p'], 'e': w['e'][:48], 'lv': w['lv']})
    out = {}
    for k, v in by_pattern.items():
        v.sort(key=lambda x: x['lv'])
        out[k] = v[:60]
    return out


def confusables(hanzi, comps):
    """Characters a reader genuinely mixes up: 士/土, 未/末, 己/已/巳.

    Two tests, because visual confusion has two sources. Either the pair is
    built from the same parts (same component multiset, different arrangement),
    or the pair is nearly the same shape at a similar stroke count. Both are
    checked against a stroke-count window so that 一 and 罐 never meet.
    """
    known = {h['c']: h for h in hanzi}
    by_parts = defaultdict(list)
    by_shape = defaultdict(list)

    for h in hanzi:
        ch = h['c']
        strokes = h.get('s') or 0
        if strokes == 0:
            continue
        parts = comps.get(ch)
        if parts:
            key = (''.join(sorted(parts)), strokes)
            by_parts[key].append(ch)
        dc = (h.get('dc') or '').strip()
        if dc and dc != '？':
            skeleton = ''.join(c for c in dc if c not in IDC)
            if len(skeleton) >= 2:
                by_shape[(skeleton, strokes)].append(ch)

    groups = {}

    def add(members):
        # Only characters that appear somewhere in HSK 1-6. Bare radicals and
        # obscure variants are visually similar to plenty of things, but
        # confusing them is not a mistake anyone is going to make in practice.
        members = [c for c in set(members) if known.get(c, {}).get('lv')]
        members = sorted(members, key=lambda c: (known[c].get('lv') or 8, c))
        if len(members) < 2 or len(members) > 6:
            return
        key = ''.join(members)
        if key in groups:
            return
        groups[key] = members

    for bucket in list(by_parts.values()) + list(by_shape.values()):
        add(bucket)

    # near-miss pairs: same radical, stroke counts within one, decompositions
    # differing by a single character
    by_radical = defaultdict(list)
    for h in hanzi:
        if h.get('lv'):                       # only bother inside HSK
            by_radical[h.get('r')].append(h)
    for radical, members in by_radical.items():
        members.sort(key=lambda h: h.get('s') or 0)
        for i, a in enumerate(members):
            for b in members[i + 1:]:
                if abs((a.get('s') or 0) - (b.get('s') or 0)) > 1:
                    break
                sa = ''.join(sorted(c for c in (a.get('dc') or '') if c not in IDC))
                sb = ''.join(sorted(c for c in (b.get('dc') or '') if c not in IDC))
                if not sa or not sb or sa == '？' or sb == '？':
                    continue
                if sa == sb or (len(sa) == len(sb) and sum(x != y for x, y in zip(sa, sb)) == 1):
                    add([a['c'], b['c']])

    out = []
    for members in groups.values():
        entry = []
        for ch in members:
            h = known[ch]
            entry.append({
                'c': ch,
                'p': (h.get('p') or [''])[0],
                'g': (h.get('d') or '').split(';')[0].strip()[:40],
                'lv': h.get('lv') or 8,
                's': h.get('s') or 0,
            })
        lv = min(e['lv'] for e in entry)
        out.append({'lv': lv, 'm': entry})
    out.sort(key=lambda g: (g['lv'], -len(g['m'])))
    return out[:1200]


def mine_sentences(hsk):
    """Pull real running Chinese out of the question bank.

    Reading passages, listening scripts and grammar cloze items are the only
    connected prose in the repository, so they are the only honest source of
    context. A cloze question is a whole sentence once its blank is filled in,
    which roughly doubles what is available. A word met inside a sentence
    sticks better than the same word met alone, and showing one costs nothing.
    """
    qdir = os.path.join(DATA, 'questions')
    sentences = []
    if os.path.isdir(qdir):
        for name in sorted(os.listdir(qdir)):
            if not name.endswith('.json') or name == 'index.json':
                continue
            try:
                with open(os.path.join(qdir, name), encoding='utf-8') as fh:
                    rows = json.load(fh)
            except (ValueError, OSError):
                continue
            if not isinstance(rows, list):
                continue
            for q in rows:
                lv = q.get('level') or 8
                texts = []
                for field in ('passage', 'speak'):
                    if q.get(field):
                        texts.append(str(q[field]))
                # a cloze item is a sentence once the blank is filled
                stem = str(q.get('q') or '')
                if '___' in stem:
                    choices = q.get('choices') or []
                    idx = q.get('answer')
                    if isinstance(idx, int) and 0 <= idx < len(choices):
                        texts.append(stem.replace('___', str(choices[idx])))
                for text in texts:
                    # the bank spaces some stems out for readability; a
                    # sentence shown as context should read normally
                    text = re.sub(r'(?<=[\u3400-\u9fff])\s+(?=[\u3400-\u9fff\u3000-\u303f])', '', text)
                    for part in re.split(r'(?<=[。！？])', text):
                        part = part.strip()
                        if 4 <= len(part) <= 42 and HAN.search(part) and '___' not in part:
                            sentences.append((lv, part))

    seen = set()
    unique = []
    for lv, s in sentences:
        if s in seen:
            continue
        seen.add(s)
        unique.append((lv, s))

    index = defaultdict(list)
    for lv, s in unique:
        for w in hsk:
            word = w['s']
            if len(word) >= 2 and word in s:
                index[word].append((abs(lv - w['lv']), len(s), s))

    out = {}
    for word, hits in index.items():
        hits.sort()
        out[word] = [h[2] for h in hits[:2]]
    return out, len(unique)


def character_words(hsk, hanzi):
    """Which HSK words each character turns up in.

    This is the context that actually exists at scale. 木 on its own is an
    abstraction; 木头, 树木 and 木材 are what the character does for a living,
    and seeing three of them is worth more than any single invented sentence.
    Ordered easiest-first so a beginner meets 大人 before 大使馆.
    """
    index = defaultdict(list)
    for w in hsk:
        word = w['s']
        if len(word) < 2:
            continue
        for ch in sorted(set(word)):
            if HAN.match(ch):
                index[ch].append((w['lv'], len(word), word, w['p'], w['e'][:40]))
    out = {}
    for ch, rows in index.items():
        rows.sort()
        out[ch] = [{'w': r[2], 'p': r[3], 'e': r[4]} for r in rows[:6]]
    return out


def load_curriculum():
    """The hand-written half of the syllabus."""
    path = os.path.join(ROOT, 'tools', 'beginner-path.json')
    with open(path, encoding='utf-8') as fh:
        return json.load(fh)


def check_curriculum(curr, index):
    """Every curated headword has to exist, or the ordering silently ignores it."""
    known = set(index)
    missing = [w for w in curr['core'] if w not in known]
    if missing:
        print('  curated words not in the HSK list or phrase list: '
              + ' '.join(missing), file=sys.stderr)
    return missing


def build_path(curr, word_seq, index, gpoints):
    """The staged route from nothing to HSK 6.

    order.json says what comes next. It does not say where to start, how much
    of it is a week, or when handwriting is worth opening — and a beginner
    landing on a page that asks them to choose levels, material and card types
    before they know what any of those are has been handed the syllabus and
    called it a course.

    Each stage names what it is for and what a person can say by the end of it.

    HSK 2 to 6 used to be five stages holding a hundred and fifty, three
    hundred, six hundred, thirteen hundred and twenty-five hundred words, the
    last of them budgeted at three hundred days. A stage a learner cannot
    finish is not a stage, it is the syllabus with a name on it, and the
    promise the path makes — one thing to do next — is not kept by any of
    them. They are twenty-five stages now, bounded either by the grammar point
    they exist to reach or, where the level really is just vocabulary, by a
    word count that says so rather than pretending otherwise.

    A stage ends at whichever boundary it declares: `until` a curated
    headword, `untilPoint` a grammar point, `untilWords` a count, or the end
    of its level when it declares none.
    """
    at = {w: i for i, w in enumerate(word_seq)}
    level_of = {w: (index[w].get('lv') or 6) for w in index}
    unlock = {p['id']: p['unlockAt'] for p in gpoints}

    stages = []
    cursor = 0
    for src in curr['stages']:
        stage = {k: v for k, v in src.items()
                 if k in ('id', 'cn', 'title', 'goal', 'why', 'kind',
                          'days', 'modes', 'sentence', 'does')}

        if src['kind'] == 'sounds':
            stage['count'] = 0

        elif src['kind'] == 'words':
            if 'until' in src:
                end = at.get(src['until'])
                if end is None:
                    raise SystemExit(f"stage {src['id']}: {src['until']} is not in the order")
                end += 1
            elif 'untilPoint' in src:
                if src['untilPoint'] not in unlock:
                    raise SystemExit(f"stage {src['id']}: no grammar point "
                                     f"{src['untilPoint']}")
                end = min(len(word_seq), unlock[src['untilPoint']] + 1)
            elif 'untilWords' in src:
                end = min(len(word_seq), cursor + int(src['untilWords']))
            else:
                lv = src['level']
                end = cursor
                while end < len(word_seq) and level_of.get(word_seq[end], 9) <= lv:
                    end += 1
            items = word_seq[cursor:end]
            stage['items'] = ['w:' + w for w in items]
            stage['count'] = len(items)
            stage['level'] = src.get('level') or max(
                (level_of.get(w, 1) for w in items), default=1)
            stage['points'] = [p['id'] for p in gpoints
                               if cursor <= p['unlockAt'] < end]
            cursor = end

        else:                                     # a whole HSK level
            lv = src['level']
            stage['level'] = lv
            stage['count'] = sum(1 for w in word_seq if level_of.get(w) == lv)
            cursor = max(cursor, next((i for i, w in enumerate(word_seq)
                                       if level_of.get(w, 0) > lv), len(word_seq)))

        stages.append(stage)

    return {'stages': stages, 'generated': 'tools/build-learning-data.py'}


def first_sentence_at(word_seq, index, templates):
    """How far in before each sentence can be read with nothing but what is taught.

    The number the old order could not report: at what point does the syllabus
    stop being a list of words and start being a language. A sentence counts as
    reachable at the position of the last word in it that the course has
    introduced.
    """
    at = {w: i for i, w in enumerate(word_seq)}
    out = []
    for cn, gloss, parts in templates:
        need = [at.get(p) for p in parts]
        out.append((cn, gloss, None if any(n is None for n in need) else max(need) + 1))
    return out


# Ten ordinary sentences, used to report when the syllabus stops being a word
# list and starts being a language. Every word in them is on the HSK list.
TEMPLATES = [
    ('你好！', 'hello', ['你好']),
    ('谢谢！——不客气。', 'thanks — you are welcome', ['谢谢', '不客气']),
    ('我叫…，你叫什么名字？', 'I am called …, what is your name?',
     ['我', '叫', '你', '什么', '名字']),
    ('对不起。——没关系。', 'sorry — never mind', ['对不起', '没关系']),
    ('这是我的朋友。', 'this is my friend', ['这', '是', '我', '的', '朋友']),
    ('我不是老师，我是学生。', 'I am not a teacher, I am a student',
     ['我', '不', '是', '老师', '学生']),
    ('你在哪儿？', 'where are you?', ['你', '在', '哪儿']),
    ('我很喜欢喝茶。', 'I like drinking tea very much',
     ['我', '很', '喜欢', '喝', '茶']),
    ('这个多少钱？', 'how much is this?', ['这', '个', '多少', '钱']),
    ('明天天气怎么样？', 'what is the weather like tomorrow?',
     ['明天', '天气', '怎么样']),
]


def main():
    print('Reading source data …')
    hanzi = load('hanzi.json')
    hsk = load('hsk.json')
    curr = load_curriculum()
    phrases = [{k: v for k, v in p.items() if k != 'why'} for p in curr['phrases']]

    # Phrases first, so a curated gloss wins over a duplicate HSK row.
    index = hsk_index(phrases + hsk)
    rows = phrases + [w for w in hsk]
    check_curriculum(curr, index)
    dupes = len(hsk) - len({w['s'] for w in hsk})
    if dupes:
        print(f'  {dupes} headwords appear twice in hsk.json; keeping the earliest level')

    print('Working out what is built from what …')
    comps, used_by = build_components(hanzi)

    print('Scoring how much of the syllabus each character unlocks …')
    util = utility(rows)
    util_pct = percentile(util, [h['c'] for h in hanzi])

    print('Ordering words by what they let you say …')
    ordered = sorted(index.values(), key=lambda w: (w.get('lv') or 6, w['s']))
    worder = word_order(ordered, curr['core'], util, util_pct)

    print('Ordering characters by when the words need them …')
    corder = character_order(hanzi, comps, worder, util)
    char_rank = {c: i for i, c in enumerate(corder)}

    print('Finding tone sets, tone pairs and look-alikes …')
    tones = tone_sets(hanzi, hsk)
    pairs = tone_pairs(hsk)
    confuse = confusables(hanzi, comps)

    print('Spacing look-alikes and tone twins apart …')
    groups = [[m['c'] for m in g['m']] for g in confuse]
    groups += [[m['c'] for m in g['m']] for g in tones]
    corder = space_interference(corder, groups)
    char_rank = {c: i for i, c in enumerate(corder)}

    # What the trade cost. A character placed before one of its own components
    # is the price of teaching 我 in week one; the number belongs in the open.
    def inverted(only=None):
        return sum(1 for ch, cs in comps.items() for c in cs
                   if c in char_rank and char_rank[c] > char_rank.get(ch, 0)
                   and (only is None or (ch in only and c in only)))

    hsk_chars = {c for w in hsk for c in w['s'] if HAN.match(c)}
    violations, taught = inverted(), inverted(hsk_chars)
    print(f'  {len(corder)} characters ordered; {violations} arrive before a component '
          f'({100 * violations / max(1, len(corder)):.1f}%), '
          f'{taught} of them inside HSK 1-6')

    level_of = {w: (index[w].get('lv') or 6) for w in index}

    print('Ordering the grammar points by when they become learnable …')
    points = load_grammar()
    gseq, ganchor, lifted = grammar_order(points, worder, level_of)
    gpos = {pid: i for i, pid in enumerate(gseq)}
    gpoints = sorted(points, key=lambda p: gpos[p['id']])
    for p in gpoints:
        p['pos'] = gpos[p['id']]
        p['unlockAt'] = ganchor[p['id']]
    off = sum(1 for w in {w for p in points for w in p['needs']}
              if w not in set(worder))
    print(f'  {len(gpoints)} points ordered; {grammar_collisions(gseq, points)} '
          f'confusable pairs still within four positions')
    print(f'  {lifted} held back to their own level, '
          f'{off} prerequisite words the HSK list does not carry')

    print('Building the beginner path …')
    path = build_path(curr, worder, index, gpoints)
    taught = sum(s.get('count', 0) for s in path['stages'])
    covered = sum(len(s.get('points', [])) for s in path['stages'])
    longest = max(s.get('days', 0) for s in path['stages'])
    print(f'  {len(path["stages"])} stages, {taught} words and {covered} grammar '
          f'points on the route to HSK 6; longest stage {longest} days')

    print('Mining example sentences from the question bank …')
    sentences, pool = mine_sentences(hsk)
    print(f'  {pool} distinct sentences, {len(sentences)} words covered')

    print('Indexing which words each character appears in …')
    charwords = character_words(hsk, hanzi)
    print(f'  {len(charwords)} characters have HSK words to show')

    print('\nWriting data/learn/ …')
    total = 0
    total += write('order.json', {
        'chars': corder,
        'words': worder,
        'generated': 'tools/build-learning-data.py',
    })
    total += write('path.json', path)
    total += write('grammar.json', {
        'points': gpoints,
        'generated': 'tools/build-learning-data.py',
    })
    total += write('phrases.json', phrases)
    total += write('components.json', {
        'of': comps,
        'usedBy': {k: v[:24] for k, v in used_by.items() if len(v) > 1},
    })
    total += write('tones.json', {'sets': tones, 'pairs': pairs})
    total += write('confusables.json', confuse)
    total += write('sentences.json', sentences)
    total += write('charwords.json', charwords)
    print(f'  {"total":<20} {total / 1024:8.1f} KB\n')

    print(f'{len(tones)} tone sets · {len(pairs)} tone contours · '
          f'{len(confuse)} look-alike groups')

    print('\nWhen each sentence becomes readable, by word number:')
    for cn, gloss, at in first_sentence_at(worder, index, TEMPLATES):
        print(f'  {at if at else "—":>5}  {cn}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
