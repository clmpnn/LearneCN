#!/usr/bin/env python3
# LearneCN — licence header tool
# Copyright (C) 2026 clmpnn
# SPDX-License-Identifier: GPL-3.0-or-later
#
# Adds the GNU GPL v3 notice to LearneCN's own source files. Safe to run more
# than once: a file that already carries an SPDX identifier is left alone.
#
# vendor/ is never touched. Hanzi Writer is MIT and stamping a GPL notice onto
# someone else's MIT file would be a false claim of ownership.
#
# Usage:
#   python3 tools/apply-license-headers.py --check     # report only, CI-friendly
#   python3 tools/apply-license-headers.py --dry-run   # show the diff plan
#   python3 tools/apply-license-headers.py             # write the headers

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

YEAR = "2026"
HOLDER = "clmpnn"
PROJECT = "LearneCN"
URL = "https://github.com/clmpnn/LearneCN"

SKIP_DIRS = {"vendor", "node_modules", ".git", "data", ".github"}
SKIP_FILES = {"LICENSE", "THIRD-PARTY-NOTICES.md", "head-snippet.html"}

EXTENSIONS = {".html", ".css", ".js", ".ps1"}

MARKER = "SPDX-License-Identifier"

NOTICE = f"""{PROJECT} — {URL}
Copyright (C) {YEAR} {HOLDER}

This program is free software: you can redistribute it and/or modify it under
the terms of the GNU General Public License as published by the Free Software
Foundation, either version 3 of the License, or (at your option) any later
version.

This program is distributed in the hope that it will be useful, but WITHOUT ANY
WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A
PARTICULAR PURPOSE. See the GNU General Public License for more details.

You should have received a copy of the GNU General Public License along with
this program. If not, see <https://www.gnu.org/licenses/>.

{MARKER}: GPL-3.0-or-later"""


def block(ext: str) -> str:
    if ext == ".html":
        # An HTML comment cannot contain "--", so the notice is safe as-is.
        return "<!--\n" + "\n".join(
            ("  " + line).rstrip() for line in NOTICE.splitlines()
        ) + "\n-->\n"
    if ext in {".css", ".js"}:
        return "/*\n" + "\n".join(
            (" * " + line).rstrip() for line in NOTICE.splitlines()
        ) + "\n */\n"
    if ext == ".ps1":
        return "\n".join(("# " + line).rstrip() for line in NOTICE.splitlines()) + "\n"
    raise ValueError(ext)


def insert(text: str, ext: str) -> str:
    header = block(ext)

    if ext == ".html":
        # Keep <!DOCTYPE html> as the very first thing on the page.
        stripped = text.lstrip()
        if stripped[:9].lower() == "<!doctype":
            end = text.find(">", text.lower().find("<!doctype")) + 1
            return text[:end] + "\n" + header + text[end:].lstrip("\n")
        return header + text

    if ext == ".ps1":
        # Preserve a shebang or a leading #Requires statement.
        lines = text.splitlines(keepends=True)
        i = 0
        while i < len(lines) and (
            lines[i].startswith("#!") or lines[i].lower().startswith("#requires")
        ):
            i += 1
        return "".join(lines[:i]) + header + "".join(lines[i:])

    return header + text


def targets() -> list[Path]:
    out = []
    for path in sorted(ROOT.rglob("*")):
        if not path.is_file() or path.suffix.lower() not in EXTENSIONS:
            continue
        if path.name in SKIP_FILES:
            continue
        if any(part in SKIP_DIRS for part in path.relative_to(ROOT).parts[:-1]):
            continue
        out.append(path)
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description="Apply GPL-3.0 headers to LearneCN sources.")
    ap.add_argument("--check", action="store_true", help="report missing headers, write nothing")
    ap.add_argument("--dry-run", action="store_true", help="list what would change")
    args = ap.parse_args()

    files = targets()
    if not files:
        print("No source files found. Run this from the repository root.")
        return 1

    missing, stamped = [], []

    for path in files:
        try:
            text = path.read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError) as exc:
            print(f"  skipped  {path.relative_to(ROOT)} ({exc})")
            continue

        if MARKER in text:
            stamped.append(path)
            continue

        missing.append(path)
        if args.check or args.dry_run:
            continue

        path.write_text(insert(text, path.suffix.lower()), encoding="utf-8")

    for path in missing:
        verb = "would add" if (args.check or args.dry_run) else "added   "
        print(f"  {verb}  {path.relative_to(ROOT)}")

    print(f"\n{len(stamped)} already licensed, {len(missing)} "
          f"{'without a header' if args.check or args.dry_run else 'updated'}.")

    if args.check and missing:
        print("\nRun without --check to add them.")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
