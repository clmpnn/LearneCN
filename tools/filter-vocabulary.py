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
"""Take the obscene vocabulary out of the study material.

CC-CEDICT and Make Me a Hanzi are complete references. They document what the
language contains, which is the right call for a dictionary and the wrong one
for something a beginner opens on a bus. This removes that material from the
data the site ships.

The whole design rests on one observation: an entry is rarely dirty, a *sense*
is. 柴 reads "firewood, faggots, fuel" — where faggots means bundles of sticks.
龟 is "tortoise; turtle/(coll.) cuckold". 骚扰 is HSK 6 and glossed
"harass; disturb; molest". Deleting those three would take firewood, turtles
and harassment out of a Mandarin course. So senses are dropped individually,
and an entry only disappears when nothing clean is left of it.

Two rules sit above everything else:

  · Official HSK 1-6 vocabulary is never deleted. The site exists to teach
    that list and the exam will ask about it either way; the most that
    happens to an HSK word is that a coarse sense is dropped from its gloss.
  · Every removal is written to tools/vocabulary-report.txt with the term
    that triggered it, so the judgement calls here can be argued with.

Run from the repository root:

    python3 tools/filter-vocabulary.py            # apply
    python3 tools/filter-vocabulary.py --check    # change nothing; exit 1 if
                                                  # anything still needs removing

Idempotent: running it twice does nothing the second time.
"""

import json
import os
import re
import sys
from collections import Counter, defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, 'data')
REPORT = os.path.join(ROOT, 'tools', 'vocabulary-report.txt')
BLOCKED = os.path.join(ROOT, 'tools', 'blocked-headwords.txt')

# ---------------------------------------------------------------------------
# What counts. Edit these lists rather than the logic below.
#
# Each term is matched on word boundaries against an individual sense, never
# against a whole entry, so "intercourse" in "social intercourse" is caught by
# the allowlist rather than by luck.
# ---------------------------------------------------------------------------

