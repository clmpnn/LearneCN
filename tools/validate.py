#!/usr/bin/env python3
# LearneCN — repository validator
# Copyright (C) 2026 clmpnn
# SPDX-License-Identifier: GPL-3.0-or-later
#
# Checks the things that actually break this site in production:
#
#   1. every JSON file parses                   — one bad shard kills a section
#   2. questions match the documented shape     — four choices, one answer
#   3. the questions manifest matches the files on disk
#   4. internal links resolve, case-sensitively — GitHub Pages is case-sensitive
#      even when your laptop is not, which is the classic Pages-only 404
#   5. root-absolute links carry the /LearneCN/ project-page prefix
#
# Usage:
#   python3 tools/validate.py            # everything
#   python3 tools/validate.py --quick    # skip the big question shards
#   python3 tools/validate.py --strict   # treat warnings as failures

import argparse
import json
import os
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

SECTIONS = {"vocabulary", "characters", "grammar", "reading", "listening"}
MIN_LEVEL, MAX_LEVEL = 1, 7

# GitHub Pages serves this repo under /LearneCN/. Change if you move to a
# custom domain, where root-absolute links become plain /.
PAGES_PREFIX = "/LearneCN/"

SHARD_RE = re.compile(r"^L(?P<level>\d+)-(?P<section>[a-z]+)-(?P<page>\d+)\.json$")

errors: list[str] = []
warnings: list[str] = []


def err(msg: str) -> None:
    errors.append(msg)


def warn(msg: str) -> None:
    warnings.append(msg)


def rel(p: Path) -> str:
    try:
        return str(p.relative_to(ROOT))
    except ValueError:
        return str(p)


# ---------------------------------------------------------------------------
# 1. JSON parses
# ---------------------------------------------------------------------------

def load_json(path: Path):
    try:
        with path.open(encoding="utf-8") as fh:
            return json.load(fh)
    except UnicodeDecodeError as exc:
        err(f"{rel(path)}: not valid UTF-8 ({exc})")
    except json.JSONDecodeError as exc:
        err(f"{rel(path)}: invalid JSON at line {exc.lineno}, column {exc.colno} — {exc.msg}")
    except OSError as exc:
        err(f"{rel(path)}: cannot read ({exc})")
    return None


def as_question_list(payload, path: Path):
    """Shards may be a bare array or an object wrapping one. Accept both."""
    if isinstance(payload, list):
        return payload
    if isinstance(payload, dict):
        for key in ("questions", "items", "data", "rows"):
            if isinstance(payload.get(key), list):
                return payload[key]
    warn(f"{rel(path)}: no question array found; skipping schema checks")
    return None


# ---------------------------------------------------------------------------
# 2. Question schema
# ---------------------------------------------------------------------------

def check_question(q, path: Path, i: int, want_level=None, want_section=None) -> None:
    where = f"{rel(path)}[{i}]"

    if not isinstance(q, dict):
        err(f"{where}: expected an object, got {type(q).__name__}")
        return

    level = q.get("level")
    if not isinstance(level, int) or not (MIN_LEVEL <= level <= MAX_LEVEL):
        err(f"{where}: level must be an integer {MIN_LEVEL}–{MAX_LEVEL}, got {level!r}")
    elif want_level is not None and level != want_level:
        err(f"{where}: level {level} does not match the filename (L{want_level})")

    section = q.get("section")
    if section not in SECTIONS:
        err(f"{where}: section must be one of {sorted(SECTIONS)}, got {section!r}")
    elif want_section is not None and section != want_section:
        err(f"{where}: section {section!r} does not match the filename ({want_section!r})")

    if not isinstance(q.get("q"), str) or not q["q"].strip():
        err(f"{where}: 'q' must be a non-empty string")

    choices = q.get("choices")
    if not isinstance(choices, list):
        err(f"{where}: 'choices' must be an array")
    else:
        if len(choices) != 4:
            err(f"{where}: expected 4 choices, got {len(choices)}")
        if any(not isinstance(c, str) or not c.strip() for c in choices):
            err(f"{where}: every choice must be a non-empty string")
        seen = [c for c in choices if isinstance(c, str)]
        if len(set(seen)) != len(seen):
            err(f"{where}: duplicate choices — the answer would be ambiguous")

    answer = q.get("answer")
    if not isinstance(answer, int) or isinstance(answer, bool):
        err(f"{where}: 'answer' must be a 0-based integer index, got {answer!r}")
    elif isinstance(choices, list) and not (0 <= answer < len(choices)):
        err(f"{where}: answer {answer} is outside choices 0–{len(choices) - 1}")

    if section == "reading" and not q.get("passage"):
        warn(f"{where}: reading question with no 'passage'")
    if section == "listening" and not (q.get("speak") or q.get("audio")):
        warn(f"{where}: listening question with neither 'speak' nor 'audio'")


