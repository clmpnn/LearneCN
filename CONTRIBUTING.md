# Contributing to LearneCN

There is no build step, no framework and no server code. Clone it, serve the
folder, edit a file, reload. That is the whole loop.

## Get it running

Serve from the **repository root**, not from `html/`. The pages load `../css`,
`../js` and `../data`, so starting the server one level down puts those paths
outside the server root and every data fetch fails.

```sh
git clone https://github.com/clmpnn/LearneCN.git
cd LearneCN
python3 -m http.server 8000     # py -m http.server 8000 on Windows
```

Then open <http://localhost:8000>.

Opening `index.html` off disk does not work — the `file://` origin blocks the
`fetch` calls that load the dictionary and question bank.

## Before you open a pull request

```sh
python3 tools/validate.py
```

This parses every JSON file, checks each question has four distinct choices and
exactly one correct answer, confirms `data/questions/index.json` matches the
shards actually on disk, and verifies that internal links resolve with the right
casing. GitHub Pages is case-sensitive even when macOS and Windows are not, and
a `../CSS/main.css` that works on your laptop will 404 in production. The same
script runs in CI.

If you added a `.html`, `.css` or `.js` file:

```sh
python3 tools/apply-license-headers.py
```

It adds the GPL notice to anything missing one and leaves everything else
untouched. It never writes to `vendor/`.

## Adding questions

The Add page writes questions in the right shape and hands you a file to
download — that is the easiest route, and it lets you try the question before
committing it.

By hand, a question looks like this:

```json
{
  "level": 3,
  "section": "grammar",
  "q": "请 ___ 门关上。",
  "choices": ["把", "被", "让", "给"],
  "answer": 0,
  "note": "把 moves the object before the verb."
}
```

- `level` is 1–6 for HSK, 7 for 进阶.
- `section` is one of `vocabulary`, `characters`, `grammar`, `reading`, `listening`.
- `answer` is a 0-based index into `choices`.
- `passage` supplies the text for a reading question; `speak` supplies the line
  the browser reads aloud for a listening one.
- Question text, choices and notes are written **in Chinese**. Pinyin appears
  only where the question is about pronunciation.

Four choices, all different, exactly one correct. For a "which character reads
X" question, make sure no distractor shares that reading.

## Editing data

`data/hanzi.json` and `data/cedict.json` come from upstream projects and are
regenerated rather than hand-edited. A wrong definition or stroke order should
be reported to CC-CEDICT or Make Me a Hanzi — fixing it there fixes it for
everyone, and the fix survives the next regeneration here.

## Style

Match what is already in the file. Plain HTML, CSS and JavaScript, no
transpiling, no bundler, no dependency that needs installing. If a change would
introduce a build step, open an issue first — the absence of one is deliberate.

## Licence

Contributions are accepted under **GPL-3.0-or-later**, the same licence as the
rest of the project. Do not paste in code or data under an incompatible licence,
and do not add anything to `vendor/` without its upstream licence header intact.