CATEGORIES = {
    'sexual': r'''
        prostitut\w* | whore\w* | harlot\w* | brothel\w* | hooker |
        pimp(?:s|ing)?\b |
        courtesan\w* | concubin\w* | catamite | geisha | escort\s+service |
        penis | phallus | phallic | vagina(?:s|l)?\b | vulva | clitor\w* | scrotum |
        genitalia | anus | anal\s+sex |
        masturbat\w* | ejaculat\w* | orgasm\w* | erection |
        copulat\w* | fornicat\w* | coitus | sodom\w* | bestiality |
        sexual\s+intercourse | have\s+sex | make\s+love | sleep\s+with |
        porn\w* | pornographic | obscene | obscenit\w* | lewd\w* | lascivious |
        adult\s+(?:movie|film|video) | blue\s+movie | dirty\s+(?:book|talk|joke) |
        oral\s+sex | jig-?a-?jig | harem | pudenda | floozy | bawd | hussy |
        dirty\s+words | skirt-?chaser | Jezebel | to\s+defile |
        loose\s+woman | horny | pervert | womaniz\w* | procurer | illicit\s+sex |
        sex\s+(?:party|tourist|worker|act) | jerk\s+off | meat\s+stick | pizzle |
        \bdick\b | pussy | twat | testicles | \bsexy\b | in\s+erection |
        lecher\w* | licentious | debauch\w* | promiscu\w* |
        adulter(?:y|ies|ess|ous|ously) |
        incest\w* | rape | raping | rapist\w* | molest\w* | pederast\w* |
        gang\s*rape |
        paedophil\w* | pedophil\w* | prurient | libidinous | lustful |
        erotic\w* | aphrodisiac | nymphomania\w* | fellatio | cunnilingus |
        semen | orgy | orgies | slut\w* |
        cuckold\w* | virginity | deflower\w* | seduc\w* | striptease |
        condom | brothel-keeper
    ''',
    'profanity': r'''
        fuck\w* | cunt\w* | shit(?:s|ty|tier|ting|head|hole|bag)?\b | bullshit | crap\b | arsehole | asshole\w* |
        arse\b | bastard\w* | bitch\w* | bugger\w* | wank\w* | piss\w* |
        turd(?:s)?\b | faec\w* | fec[ae]s | excrement |
        fart\w* | damn\s+you | god\s?damn\w* | bloody\s+hell |
        son\s+of\s+a\s+bitch | motherfuck\w* | dick\s*head |
        scumbag | swear\s?word\w* | curse\s?word\w* |
        vulgar\s+(?:term|word|slang|joke) | coarse\s+language | foul\s+language |
        WTF |
        swearing | profanit\w*
    ''',
    'slurs': r'''
        nigger\w* | gook\b | kike\b |
        wetback\w* | raghead\w* | towelhead\w* |
        tranny | shemale |
        retard(?:ed|s)?\b | imbecile | moron(?:s|ic)?\b | cretin\w* | mongoloid |
        halfwit\w* | half-wit\w* | savage\s+(?:race|people) |
        barbarian\s+slur | derogatory\s+(?:term|name|word) |
        pejorative\s+(?:term|name|word|for) | racial\s+slur | ethnic\s+slur |
        term\s+of\s+abuse | abusive\s+term | insulting\s+term
    ''',
    # Deliberately narrow: graphic cruelty and recreational narcotics, not the
    # ordinary vocabulary of news and history. 杀 (to kill), 死 (to die),
    # 打架 (to fight), 警察 (police), 监狱 (prison) and 战争 (war) are how
    # people talk about the world and stay exactly where they are.
    'violence': r'''
        torture\w* | tortured | behead\w* | decapitat\w* | disembowel\w* |
        dismember\w* | mutilat\w* | flay\w* | impale\w* | garrot\w* |
        crucify | crucified | crucifixion | lynch\w* | eviscerat\w* | maim\w* |
        gouge\s+out | slit\s+(?:the\s+)?throat | cannibal\w* | necrophil\w* |
        heroin | cocaine | crack\s+cocaine | methamphetamine | amphetamine\w* |
        opium\s+den | marijuana | cannabis | hashish |
        junkie\w* | drug\s+addict\w* | shoot\s+up\s+drugs | overdose
    ''',
}

# Innocent phrasings that would otherwise trip the patterns above. Checked
# first: anything matching here is never flagged, whatever else it contains.
ALLOW = r'''
    rape\s?seed | rapeseed | rape[-\s]?turnip | canola | brassica | turnip |
    bastard\s+(?:carp|fish|wing|title|file|saffron|balm|toadflax) |
    chink\s+(?:in|of) | crack\s*,\s*chink |
    to\s+retard | retard\s+(?:the|growth|development|progress|ation) |
    (?:oilseed|edible|field)\s+rape | rape\s+(?:plant|flower|blossom|oil|seed) |
    rape\s+(?:and|or)\s+(?:coriander|mustard|cabbage|turnip) |
    dung\s+beetle | manure | fertiliser | fertilizer | compost |
    to\s+prick | prick\s+(?:a|the)\s+ | pinprick |
    adulterate\w* | adulteration |
    impotent\s*(?:,|;|$) | powerless |
    social\s+intercourse | intercourse\s+(?:between|among|with)\s+(?:nations|countries|people) |
    verbal\s+intercourse | commercial\s+intercourse |
    analy\w* | analog\w* | analges\w* | canal\b | anal\s+(?:retentive|region\s+of\s+an\s+insect) |
    spermato\w* | angiosperm\w* | gymnosperm\w* | sperm\s+whale |
    faggots?\s*(?:,|;|$)(?![^;]*(?:gay|homosexual|pejorative)) |
    firewood[^;]*faggot | faggot[^;]*(?:firewood|fuel|sticks|bundle) |
    dike\b | dyke\s*(?:,|;|$) | embankment | levee |
    tart\s+(?:flavou?r|taste|fruit|apple|cherry) | tartar |
    crap[py]\s+(?:crop|harvest) |
    seduc\w*\s+(?:into\s+)?(?:learning|reading|study) |
    moron\w*\s+(?:acid|ic\s+acid) |
    negro\s+(?:river|spiritual) |
    crack\s+(?:in|of|the\s+whip|down|open|a\s+joke) |
    cannabis\s+(?:sativa\s+used\s+for\s+(?:rope|fibre|fiber)|hemp\s+fibre) |
    smart\s+as\s+a\s+whip
'''