# ---------------------------------------------------------------------------
# 3. Manifest vs. disk
# ---------------------------------------------------------------------------

def check_questions(quick: bool) -> None:
    qdir = ROOT / "data" / "questions"
    if not qdir.is_dir():
        warn("data/questions/ not found; skipping question checks")
        return

    shards = sorted(p for p in qdir.glob("*.json") if p.name != "index.json")
    on_disk: dict[tuple[int, str], set[int]] = {}

    for path in shards:
        m = SHARD_RE.match(path.name)
        if not m:
            warn(f"{rel(path)}: filename does not match L<level>-<section>-<page>.json")
            continue
        level = int(m["level"])
        section = m["section"]
        page = int(m["page"])
        on_disk.setdefault((level, section), set()).add(page)

        if section not in SECTIONS:
            err(f"{rel(path)}: unknown section {section!r} in filename")
        if not (MIN_LEVEL <= level <= MAX_LEVEL):
            err(f"{rel(path)}: level {level} in filename is out of range")

        if quick:
            continue

        payload = load_json(path)
        if payload is None:
            continue
        questions = as_question_list(payload, path)
        if questions is None:
            continue
        if not questions:
            warn(f"{rel(path)}: empty shard")
        for i, q in enumerate(questions):
            check_question(q, path, i, want_level=level, want_section=section)

    # page numbers should be contiguous, or the loader will stop early
    for (level, section), pages in sorted(on_disk.items()):
        lo, hi = min(pages), max(pages)
        missing = sorted(set(range(lo, hi + 1)) - pages)
        if missing:
            err(f"data/questions: L{level}-{section} is missing page(s) {missing} "
                f"between {lo} and {hi} — pagination will stop there")

    index_path = qdir / "index.json"
    if not index_path.exists():
        err("data/questions/index.json is missing; the practice page cannot page through shards")
        return

    index = load_json(index_path)
    if index is None:
        return

    counted = _flatten_index(index)
    if counted is None:
        warn("data/questions/index.json: unrecognised manifest shape; compared nothing")
        return

    for (level, section), claimed in sorted(counted.items()):
        actual = len(on_disk.get((level, section), ()))
        if actual == 0:
            err(f"index.json claims {claimed} page(s) for L{level}-{section}, "
                f"but no such shard exists")
        elif claimed != actual:
            err(f"index.json claims {claimed} page(s) for L{level}-{section}, "
                f"found {actual} on disk")

    for key in sorted(on_disk):
        if key not in counted:
            warn(f"data/questions: L{key[0]}-{key[1]} exists on disk but is not in index.json, "
                 f"so nothing will ever load it")


def _flatten_index(index):
    """Best-effort read of the manifest. Returns {(level, section): pages} or None."""
    out: dict[tuple[int, str], int] = {}

    def note(level, section, value):
        try:
            level = int(str(level).lstrip("Ll"))
        except (TypeError, ValueError):
            return
        if isinstance(value, bool):
            return
        if isinstance(value, int):
            out[(level, str(section))] = value
        elif isinstance(value, list):
            out[(level, str(section))] = len(value)
        elif isinstance(value, dict):
            # the shipped shape: {"pages": 2, "count": 4551}
            pages = value.get("pages")
            if isinstance(pages, int) and not isinstance(pages, bool):
                out[(level, str(section))] = pages

    if isinstance(index, dict):
        for k, v in index.items():
            if isinstance(v, dict):                       # {"1": {"grammar": 2}}
                for section, pages in v.items():
                    note(k, section, pages)
            elif isinstance(v, (int, list)):              # {"L1-grammar": 2}
                if "-" in str(k):
                    lvl, _, sec = str(k).partition("-")
                    note(lvl, sec, v)
        return out or None

    if isinstance(index, list):                           # [{level, section, pages}]
        for entry in index:
            if isinstance(entry, dict):
                note(entry.get("level"), entry.get("section"),
                     entry.get("pages", entry.get("count")))
        return out or None

    return None


# ---------------------------------------------------------------------------
# 4 & 5. Internal links
# ---------------------------------------------------------------------------

REF_RE = re.compile(r'(?:href|src)\s*=\s*["\']([^"\']+)["\']', re.I)
SKIP_RE = re.compile(r'^(?:[a-z][a-z0-9+.-]*:|//|#|\{)', re.I)


