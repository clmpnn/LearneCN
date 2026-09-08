# LearneCN

[![Site](https://img.shields.io/website?url=https%3A%2F%2Fclmpnn.github.io%2FLearneCN%2F&label=site&up_message=live&up_color=a82a1c)](https://clmpnn.github.io/LearneCN/)
[![CI](https://github.com/clmpnn/LearneCN/actions/workflows/ci.yml/badge.svg)](https://github.com/clmpnn/LearneCN/actions/workflows/ci.yml)
[![Licence: GPL-3.0-or-later](https://img.shields.io/badge/licence-GPL--3.0--or--later-a82a1c)](LICENSE)

A free Mandarin study site: spaced repetition over HSK 1–6 words, characters and
grammar, hanzi stroke-order practice, tone training, pinyin and zhuyin charts, and
a built-in Chinese–English dictionary. Static files only — no build step, no
framework, no server code.

**→ [clmpnn.github.io/LearneCN](https://clmpnn.github.io/LearneCN/)**

Companion to [LearneJP](https://clmpnn.github.io/LearneJP/html/index.html).

## Contents

- [Running it](#running-it) · [Publishing](#publishing) · [Pages](#pages)
- [How the studying works](#how-the-studying-works) — one item, several cards; FSRS; your data
- [The order things come in](#the-order-things-come-in) — the syllabus, grammar, interference, the question bank, the path
- [Keeping it clean](#keeping-it-clean) — what the vocabulary filter takes out, and why so little
- [On a phone](#on-a-phone) — offline, and the things only iOS needs
- [Data](#data) · [Stroke data](#stroke-data) · [Things worth knowing](#things-worth-knowing)
- [Checks](#checks) · [Repository layout](#repository-layout) · [Licence](#licence)

---

## Running it

Everything is fetched over `http`, so opening `index.html` straight off disk will fail on
the data files. Serve the folder instead.

**Serve from the repo root, not from `html/`.** The pages load `../css`, `../js` and
`../data`, so those paths fall outside the server root if you start it one level down.

macOS / Linux:

```sh
cd LearneCN
python3 -m http.server 8000
```

Windows PowerShell — `python3` is not a Windows command, use the `py` launcher:

```powershell
cd LearneCN
py -m http.server 8000
```

No Python or Node installed? There is a dependency-free server in the repo:

```powershell
cd LearneCN
powershell -ExecutionPolicy Bypass -File .\serve.ps1
```

With Node:

```sh
cd LearneCN
npx http-server . -p 8000
```

In WebStorm or another JetBrains IDE, skip the terminal entirely: right-click
`html/index.html` in the Project pane and choose **Open in Browser**. The built-in
server uses the project root as its base, so the relative paths resolve.

Then open <http://localhost:8000>.

## Publishing

Push to a repository named `LearneCN`, then **Settings → Pages → Source: Deploy from a
branch → `main` / `(root)`**. The site lands at `https://<user>.github.io/LearneCN/`.

Deploy from a branch, not from Actions. The site has no build step, and an Actions
deploy would re-upload the whole question bank as an artifact on every push. The
workflow in `.github/workflows/ci.yml` therefore validates rather than deploys.

Two files exist purely for Pages:

- **`.nojekyll`** — stops Jekyll from processing the site. Without it, Jekyll drops any
  path beginning with `_` and tries to interpret `{{ … }}` inside the data files as
  template syntax, which fails the build. It must stay, and it must stay empty.
- **`404.html`** — served for any path Pages cannot find, at any depth. Every link inside
  it is absolute from the site root (`/LearneCN/…`) for that reason. On a custom domain,
  change that prefix to `/`.

GitHub Pages is case-sensitive even when macOS and Windows are not, so `../CSS/main.css`
works locally and 404s in production. `tools/validate.py` catches that before you push.

## Pages

| Page | What it does |
| --- | --- |
| `html/index.html` | Home. A character writes itself inside the moon gate. |
| `html/path.html` | The route from nothing to HSK 6, thirty stages, one thing to do next. |
| `html/study.html` | Spaced repetition. The main way to use the site. |
| `html/writing.html` | Trace characters stroke by stroke, and search the dictionary. |
| `html/characters.html` | Pinyin initials, finals and tones; zhuyin; HSK 1–6 characters. |
| `html/practice.html` | Quizzes across five sections and six levels, plus a timed mock paper. |
| `html/progress.html` | Retention, forecast, HSK coverage, tone confusions, export/import. |
| `html/add.html` | Write your own questions and download the updated file. |

## How the studying works

Most vocabulary apps show you a word, mark you right or wrong, and pick the next
one at random. That wastes reviews on words you already know and lets the shaky
ones rot. `html/study.html` schedules instead.

**One item, several cards.** A word is not one memory. Reading 生日 and producing
it from "birthday" are separate skills that decay at different rates, so each
direction gets its own schedule:

| Card | Asks for |
| --- | --- |
| 认读 Recognition | Chinese → meaning |
| 默写 Production | meaning → Chinese, typed |
| 拼音 Pinyin | Chinese → reading with its tone |
| 听力 Listening | audio only → what you heard |
| 书写 Handwriting | draw it in the 田字格 with no outline |
| 声调 Tone | which of 妈 麻 马 骂 was that |
| 语法 Grammar | the pattern, and the word the sentence turns on |

Recognition always comes first. The rest unlock only once recognition is holding —
drilling production of a word you cannot yet read builds nothing.

Tone and grammar items are their own kind and get one card each, because 把 is not
a shape you read off a page and gloss. They still decay like everything else, which
is the whole reason they belong to the scheduler rather than to a page of notes read
once and never again: 把 learned in March and never met after it is 把 forgotten by
June.

**FSRS.** The scheduler in `js/srs.js` is an implementation of
[FSRS](https://github.com/open-spaced-repetition/fsrs4anki), the open algorithm
Anki uses. It tracks three numbers per card — stability, difficulty and
retrievability — and models forgetting as a power law rather than an exponential,
which is why a word seen five times can safely wait a year. You set the retention
you want; it computes the intervals that deliver it.

`tools/test-srs.js` checks the model against the properties it is supposed to
have, including a seventy-day simulated learner at three different retention
targets. Run it with `node tools/test-srs.js`.

**Your data.** Progress lives in `localStorage` and nowhere else. Nothing is sent
anywhere. The Progress page exports it to a file and reads it back, which is the
only way to move it between browsers or devices.

## The order things come in

**Teaching order.** `tools/build-learning-data.py` sorts the syllabus before you
ever see it, and it weighs two costs rather than one.

The first is the one a dependency graph can see. Meeting 森 before 木 costs two
memorisations instead of one, so components are sorted ahead of the characters
built from them — 木, then 林, then 森 — and words are ordered so each leans on
characters already introduced.

The second is the one it cannot. Ordering on cheapness alone produced a syllabus
that opened with the ten numerals and six bare strokes (丨 丿 乙 乚 亅 乛), put 是
at word 74, 什么 at 109, 对不起 at 143 and 谢谢 at **146 of 150** — and never
taught 你好 at all, because 你好 is two words and the HSK list is a word list. A
learner who cannot say thank you after three months has not been well served by
saving them two character lookups.

So value leads. The opening stretch is written by hand in
`tools/beginner-path.json`, ordered by what a person can actually say, and the
component rule is kept as a strong preference that a high-value word is allowed
to outvote. 谢谢 costs two brand-new characters and is taught eighth anyway.
Everything past HSK 2 goes back to being computed, because by then enough
characters are in place that reuse is the strongest signal there is.

| | before | after |
| --- | --- | --- |
| 你好！ | never taught | word 1 |
| 我叫…，你叫什么名字？ | 110 | 15 |
| 对不起。——没关系。 | 144 | 28 |
| 这是我的朋友。 | 131 | 31 |
| 我不是老师，我是学生。 | 121 | 33 |
| mean over ten ordinary sentences | 128 | 49 |

What the trade costs is printed, not hidden: 937 of 9,526 characters now arrive
before one of their own components, 300 of those inside HSK 1–6. None of them are
the pairs that matter — 木 still precedes 林 and 森, 日 and 月 still precede 明.

**Grammar.** The bank held 343,562 questions and eighty-six of them were about
grammar — eight per level from HSK 3 up, for levels that introduce two and a half
thousand words between them. That is a fact about how the files were made, not a
judgement about what a learner needs: vocabulary and characters were generated and
so there were hundreds of thousands of them, grammar was hand-written and so there
were eight. The syllabus ordered 9,526 characters, 4,998 words and no patterns at
all.

`tools/grammar-points.json` is the missing half, hand-written: 201 points across
HSK 1–6, each with the shape it teaches, the words it needs, the points it depends
on, the points it gets fused with, and worked examples.

It goes through the same mill as the vocabulary, for the same reasons.

- **A point is placed where it becomes learnable, not where its level starts.** 把
  is HSK 3 and needs a result complement behind the verb, which is HSK 2. 只有…才 is
  only worth teaching once 只要…就 exists to be confused with. Each point is anchored
  at the position where the word syllabus has finished teaching what it needs, and
  Kahn's algorithm then walks the prerequisite graph taking whichever available point
  the syllabus reaches first. A cycle is a build error, not a warning.
- **The level is a floor, not a tie-break.** 对…来说 needs 对, which is HSK 2, and
  来说, which is on no list at all — anchored on words alone it landed at point 39,
  between 让 and 还, and an HSK 4 frame is not the fortieth thing a beginner meets.
  Where the words push a point later than its level they win; they never pull it
  earlier. 65 of the 201 are held back this way, and the number is printed.
- **The confusions are spaced apart.** 不免 and 不禁 differ by whether what follows is
  a feeling or an action, and met on consecutive days they become one wrong memory
  inside a week. The same greedy that separates 天 from 夫 separates them, with the
  guard that it may not pull a point in front of something it depends on. One pair
  out of 201 still sits within four positions: 倘若 and 假如, at the very end, where
  the syllabus has run out of room to move them.

`tools/build-grammar-questions.py` then turns each point into drills — the example
with its own word taken out, the sentence and which of four shapes it uses, the shape
and which of four sentences uses it — with the distractors drawn from the points the
syllabus already believes get fused with this one, because a cloze whose wrong answers
are unrelated tests reading rather than grammar. A candidate sentence that could also
be an example of the point being asked about is dropped rather than offered:
「我不是老师，我是学生。」 is filed under 不 and is a perfectly good example of 是,
and a question with two right answers is worse than no question. **1,091 grammar questions**,
up from 86. The eighty-six are not replaced — they were written as whole small lessons
rather than as one point drilled, they are good, and they lead each level, kept in
`tools/grammar-written.json` so regenerating the bank cannot lose them.

**Interference.** Look-alikes and tone twins are the two things a learner most
reliably fuses into one wrong memory, and the data to avoid it — `confusables`
and `tones` — was already being computed and then used only to *test* on the
confusion afterwards. A final pass now spaces those groups at least twelve
positions apart, the same greedy `srs.js` uses to keep two cards for one word
out of the same session. Collisions inside the first 2,000 characters: 48 before,
0 after. Nothing is dropped and nothing moves far; 天 and 夫 simply stop being
neighbours.

It also precomputes the 317 tone sets used by the tone drills, the look-alike
groups (本 末 未, 天 夫, 我 找), example sentences mined from the question bank,
and an index of which HSK words each character appears in. Everything lands in
`data/learn/` and is regenerated from source, never hand-edited.

**The question bank.** The same problem, one layer down. Every generated
question is about one word or one character, and they were written to disk in
whatever order the generator emitted them — so the practice page's three
orderings were Spaced, By performance, and "In order", which was in no order at
all. Opening HSK 1 vocabulary asked for the traditional form of 怎么样 first and
reached 我 four hundred questions later.

`tools/order-questions.py` sorts all 343,398 generated questions by when the
syllabus introduces their subject, and re-shards each section afterwards. Every
template hides its subject in a different place — 「小」的拼音是？ quotes it,
拼音「shì」写成汉字是？ answers it, 繁体「沒關系」的简体写法是？ quotes the form
you do not study and answers the one you do — so the rule is simply the
earliest-taught thing named anywhere in the row, which covers all fifteen
templates without special-casing any of them. Within one subject the drills run
in an order too: what it means, how it sounds, its tone, its radical, how it is
built, and stroke-count trivia last.

Two things are left alone. Grammar, reading and listening are hand-written and
already in a considered order, and sorting them by subject would break a
sequence somebody chose. And nothing but position changes: the bank re-sorts to
the same 343,398 rows it started with, answers untouched.

It also fixes the pagination. 进阶 vocabulary is 252,684 questions across 64
files, fetched a page at a time — and until now "the first page" meant four
thousand arbitrary questions out of a quarter of a million. Sorted, the first
page is the first page.

**The path.** `html/path.html` is the other half of the same problem. Ordering
decides what comes next; it says nothing about where to start, and the Study page
opens by asking which levels, which material and which card types you want —
three questions a person on their first day cannot answer and has no reason to
care about. The path answers them: thirty stages, each named for what you can say at
the end of it rather than how many words it holds, beginning with the four tones
and no characters at all, because a word stored in a shape your ear cannot
retrieve is not stored. It reads `data/learn/path.json`, works out where you are
from what the scheduler has already seen, and offers exactly one thing to do
next. Nothing about it is a lock — the Study page is still there, with every
level in it, for anyone who would rather choose.

It was ten stages, and five of them were an HSK level with a name on it: 151, 297,
598, 1,300 and 2,499 words, the last budgeted at three hundred days. A stage nobody
can finish is not a stage, and the promise the page makes — one thing to do next —
is not kept by any of them.

| | before | after |
| --- | --- | --- |
| stages from HSK 2 to HSK 6 | 5 | 25 |
| longest stage | 300 days | 40 |
| largest stage | 2,499 words | 313 |
| grammar points shown on the route | 0 | 201 |

Each of the new stages ends at a boundary it declares rather than at a level break:
`untilPoint` a grammar point, so the stage that exists to teach 把 and 被 ends where
the syllabus has taught what they need; `untilWords` a count, for the stretches of
HSK 5 and 6 that really are just vocabulary and say so rather than pretending to a
theme they do not have. Every stage lists the patterns it teaches, which is the half
of a stage a word count cannot show: 「二级」151 words told a learner nothing about
what the level was for, and 把 · 被 · 虽然…但是 tells them exactly.

## Keeping it clean

CC-CEDICT and Make Me a Hanzi are complete references. Documenting everything
the language contains is the right call for a dictionary and the wrong one for
something a beginner opens on a bus, so `tools/filter-vocabulary.py` takes the
obscene material out of the data the site ships. Sexual and obscene terms,
profanity, slurs, and graphic violence and narcotics all go.

The whole design rests on one observation: an entry is rarely dirty, a *sense*
is. 柴 reads "firewood, faggots, fuel", where faggots are bundles of sticks.
堤坝 is "dam; dyke". 骚扰 is HSK 6 and glossed "harass; disturb; molest". 鸫 is
a thrush, genus *Turdus*. Deleting those would take firewood, embankments,
harassment and a songbird out of a Mandarin course. So senses are dropped one
at a time, and an entry only disappears when nothing clean is left of it.

Two rules sit above the rest:

- **Official HSK 1–6 vocabulary is never deleted.** The site exists to teach
  that list and the exam will ask about it either way. The most that happens to
  an HSK word is that a coarse sense is dropped from its gloss — 骚扰 keeps
  "harass; disturb; cause a commotion". A word with two dictionary entries can
  lose the coarse one, as 鸟 does, as long as "bird" still defines it.
- **A good question with one obscene wrong answer keeps its question.** Most of
  what the filter touches in the bank is a perfectly good item — 「快照」,
  "snapshot" — that happens to have been given a crude distractor. Those get the
  distractor swapped for a clean one of the same length drawn from the same
  shard, so the script and register still match. The correct answer is never
  touched; all 374,585 questions still resolve to the answer they had before.

Every change is written to `tools/vocabulary-report.txt` with the term that
triggered it, so the judgement calls can be argued with. The offending
definitions are not repeated there — the trigger word is enough to review a
decision, and copying the glosses into a second file would defeat the point.

```sh
python3 tools/filter-vocabulary.py           # apply
python3 tools/filter-vocabulary.py --check   # exit 1 if anything needs removing
```

The `--check` form runs on every push, so refreshing CC-CEDICT cannot quietly
put any of it back. The term lists live at the top of the script and are meant
to be edited; `ALWAYS_REMOVE` below them is the short tail of entries no pattern
can reach without also deleting 鸭子 ("duck") and 偏房 ("side room").

One related change: tone drills now draw only on characters that appear in
HSK 1–6. Drawing from all 9,534 meant a syllable's tone was often carried by
something like 殍 ("to starve to death") — a contrast nobody needs to hear,
sitting next to two words they use daily.

## On a phone

The site is a progressive web app. On iOS, **Share → Add to Home Screen** gives
it an icon, a launch image and its own window with no Safari chrome, and — the
part that matters — study sessions that keep working with no signal.

**Offline.** `sw.js` precaches the shell, then keeps word lists, question shards
and character stroke data as you actually meet them. Nothing is bulk-downloaded:
the bank is 72 MB and almost nobody studies all of it, so caching a level the
moment it is opened costs a few megabytes and covers the case that matters — a
commute. The Progress page reports what is held and can clear it.

**What iOS needs that nothing else does.** These are all real, and all of them
were silently broken before:

- **Speech.** Safari returns an empty voice list and refuses to speak until the
  page has been touched — no error, just silence. `js/app.js` primes the engine
  with a muted utterance on the first gesture and re-polls for voices, and
  anything that depends on hearing Mandarin asks at the moment it needs to
  rather than caching the answer. Without this, listening cards and the tone
  drills do nothing at all on an iPhone.
- **Input zoom.** A focused field under 16px makes iOS zoom the whole viewport
  in and never zoom back out. Every control clears that bar.
- **Navigation.** Six destinations do not fit across the top of a phone; they
  wrapped to three rows and the sticky header covered most of the screen. On
  narrow viewports they move to a bottom tab bar, labelled with the same
  characters the home page cards use — 复 练 写 音 进 加. It is generated from
  the header links, so it cannot drift out of step with them.
- **Grading with a thumb.** The four buttons sit in a fixed bar above the tab
  bar, the card itself is the "show answer" target, and once the answer is up
  the question collapses — the answer block already repeats it.
- **Safe areas, tap targets and the rest.** `env(safe-area-inset-*)` on the
  chrome, a 44px floor on anything tappable, `touch-action: manipulation` to
  drop Safari's 300ms double-tap delay, no tap highlight, no callout menu on
  the writing pad, and no rubber-band scroll in standalone.

**Regenerating the icons.** `tools/build-ios-assets.py` draws the home-screen
icons and the launch images — 13 device sizes in light and dark, because iOS
matches on exact pixel dimensions and shows a blank white screen when nothing
matches. Needs Pillow. The output is committed; run it only when the mark
changes.

## Data

| File | Rows | Source |
| --- | --- | --- |
| `data/hanzi.json` | 9,534 | [Make Me a Hanzi](https://github.com/skishore/makemeahanzi) — pinyin, meaning, radical, decomposition, etymology, stroke count |
| `data/cedict.json` | 121,100 | [CC-CEDICT](https://cc-cedict.org/) |
| `data/hsk.json` | 5,001 | HSK 2012 official word lists, levels 1–6. 4,995 distinct: six headwords are listed at two levels, and every index in the site takes the earlier one |
| `data/questions/L{level}-{section}-{page}.json` | 344,567 | Entirely in Chinese. Generated vocabulary, character and grammar drills, the full idiom corpus, plus hand-written definitions, grammar, reading and listening |
| `data/questions/index.json` | — | Manifest: how many pages exist for each level and section |
| `data/questions.json` | 0 | Extras file — the Add page writes here, and practice loads it on top of the shards |
| `data/pinyin.json` | 64 | Initials, finals and tones with zhuyin and example words |
| `data/learn/order.json` | — | Teaching order: value-led at the start, computed after HSK 2 |
| `data/learn/grammar.json` | 201 | The grammar syllabus, ordered by when each point becomes learnable |
| `data/learn/path.json` | 30 | The staged route from the four tones to HSK 6 |
| `data/learn/phrases.json` | 3 | 你好, 请问, 好的 — needed on day one, absent from the HSK word list |
| `data/learn/components.json` | — | What each character is built from, and what is built from it |
| `data/learn/tones.json` | 317 | Minimal-pair tone sets, and words grouped by tone contour |
| `data/learn/confusables.json` | 1,200 | Characters that look alike enough to be confused |
| `data/learn/sentences.json` | — | Example sentences mined from the reading and listening items |
| `data/learn/charwords.json` | 2,375 | Which HSK words each character appears in |

Everything under `data/learn/` is generated. Run `python3 tools/build-learning-data.py`
after changing any source list; CI fails if the two drift apart. The hand-written
sources it reads are `tools/beginner-path.json` (the curated opening and the thirty
stages) and `tools/grammar-points.json` (the grammar syllabus).

Question shape:

```json
{
  "level": 3,
  "section": "grammar",
  "q": "请 ___ 门关上。",
  "choices": ["把", "被", "让", "给"],
  "answer": 0,
  "note": "把 moves the object before the verb.",
  "point": "ba",
  "passage": "…",
  "speak": "…"
}
```

Every question, choice and explanation is in Chinese; pinyin appears where the question
is about pronunciation. Fifteen generated types cover every eligible word and character:
word meaning (both directions), word pinyin (both directions), traditional to simplified,
idiom meaning, character reading (both directions), tone, homophone, radical (both
directions), stroke count, structure and composition — plus the hand-written grammar,
reading and listening items.

Levels 1–6 are HSK. Level 7, shown as 进阶, holds everything beyond it: the 6,870
characters that carry stroke and radical data but sit outside the HSK lists, the
20,810-idiom corpus, 12,560 歇后语, and 60,431 dictionary words built entirely from HSK
characters — 305,413 questions on its own.

At that size the bank is sharded by level *and* section, then paginated at 4,000
questions per file, 113 files in all. The practice page reads `index.json`, fetches only
the first page, and pulls the next one when you get within 400 questions of the end of
what is loaded. Opening 进阶 vocabulary costs a single 1.1 MB file rather than the 56 MB
the section contains — and since `tools/order-questions.py` sorts the bank before it
shards it, that first file is the first 4,000 questions of the syllabus rather than
4,000 arbitrary ones. Every generated question is checked for four distinct choices and
exactly one correct answer — distractors for a "which character reads X" question, for
instance, are keyed so no second choice shares that reading.

Word meanings are hand-written rather than pulled from an open Chinese–Chinese
dictionary: those list the classical sense first, glossing 写 as "to play music" and 上班
as "a rank of senior officials", which would teach the wrong thing. `build` checks every
hand-written word really is in the official HSK list and re-places it at the correct level
if not.

`section` is one of `vocabulary`, `characters`, `grammar`, `reading`, `listening`.
`answer` is a 0-based index. `passage` applies to reading, `speak` to listening,
and `point` to a generated grammar drill — it names the syllabus point being
drilled, which is how the practice page's *Only what I've met* filter can tell
whether you have met 「A 是 B」, a thing that is not a headword and would never be
found by looking for one. Listening
items are read aloud by the browser in Mandarin, so no audio files are needed — though
`audio` (a file path) and `image` (a data URL) still work if you prefer to supply them.

## Stroke data

The tracing canvas uses [Hanzi Writer](https://hanziwriter.org) (vendored in `vendor/`)
and pulls per-character stroke paths from jsDelivr on demand. To self-host instead,
`npm pack hanzi-writer-data`, drop the JSON files somewhere in the repo, and point the
`charDataLoader` in `js/writing.js` at them.

## Things worth knowing

- **Simplified / traditional** — the 简 / 繁 switch in the header changes dictionary and
  vocabulary output. It is remembered per browser.
- **Speech** uses the Web Speech API. Browsers without a Mandarin voice installed will say
  so rather than failing silently. Chrome and Safari are the safest bets.
- **Progress** (quiz stats, your own questions) lives in `localStorage` and never leaves
  the browser. There is no account and no server.
- **Keyboard** — `1`–`4` answer, `←` / `→` move.
- **Dark mode** follows the system setting.
- **Contrast** — every piece of visible text on every page clears WCAG AA in both themes.
  Form fields carry a heavier border than the hairline used for separators, because an
  empty field has no text of its own and its outline is the only thing identifying it.
- **Practice what you know** — the Practice page's *Only what I've met* narrows the bank
  to questions about words the scheduler has already introduced. Thirty words into HSK 1
  the unfiltered section offers 593 questions covering 150 words; being asked about the
  other 120 is not practice, it is a test nobody was going to pass.

## Checks

```sh
python3 tools/validate.py          # everything
python3 tools/validate.py --quick  # skip the large shards
```

Parses every JSON file, checks each question has four distinct choices and exactly one
correct answer, confirms `data/questions/index.json` matches the shards on disk and that
page numbers are contiguous, and verifies internal links resolve with the right casing.

Links are checked all the way to the anchor. Stripping the `#fragment` and testing only
the file is how `characters.html#finals` survived review — the file was real, the id was
`finals-groups`, and the link scrolled nowhere while returning a perfectly good 200. It
also follows the links the site builds out of data rather than markup: the path page
renders its "what to do here" list from `data/learn/path.json`, so those hrefs appear in
no HTML file and no HTML scanner would ever see them break. It runs on every push.

```sh
python3 tools/apply-license-headers.py --check   # report
python3 tools/apply-license-headers.py           # write
```

Adds the GPL notice to any `.html`, `.css`, `.js` or `.ps1` file missing one. It is
idempotent and never writes to `vendor/`.

```sh
node tools/test-srs.js
```

Checks the scheduler against the properties FSRS is supposed to have: the forgetting
curve passes through 90% at one stability, intervals invert it exactly, a later recall
buys more stability than an early one, a lapse never inflates it, and a simulated
learner studying for seventy days lands on whatever retention target it was given.
Also runs on every push.

```sh
node tools/test-contrast.js
```

Reads the palette out of `css/style.css` — both themes — and checks every text colour
against every ground it is drawn on, at the WCAG AA thresholds. Colours are declared once
and used in eight hundred places, so the palette is where an unreadable pairing is worth
catching. It found two: `--muted` shipped at 4.22:1 on paper and 3.75 inside a well, and
`--gamboge-ink` shipped with the comment *"dark enough to read as text"* above a value
measuring 4.20. Both were picked by eye, both looked fine, and neither passed. Also on
every push.

```sh
node tools/test-pinyin.js
```

Checks how a typed reading is compared with the expected one — every spelling of
ü included, since `ǚ` decomposes to `u` + diaeresis + caron and a normaliser that
strips both marks at once will quietly decide 女 and 努 are the same word.

```sh
python3 tools/build-grammar-questions.py           # write the grammar shards
python3 tools/build-grammar-questions.py --check   # exit 1 if they are stale
```

Turns `data/learn/grammar.json` into the drills in `data/questions/L*-grammar-*.json`,
hand-written items first and then the syllabus in order. Distractors are chosen by a
seeded shuffle keyed on the point's id, so the same input always writes the same bytes
and the `--check` form — which runs on every push — means something.

```sh
python3 tools/order-questions.py           # sort and re-shard
python3 tools/order-questions.py --check   # exit 1 if anything is out of order
```

Puts the generated question shards in teaching order and re-paginates them. The
`--check` form runs on every push, so a regenerated bank cannot quietly go back
to arbitrary order.

```sh
python3 tools/measure-order.py
```

Prints the numbers the ordering section claims — when each of ten ordinary
sentences becomes readable, how many look-alikes still sit within twelve
positions of each other, and how many characters arrive before one of their own
components. Exits non-zero if any of the dependencies that actually matter has
inverted (木 before 林 before 森, 日 and 月 before 明), so a change to the
weighting cannot quietly undo the part of the old rule that was right. Runs on
every push.

It checks the grammar the same way: 结果补语 before 把, 把 before 被, 只要…就
before 只有…才, 比 before 没有 — and fails if any stage of the route grows past
sixty days, because that is the length at which a stage stops being something a
person can finish and goes back to being the syllabus with a name on it.

```sh
python3 tools/build-learning-data.py
```

Regenerates `data/learn/`. CI reruns it and fails if the committed output has drifted
from the source lists.

## Repository layout

```
├── index.html          redirect to html/index.html, plus the share-preview tags
├── 404.html            served for any missing path, at any depth
├── .nojekyll           required: keeps Pages from running Jekyll over the data
├── favicon.svg         一 in a 田字格
├── og-image.png        1200×630 share card
├── sitemap.xml         the seven real pages
├── manifest.webmanifest  name, icons, start URL, home-screen shortcuts
├── sw.js               offline caching — shell, study data, stroke data
├── icons/              generated — see tools/build-ios-assets.py
├── serve.ps1           dependency-free local server for Windows
├── css/                style.css (chrome) and pages.css (per-page)
├── js/
│   ├── app.js          shared helpers: DOM, storage, speech, pinyin
│   ├── srs.js          the FSRS scheduler — no DOM, no page depends on another
│   ├── study.js        the study session and its card types
│   ├── path.js         the staged route, and where the learner is on it
│   ├── progress.js     the dashboard, all charts inline SVG
│   ├── pwa.js          service worker registration, install hint, offline badge
│   └── …               writing, characters, practice, home, add
├── html/               one file per page
├── vendor/             Hanzi Writer (MIT — do not stamp GPL headers on it)
├── data/
│   ├── learn/          generated — see tools/build-learning-data.py
│   └── …               dictionary, characters, HSK lists, question shards
└── tools/              validate.py, test-srs.js, test-pinyin.js,
                     build-learning-data.py, build-ios-assets.py,
                     filter-vocabulary.py, apply-license-headers.py,
                     order-questions.py, measure-order.py, test-contrast.js,
                     build-grammar-questions.py,
                     beginner-path.json, grammar-points.json,
                     grammar-written.json — the hand-written half of the syllabus
```

`js/srs.js` has no DOM dependencies and runs under Node, which is what makes the
scheduler testable. Nothing else in `js/` imports anything else in `js/` — each page
loads the handful of files it needs.

## Licence

LearneCN's own source — `css/`, `js/`, `html/`, `index.html`, `404.html`, `serve.ps1`,
`tools/` and the generated questions — is **GPL-3.0-or-later**. See [`LICENSE`](LICENSE).
Earlier commits were published under MIT; copies obtained under those terms stay MIT.

The bundled data and vendored libraries keep their own licences, and the GPL does not
override them:

| | Licence |
| --- | --- |
| CC-CEDICT (`data/cedict.json`) | CC BY-SA 4.0 |
| Make Me a Hanzi (`data/hanzi.json`) | CC BY 4.0; stroke graphics derive from Arphic fonts and remain under the copyleft Arphic Public License |
| Hanzi Writer (`vendor/`) | MIT |

[`THIRD-PARTY-NOTICES.md`](THIRD-PARTY-NOTICES.md) has the detail, including what the
Arphic terms oblige you to do if you redistribute. Keep the attributions in the page
footers, and keep a link back to this repository on the site — under the GPL, the people
you serve the code to are entitled to know where the source is.
