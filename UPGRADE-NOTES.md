# Handover notes

What changed, what you still need to do, and what I could not check. Delete this
file once you have worked through it — it is not part of the site.

---

## What I could see

I read the repository through its public GitHub page and the published site. That
gave me `README.md`, the root `index.html`, the file listing, and the rendered
output of `html/index.html`.

I could **not** read the contents of `css/`, `js/`, `html/*.html`, `vendor/`,
`serve.ps1` or the data files. Nothing below rewrites those. Where a change has
to touch them, it is either a script that edits them safely and idempotently, or
a snippet for you to paste.

## Added

| File | Why |
| --- | --- |
| `LICENSE` | GPL-3.0 verbatim, byte-identical to the FSF text (md5 `1ebbd3e3…`). GitHub's licence detector needs it unmodified to show the badge. |
| `.nojekyll` | **The important one.** Empty file, must stay empty. Without it Pages runs Jekyll over the repo, drops any path starting with `_`, and tries to parse `{{ … }}` inside your data files as Liquid — which fails the build outright. |
| `404.html` | Custom not-found page, styled as a LearneCN vocabulary card. Self-contained: no stylesheet, script or webfont, so it renders even when nothing else loads. |
| `og-image.png` | 1200×630 share card. The site currently previews as a blank box everywhere it is linked. |
| `favicon.svg` | Drawn geometrically rather than set in type, so it does not depend on a CJK font being installed. |
| `sitemap.xml` | The five real pages. |
| `robots.txt` | Inert on a project page — see the comment inside it. Correct the moment you attach a custom domain. |
| `.gitattributes` | LF everywhere, CRLF for `serve.ps1`, and Linguist rules so the language bar stops reading as 99% JSON. |
| `.gitignore` | Editor, OS and tooling noise. |
| `THIRD-PARTY-NOTICES.md` | Which licence covers which bundled file, now that the code is GPL. |
| `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`, `CITATION.cff` | Completes GitHub's community profile. |
| `.github/workflows/ci.yml` | Validation on push. Does not deploy — see below. |
| `.github/ISSUE_TEMPLATE/`, `PULL_REQUEST_TEMPLATE.md` | Includes a data-error form that routes dictionary and stroke-order corrections upstream. |
| `tools/validate.py` | Parses every JSON file, checks the question schema, reconciles the shard manifest, verifies internal links and their casing. |
| `tools/apply-license-headers.py` | Stamps the GPL notice onto your sources. Idempotent, never touches `vendor/`. |
| `tools/head-snippet.html` | Meta tags to paste into the five pages, with per-page values. |

## Replaced

**`index.html`** — still a redirect, but now carries the canonical URL, the
Open Graph and Twitter tags (the root URL is the one people actually paste), a
favicon link, a jsDelivr preconnect that warms the connection during the hop,
and a styled no-JS fallback. It also preserves `location.search` and
`location.hash` across the redirect, so deep links survive.

**`README.md`** — your content kept as written, with badges, a Publishing
section, a repository layout map, a Checks section, and the licence section
rewritten.

---

## What you need to do

### 1. Stamp the licence headers

```sh
python3 tools/apply-license-headers.py
```

This walks `css/`, `js/`, `html/` and `serve.ps1` and inserts the GPL notice
where it is missing. It skips anything already carrying an SPDX line, and it
skips `vendor/` entirely — Hanzi Writer is MIT, and stamping a GPL notice onto
someone else's MIT file would be a false claim of ownership.

Check the result on one file before committing the lot. In HTML it inserts the
comment *after* `<!DOCTYPE html>`, and in JavaScript *before* any `"use strict"`.
Both are correct, but look once.

### 2. Paste the meta tags

`tools/head-snippet.html` has the tags and the per-page title and description
text for all five pages. Five copy-pastes. Without these, sharing any page other
than the root still previews as nothing.

### 3. Add a source link to the footer

The footer already credits CC-CEDICT and Make Me a Hanzi. Add one more:

```html
<a href="https://github.com/clmpnn/LearneCN">Source</a> · GPL-3.0
```

Not strictly required — the JavaScript is unminified, so a visitor already has
the source — but under the GPL the people you serve code to are entitled to know
where it lives, and a link is the cheapest way to say so.

### 4. Fill in the repository About panel

It currently reads "No description, website, or topics provided", which is the
single largest thing suppressing the repo in GitHub search.

- **Description:** `Free Mandarin study site — hanzi stroke order, HSK 1–6 quizzes, pinyin and zhuyin, and a 121,100-entry Chinese–English dictionary. No build step.`
- **Website:** `https://clmpnn.github.io/LearneCN/`
- **Topics:** `mandarin` `chinese` `hanzi` `hsk` `pinyin` `zhuyin` `stroke-order`
  `language-learning` `cc-cedict` `static-site` `github-pages` `no-dependencies`

### 5. Confirm the Pages source

**Settings → Pages → Source: Deploy from a branch → `main` / `(root)`.**

Leave it there. Do not switch to "GitHub Actions". An Actions deploy tars the
published directory into an artifact and re-uploads it every push; with the
question bank that is well over 100 MB per run, to publish files that need no
build. `ci.yml` validates instead, which is the better use of the minutes.

### 6. Run the validator once

```sh
python3 tools/validate.py
```

I wrote it against the schema documented in your README, not against the real
files, so the first run is as much a test of the validator as of the data. Two
things to expect:

- It accepts a shard that is either a bare JSON array or an object wrapping one,
  and it reads `index.json` in several plausible shapes. If it prints
  *"unrecognised manifest shape"*, tell me what `index.json` actually looks like
  and I will tighten `_flatten_index`.
- The link check knows the site lives at `/LearneCN/`. If you move to a custom
  domain, change `PAGES_PREFIX` at the top of the file to `"/"`.

---

## Two things I noticed but did not change

**There is a `questions.json` at the repository root and another at
`data/questions.json`.** The README documents only the one under `data/`. If the
root copy is a leftover, deleting it saves a confusing 404 for the next person
who reads the Add page code. I left it alone because I could not read either file
to confirm which one the site actually fetches.

**The site lives one directory down.** `https://clmpnn.github.io/LearneCN/`
serves a redirect, and the real home page is at `/html/index.html`. That costs a
round trip on every first visit, splits your search ranking across two URLs, and
is why the canonical tag matters. Moving `html/index.html` to the root and
rewriting the `../css`, `../js`, `../data` paths would remove the hop
permanently — but it touches every page and every relative path, so it is a
deliberate change to make with the files in front of you, not one to do blind.
The redirect as it stands is correct and Google follows it fine.

---

## Worth knowing about Pages

- **Case sensitivity.** Pages is case-sensitive; macOS and Windows are not. A
  `href="../CSS/main.css"` works on your machine and 404s in production. This is
  the most common Pages-only bug, and `validate.py` checks for it.
- **Caching.** Pages sends `Cache-Control: max-age=600` and you cannot change it.
  If you ship a CSS or JS change and want it picked up immediately, bump a query
  string: `main.css?v=3`.
- **Limits.** 1 GB per site, 100 MB per file, soft 100 GB/month bandwidth. The
  `size` job in `ci.yml` warns at 75% and fails past either hard limit.
- **Compression.** Pages gzips JSON automatically, so your 900 KB shards go over
  the wire at a fraction of that. No action needed.
- **A PWA would suit this site** — offline HSK practice on a commute is exactly
  the use case — but it needs a service worker, and caching a 130 MB question
  bank is a design problem rather than a config change. Worth doing as its own
  piece of work, not as part of this.