def check_links() -> None:
    pages = sorted(ROOT.glob("*.html")) + sorted(ROOT.glob("html/*.html"))
    if not pages:
        warn("no HTML files found; skipping link checks")
        return

    for page in pages:
        try:
            html = page.read_text(encoding="utf-8", errors="replace")
        except OSError as exc:
            err(f"{rel(page)}: cannot read ({exc})")
            continue

        for raw in REF_RE.findall(html):
            ref = raw.split("#", 1)[0].split("?", 1)[0].strip()
            if not ref or SKIP_RE.match(ref):
                continue

            if ref.startswith("/"):
                # 404.html is served at arbitrary depths, so it must use
                # root-absolute links — and on a project page those need the
                # /LearneCN/ prefix or they land on the user page instead.
                if not ref.startswith(PAGES_PREFIX):
                    err(f"{rel(page)}: root-absolute link {ref!r} is missing the "
                        f"{PAGES_PREFIX!r} project-page prefix")
                    continue
                target = ROOT / ref[len(PAGES_PREFIX):]
            else:
                target = (page.parent / ref).resolve()

            if not target.exists():
                err(f"{rel(page)}: link target does not exist — {ref}")
            elif not _case_exact(target):
                err(f"{rel(page)}: {ref} differs in case from the file on disk; "
                    f"this works locally but 404s on GitHub Pages")
            else:
                check_fragment(rel(page), raw, target)


ID_RE = re.compile(r"""\bid\s*=\s*["']([^"']+)["']""")
_ids_cache: dict = {}


def _ids(path: Path) -> set:
    """Every id= in an HTML file, so a #fragment can be checked against it."""
    if path not in _ids_cache:
        try:
            _ids_cache[path] = set(ID_RE.findall(path.read_text(encoding="utf-8",
                                                               errors="replace")))
        except OSError:
            _ids_cache[path] = set()
    return _ids_cache[path]


def check_fragment(where: str, ref: str, target: Path) -> None:
    """A link to #something has to land on something.

    Stripping the fragment and checking only the file is how
    characters.html#finals passed review for as long as it did: the file was
    real, the anchor was not, and the link quietly scrolled nowhere. An anchor
    that does not exist is a broken link with the decency to return 200.
    """
    if "#" not in ref:
        return
    frag = ref.split("#", 1)[1].strip()
    if not frag or target.suffix.lower() not in (".html", ".htm"):
        return
    if frag not in _ids(target):
        err(f"{where}: link to #{frag} but {rel(target)} has no element with that id")


def check_data_links() -> None:
    """Links the site renders from data rather than from markup.

    The path page builds its "what to do in this stage" list out of
    data/learn/path.json, so those hrefs never appear in any HTML file and the
    scanner above cannot see them. They break exactly like markup links do.
    """
    path_file = ROOT / "data" / "learn" / "path.json"
    if not path_file.exists():
        return
    payload = load_json(path_file)
    if not isinstance(payload, dict):
        return

    html_dir = ROOT / "html"
    for stage in payload.get("stages") or []:
        for entry in stage.get("does") or []:
            ref = (entry or {}).get("href")
            where = f"data/learn/path.json[{stage.get('id')}]"
            if not isinstance(ref, str) or not ref:
                err(f"{where}: a 'does' entry has no href")
                continue
            if SKIP_RE.match(ref) or ref.startswith("/"):
                continue
            target = (html_dir / ref.split("#", 1)[0].split("?", 1)[0]).resolve()
            if not target.exists():
                err(f"{where}: link target does not exist — {ref}")
            elif not _case_exact(target):
                err(f"{where}: {ref} differs in case from the file on disk")
            else:
                check_fragment(where, ref, target)


def _case_exact(path: Path) -> bool:
    """True when every path segment matches the filesystem's own casing."""
    try:
        target = path.resolve()
        root = ROOT.resolve()
        parts = target.relative_to(root).parts
    except (OSError, ValueError):
        return True  # outside the repo, or unresolvable — not ours to judge

    base = root
    for part in parts:
        try:
            if part not in os.listdir(base):
                return False
        except OSError:
            return True
        base = base / part
    return True


# ---------------------------------------------------------------------------
# Other JSON in the repo
# ---------------------------------------------------------------------------

def check_other_json(quick: bool) -> None:
    skip = {ROOT / "data" / "questions"}
    for path in sorted(ROOT.rglob("*.json")):
        if any(parent in skip for parent in path.parents):
            continue
        if "node_modules" in path.parts or path.parts[0] == ".git":
            continue
        if quick and path.stat().st_size > 2_000_000:
            continue
        load_json(path)


# ---------------------------------------------------------------------------

def main() -> int:
    ap = argparse.ArgumentParser(description="Validate the LearneCN repository.")
    ap.add_argument("--quick", action="store_true",
                    help="skip parsing the large question shards and dictionaries")
    ap.add_argument("--strict", action="store_true",
                    help="exit non-zero on warnings as well as errors")
    args = ap.parse_args()

    print(f"Validating {ROOT}\n")

    check_other_json(args.quick)
    check_questions(args.quick)
    check_links()
    check_data_links()

    for w in warnings:
        print(f"  warning  {w}")
    for e in errors:
        print(f"  ERROR    {e}")

    print(f"\n{len(errors)} error(s), {len(warnings)} warning(s)")

    if errors:
        return 1
    if warnings and args.strict:
        return 1
    print("OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