# Headwords the patterns cannot reach, found by reading the output. Each is
# an entry whose blunt sense was removed and whose remaining sense is a
# one-word euphemism — 人尽可夫 left as "loose", 色情 left as "sex" — too
# vague to catch by rule without also deleting 鸭子 ("duck") and 偏房
# ("side room"). Patterns do the work; this is the tail.
ALWAYS_REMOVE = {
    '人尽可夫', '人盡可夫', '奸污', '姦污', '姦汙', '拉皮条', '拉皮條',
    '色情', '姤', '色鬼', '淫棍', '淫媒', '淫猥', '淫风', '淫風',
    '流泆', '兽行', '獸行', '小太太', '正室', '妾室', '偏室',
    '十三点', '十三點', '低能儿', '低能兒', '痴汉', '癡漢',
    '翘硬', '翹硬', '射出', '性高潮', '口交', '肛交', '群交',
    '泼贱人', '潑賤人', '贱人', '賤人', '色狼', '妈妈桑', '媽媽桑',
    '强暴', '強暴', '淫妇', '淫婦', '小妖精', '登徒子',
    '花心大萝卜', '花心大蘿蔔', '淫词亵语', '淫詞褻語',
}

FLAGS = re.IGNORECASE | re.VERBOSE
ALLOW_RE = re.compile(r'(?:%s)' % ALLOW, FLAGS)
# Both boundaries. Without the trailing one, "heroin" matches inside
# "heroine", "condom" inside "condominium" and "turd" inside "Turdus" — and a
# dictionary quietly loses its thrushes and its heroines.
CATEGORY_RE = {name: re.compile(r'\b(?:%s)\b' % body, FLAGS) for name, body in CATEGORIES.items()}


def classify(sense):
    """Return (category, trigger) for one sense, or None if it is fine."""
    if not sense or not sense.strip():
        return None
    if ALLOW_RE.search(sense):
        return None
    for name, rx in CATEGORY_RE.items():
        m = rx.search(sense)
        if m:
            return name, re.sub(r'\s+', ' ', m.group(0)).lower()
    return None


# ---------------------------------------------------------------------------
# Splitting a definition into senses
# ---------------------------------------------------------------------------

def _sub_senses(sense):
    """Split one sense into the smallest pieces still worth judging.

    Semicolons always separate. Commas only do when the sense reads as a
    list of glosses rather than as prose: "firewood, faggots, fuel" is three
    glosses and only the middle one is a problem, but "Xingtian, headless
    giant hero of Chinese mythology decapitated by the Yellow Emperor" is one
    sentence, and splitting it leaves the useless stub "Xingtian" behind
    instead of removing the entry.
    """
    out = []
    for chunk in sense.split(';'):
        bits = chunk.split(',')
        if len(bits) > 1 and all(len(b.strip()) <= 24 for b in bits):
            out.extend(bits)
        else:
            out.append(chunk)
    return out


# What is left when a definition is only bookkeeping: a classifier, a
# cross-reference, an abbreviation note. Useful beside a real definition and
# useless on its own — 避孕套 reduced to "CL:隻|只[zhi1]" tells nobody anything.
METADATA_ONLY = re.compile(
    r"^\s*(?:CL[:：]|variant\s+of|see\s+also|see\s+\S|abbr\.?|also\s+written"
    r"|old\s+variant|erhua\s+variant|Taiwan\s+pr\.?|surname\s*$|\([^)]*\)\s*$)",
    re.IGNORECASE)


def is_metadata_only(text):
    """Whether a definition has been reduced to bookkeeping."""
    if not text.strip():
        return True
    parts = [x for x in text.split('/') if x.strip()]
    return bool(parts) and all(METADATA_ONLY.match(x) for x in parts)


def clean_definition(text, top_split, joiner):
    """Drop the offending pieces of a definition and keep the rest.

    Two levels, and the order matters. A definition is split into senses by
    its top-level separator, then each sense into comma- and semicolon-
    delimited pieces, and only the failing *piece* is discarded. Judging a
    whole sense at once takes "sour" away from 酸 because "tart" sits next
    to it, and "lovable, tender" away from 娇 to get at "seductive".

    Returns (cleaned_text, [(category, trigger, piece), ...]). A definition
    with nothing wrong comes back byte-identical, so clean files do not churn.
    """
    kept_senses, dropped = [], []
    for sense in top_split(text):
        pieces = _sub_senses(sense)
        kept_pieces = []
        for piece in pieces:
            if not piece.strip():
                continue
            verdict = classify(piece)
            if verdict:
                dropped.append((verdict[0], verdict[1], piece.strip()))
            else:
                kept_pieces.append(piece.strip())
        if kept_pieces:
            # rebuild with commas; the original punctuation inside a single
            # sense carries no meaning worth preserving exactly
            kept_senses.append(', '.join(kept_pieces))
    if not dropped:
        return text, []
    cleaned = joiner.join(kept_senses).strip()
    cleaned = re.sub(r'\s{2,}', ' ', cleaned).strip(' ;,/')
    return cleaned, dropped


def split_cedict(text):
    """CC-CEDICT separates senses with a forward slash."""
    return text.split('/')


def split_gloss(text):
    """Make Me a Hanzi uses semicolons between senses."""
    return text.split(';')


# ---------------------------------------------------------------------------
# The pass over each file
# ---------------------------------------------------------------------------

def load(name):
    with open(os.path.join(DATA, name), encoding='utf-8') as fh:
        return json.load(fh)


def save(name, obj, dry):
    if dry:
        return
    path = os.path.join(DATA, name)
    with open(path, 'w', encoding='utf-8') as fh:
        json.dump(obj, fh, ensure_ascii=False, separators=(',', ':'))


class Log:
    """Collects what happened, for the report and the summary line."""

    def __init__(self):
        self.rows = []
        self.counts = Counter()

    def add(self, where, headword, reading, action, category, trigger):
        self.rows.append((where, headword, reading, action, category, trigger))
        self.counts[(where, action)] += 1
        self.counts[('category', category)] += 1


def run(dry=False):
    log = Log()

    hsk = load('hsk.json')
    # The syllabus. Nothing in here is ever deleted — see the note at the top.
    hsk_words = {w['s'] for w in hsk} | {w['t'] for w in hsk if w.get('t')}
    hsk_chars = {c for w in hsk for c in w['s']} | {c for w in hsk if w.get('t') for c in w['t']}

    # ---- 1. HSK glosses: clean the wording, keep every word ----
    for w in hsk:
        cleaned, dropped = clean_definition(w['e'], split_gloss, '; ')
        if dropped and cleaned:
            for cat, trig, _ in dropped:
                log.add('hsk.json', w['s'], w['p'], 'sense dropped', cat, trig)
            w['e'] = cleaned
        elif dropped:
            for cat, trig, _ in dropped:
                log.add('hsk.json', w['s'], w['p'], 'KEPT (syllabus, no clean sense)', cat, trig)
    save('hsk.json', hsk, dry)

    # ---- 2. Characters ----
    hanzi = load('hanzi.json')

    # Work out which characters will not survive before rewriting anything,
    # so a mnemonic that points at one of them can be cleared in the same pass.
    gone_chars = set()
    for h in hanzi:
        cleaned, dropped = clean_definition(h.get('d') or '', split_gloss, '; ')
        if dropped and not cleaned and not (h.get('lv') or h['c'] in hsk_chars):
            gone_chars.add(h['c'])

    kept_hanzi, removed_chars = [], set()
    for h in hanzi:
        gloss = h.get('d') or ''
        cleaned, dropped = clean_definition(gloss, split_gloss, '; ')

        # The etymology note is a sentence, not a list of senses, so there is
        # no clean half to keep: 霪 is explained as "an obscene 淫 amount of
        # rain", where obscene means excessive and 淫 is the phonetic part.
        # A mnemonic is a convenience — drop the whole note rather than
        # mangle it, and drop it too when it leans on a character that is
        # no longer here to be leaned on.
        note = h.get('h') or ''
        if note:
            if classify(note) or any(ch in note for ch in gone_chars):
                h['h'] = ''
                log.add('hanzi.json', h['c'], (h.get('p') or [''])[0],
                        'etymology note cleared', 'sexual' if classify(note) else 'reference', 'mnemonic')

        if not dropped:
            kept_hanzi.append(h)
            continue

        protected = bool(h.get('lv')) or h['c'] in hsk_chars
        cat, trig = dropped[0][0], dropped[0][1]
        if h['c'] in ALWAYS_REMOVE and not protected:
            removed_chars.add(h['c'])
            log.add('hanzi.json', h['c'], (h.get('p') or [''])[0], 'removed', cat, 'review')
            continue

        if cleaned and not is_metadata_only(cleaned):
            h['d'] = cleaned
            kept_hanzi.append(h)
            log.add('hanzi.json', h['c'], (h.get('p') or [''])[0], 'sense dropped', cat, trig)
        elif protected:
            # An HSK character whose every sense reads badly. Keep the
            # character — it is on the syllabus — but say nothing coarse.
            h['d'] = ''
            kept_hanzi.append(h)
            log.add('hanzi.json', h['c'], (h.get('p') or [''])[0], 'gloss cleared (syllabus)', cat, trig)
        else:
            removed_chars.add(h['c'])
            log.add('hanzi.json', h['c'], (h.get('p') or [''])[0], 'removed', cat, trig)
    save('hanzi.json', kept_hanzi, dry)

    # ---- 3. The dictionary ----
    cedict = load('cedict.json')

    # Decided in two passes. CC-CEDICT holds one row per reading, so 鸟 has a
    # niǎo row meaning "bird" and a second, vulgar row under another reading.
    # Protecting the headword protects both, and the coarse row rides along on
    # the strength of the bird. So each row is judged on its own first, and the
    # syllabus rule is applied afterwards — an HSK word never disappears from
    # the dictionary, but one obscene sense-entry of it can, as long as the
    # word is still defined somewhere.
    decided = []          # (row, action, cleaned, category, trigger)
    for row in cedict:
        simp, trad, reading, defn = row[0], row[1], row[2], row[3]
        if simp in ALWAYS_REMOVE or trad in ALWAYS_REMOVE:
            decided.append((row, 'remove', None, 'sexual', 'review'))
            continue
        cleaned, dropped = clean_definition(defn, split_cedict, '/')
        if not dropped:
            decided.append((row, 'keep', defn, None, None))
        elif cleaned and not is_metadata_only(cleaned):
            decided.append((row, 'trim', cleaned, dropped[0][0], dropped[0][1]))
        else:
            decided.append((row, 'remove', None, dropped[0][0], dropped[0][1]))

    # Which headwords would still have a definition after all that?
    still_defined = set()
    for row, action, cleaned, _cat, _trig in decided:
        if action != 'remove':
            still_defined.add(row[0])
            if row[1]:
                still_defined.add(row[1])

    kept_cedict, removed_words = [], set()
    for row, action, cleaned, cat, trig in decided:
        simp, trad, reading = row[0], row[1], row[2]
        if action == 'keep':
            kept_cedict.append(row)
            continue
        if action == 'trim':
            row[3] = cleaned
            kept_cedict.append(row)
            log.add('cedict.json', simp, reading, 'sense dropped', cat, trig)
            continue
        # action == 'remove'
        on_syllabus = simp in hsk_words or trad in hsk_words
        if on_syllabus and simp not in still_defined and trad not in still_defined:
            # The only entry for a word the course teaches. Keep the row so the
            # word can still be looked up, but say nothing coarse in it.
            row[3] = ''
            kept_cedict.append(row)
            log.add('cedict.json', simp, reading, 'definition cleared (syllabus)', cat, trig)
            continue
        removed_words.add(simp)
        if trad:
            removed_words.add(trad)
        log.add('cedict.json', simp, reading, 'removed', cat, trig)
    save('cedict.json', kept_cedict, dry)

    # A headword that survives somewhere else in the dictionary is still a
    # word the site knows, so it must not be treated as blocked downstream.
    surviving = {r[0] for r in kept_cedict} | {r[1] for r in kept_cedict if r[1]}
    blocked = (removed_words | removed_chars) - surviving - hsk_words - hsk_chars

    # The list is remembered rather than recomputed. Once the dictionaries have
    # been cleaned there is nothing left for this run to remove, so a run over
    # a half-filtered repository would compute an empty set and quietly leave
    # the question bank full of items asking about words that no longer exist.
    previous = set()
    if os.path.exists(BLOCKED):
        with open(BLOCKED, encoding='utf-8') as fh:
            previous = {ln.strip() for ln in fh
                        if ln.strip() and not ln.startswith('#')}
    blocked |= previous
    blocked -= hsk_words | hsk_chars
    if not dry and blocked:
        with open(BLOCKED, 'w', encoding='utf-8') as fh:
            fh.write('# LearneCN — headwords removed from the shipped data.\n'
                     '# Written by tools/filter-vocabulary.py. Kept so the tool can\n'
                     '# clean the question bank on a repository whose dictionaries\n'
                     '# have already been filtered. One headword per line.\n')
            fh.write('\n'.join(sorted(blocked)) + '\n')

    # ---- 4. Questions that ask about something no longer here ----
    qdir = os.path.join(DATA, 'questions')
    dropped_q = 0
    repaired_q = 0
    manifest_path = os.path.join(qdir, 'index.json')

    blocked_chars = {w for w in blocked if len(w) == 1}
    blocked_words = {w for w in blocked if len(w) > 1}
    # The target of a generated question sits inside corner brackets:
    # 「绍」的部首是？ — so that is where to look for it.
    TARGET = re.compile(r'[「『]([^」』]{1,8})[」』]')

    def is_blocked(text):
        text = str(text)
        return (text in blocked_words or text in blocked_chars
                or any(ch in text for ch in blocked_chars))

    def verdict(q):
        """What to do with one question: 'keep', 'repair' or 'drop'.

        Substring matching is not good enough here. 做小 ("to be someone's
        concubine") is a blocked entry, and it also sits inside 做小买卖 and
        做小学生; 讨人 is blocked, and 讨人喜欢 means likeable. Matching
        loosely takes fifty good questions with every bad one.

        And most of what does match is a question that is entirely fine
        except for one of its wrong answers. 「快照」("snapshot") is a
        perfectly good question that happens to have been given an obscene
        distractor. Those get the distractor replaced, not the question
        deleted.
        """
        stem = ' '.join(str(q.get(k, '')) for k in ('q', 'note', 'passage', 'speak'))
        if any(ch in stem for ch in blocked_chars):
            return 'drop'
        for target in TARGET.findall(str(q.get('q', ''))):
            if target in blocked_words or target in blocked_chars:
                return 'drop'
        choices = [str(c) for c in (q.get('choices') or [])]
        answer = q.get('answer')
        bad = [i for i, c in enumerate(choices) if is_blocked(c)]
        if not bad:
            return 'keep'
        if isinstance(answer, int) and answer in bad:
            return 'drop'          # the right answer is the problem
        return 'repair'

    def build_pool(rows):
        """Clean choice strings from this shard, grouped by character length.

        Drawing replacements from the same file keeps a distractor plausible:
        the same script (a 繁体 question keeps traditional options), the same
        register, the same rough difficulty.
        """
        pool = defaultdict(set)
        for q in rows:
            for c in q.get('choices') or []:
                c = str(c)
                if c and not is_blocked(c):
                    pool[len(c)].add(c)
        return {k: sorted(v) for k, v in pool.items()}

    def repair(q, pool, seed):
        """Swap each blocked distractor for a clean one of the same length."""
        choices = [str(c) for c in q['choices']]
        answer = q.get('answer')
        for i, c in enumerate(choices):
            if not is_blocked(c) or i == answer:
                continue
            # Prefer a replacement of exactly the same length, then the
            # nearest length available. A seventeen-character distractor in
            # an idiom question needs another sentence, not a single word,
            # but it does not need one of exactly seventeen characters.
            lengths = sorted(pool, key=lambda n: (abs(n - len(c)), n))
            picked = None
            for length in lengths:
                candidates = pool[length]
                start = seed % max(1, len(candidates))
                for k in range(len(candidates)):
                    cand = candidates[(start + k) % len(candidates)]
                    if cand not in choices:
                        picked = cand
                        break
                if picked is not None:
                    break
            if picked is None:
                return False
            choices[i] = picked
        q['choices'] = choices
        return True

    if os.path.isdir(qdir) and blocked:
        for name in sorted(os.listdir(qdir)):
            if not name.endswith('.json') or name == 'index.json':
                continue
            path = os.path.join(qdir, name)
            with open(path, encoding='utf-8') as fh:
                rows = json.load(fh)
            if not isinstance(rows, list):
                continue
            pool = build_pool(rows)
            keep = []
            touched = False
            for n, q in enumerate(rows):
                what = verdict(q)
                if what == 'keep':
                    keep.append(q)
                    continue
                touched = True
                if what == 'repair' and repair(q, pool, (n * 2654435761) & 0xffff):
                    keep.append(q)
                    repaired_q += 1
                else:
                    dropped_q += 1
            # A repair changes a question without changing how many there are,
            # so writing only when the count moves loses every shard that was
            # repaired but had nothing removed.
            if touched and not dry:
                with open(path, 'w', encoding='utf-8') as fh:
                    json.dump(keep, fh, ensure_ascii=False, separators=(',', ':'))

        # The manifest counts questions, so it has to be recounted.
        if not dry and os.path.exists(manifest_path):
            manifest = defaultdict(dict)
            for name in sorted(os.listdir(qdir)):
                m = re.match(r'^L(\d+)-([a-z]+)-(\d+)\.json$', name)
                if not m:
                    continue
                lvl, sec, page = m.group(1), m.group(2), int(m.group(3))
                with open(os.path.join(qdir, name), encoding='utf-8') as fh:
                    rows = json.load(fh)
                slot = manifest[lvl].setdefault(sec, {'pages': 0, 'count': 0})
                slot['pages'] = max(slot['pages'], page)
                slot['count'] += len(rows)
            with open(manifest_path, 'w', encoding='utf-8') as fh:
                json.dump(manifest, fh, ensure_ascii=False, separators=(',', ':'))

    # ---- report ----
    write_report(log, blocked, dropped_q, repaired_q, dry)

    print(f'\n{"Would remove" if dry else "Removed"}:')
    for where in ('hsk.json', 'hanzi.json', 'cedict.json'):
        rem = log.counts[(where, 'removed')]
        sen = log.counts[(where, 'sense dropped')]
        cleared = log.counts[(where, 'gloss cleared (syllabus)')]
        kept = log.counts[(where, 'KEPT (syllabus, no clean sense)')]
        print(f'  {where:<14} {rem:>5} entries, {sen:>4} senses trimmed'
              + (f', {cleared} glosses cleared' if cleared else '')
              + (f', {kept} kept as syllabus' if kept else ''))
    print(f'  {"questions":<14} {dropped_q:>5} removed, {repaired_q} repaired '
          f'(a good question with one obscene distractor keeps its question)')
    by_category = [f'{k[1]} {v}' for k, v in sorted(log.counts.items()) if k[0] == 'category']
    if by_category:
        print('\nBy category: ' + ', '.join(by_category))
    print(f'\nFull report: tools/vocabulary-report.txt')

    # --check is a gate, not a preview: it fails when there is anything left
    # to remove, so a refreshed CC-CEDICT cannot quietly put any of this back.
    outstanding = sum(v for k, v in log.counts.items() if k[0] != 'category') + dropped_q + repaired_q
    if dry and outstanding:
        print(f'\nFAIL: {outstanding} change(s) outstanding. '
              f'Run tools/filter-vocabulary.py and commit the result.')
        return 1
    if dry:
        print('\nThe shipped data is clean.')
    return 0


def write_report(log, blocked, dropped_q, repaired_q, dry):
    """An audit trail: what went, and which word triggered it.

    The offending definitions are deliberately not reproduced here — the
    trigger term is enough to argue with a decision, and copying the glosses
    into a second file would defeat the point of removing them from the first.
    """
    if dry:
        return
    if not log.rows and not dropped_q and not repaired_q:
        # A second run over already-clean data finds nothing, which is the
        # point of being idempotent — but rewriting the report with zeros
        # would throw away the record of what the first run did.
        return

    # A run that only cleaned the question bank — the usual case on a
    # repository whose dictionaries arrived already filtered — has no
    # per-entry rows of its own. Rewriting the file from those would leave a
    # sixteen-line stub where a thousand lines of audit trail used to be, so
    # the existing table is carried forward and only the summary is restated.
    table = []
    if log.rows:
        for row in sorted(log.rows, key=lambda r: (r[0], r[4], r[1])):
            where, word, reading, action, cat, trig = row
            table.append(f'{where:<13} {word:<10} {(reading or "")[:15]:<16} '
                         f'{action:<32} {cat:<10} {trig}')
    elif os.path.exists(REPORT):
        with open(REPORT, encoding='utf-8') as fh:
            previous = fh.read().split('-' * 78)
        if len(previous) >= 3:
            table = [ln for ln in previous[-1].splitlines() if ln.strip()]

    lines = [
        'LearneCN — vocabulary filter report',
        '',
        'Generated by tools/filter-vocabulary.py. Every line is a change that',
        'tool made to the shipped data. "trigger" is the word that caused it;',
        'the offending definitions themselves are not repeated here.',
        '',
        'Official HSK 1-6 vocabulary is never deleted. The most that happens to',
        'an HSK word is that one sense is dropped from its gloss.',
        '',
        f'{len(blocked)} headwords are gone from the data entirely.',
        f'{dropped_q} practice questions were about one of them and went with it.',
        f'{repaired_q} more had an obscene wrong answer swapped for a clean one and were kept.',
        '',
        '-' * 78,
        f'{"file":<13} {"word":<10} {"reading":<16} {"action":<32} {"category":<10} trigger',
        '-' * 78,
    ]
    lines.extend(table)
    with open(REPORT, 'w', encoding='utf-8') as fh:
        fh.write('\n'.join(lines) + '\n')


if __name__ == '__main__':
    sys.exit(run(dry='--check' in sys.argv))
