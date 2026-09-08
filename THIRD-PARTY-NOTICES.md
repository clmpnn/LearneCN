# Third-party notices

LearneCN's own source — everything in `css/`, `js/`, `html/`, plus `index.html`,
`404.html` and `serve.ps1` — is licensed **GPL-3.0-or-later** (see `LICENSE`).

The GPL does **not** apply to the bundled dictionaries, character data or
vendored libraries. Those keep the licences their authors chose, and this file
is the notice that travels with them. If you fork or redistribute LearneCN, keep
this file and the attribution links in the page footers.

---

## Bundled data

### CC-CEDICT — `data/cedict.json`

Chinese–English dictionary, 121,100 entries.

- Source: <https://cc-cedict.org/>
- Licence: **Creative Commons Attribution-ShareAlike 4.0 International**
  (CC BY-SA 4.0) — <https://creativecommons.org/licenses/by-sa/4.0/>

CC-CEDICT is redistributed here in a reformatted JSON structure; the entry
content is unchanged. ShareAlike means any redistribution of this data, modified
or not, must stay under CC BY-SA 4.0 and must credit CC-CEDICT.

Note for downstream forks: CC BY-SA 4.0 is one-way compatible with GPLv3, so
BY-SA material *may* be taken into a GPLv3 work — but it cannot travel back the
other way. This project keeps the dictionary under its original CC BY-SA 4.0
rather than absorbing it, which is the simpler and more portable arrangement.

### Make Me a Hanzi — `data/hanzi.json`

Character data for 9,534 hanzi: pinyin, meaning, radical, decomposition,
etymology, stroke count.

- Source: <https://github.com/skishore/makemeahanzi>
- Licence for the data: **Creative Commons Attribution 4.0 International**
  (CC BY 4.0) — <https://creativecommons.org/licenses/by/4.0/>
- Licence for the derived stroke graphics: the graphics are derived from the
  **Arphic** fonts (AR PL UMing / AR PL UKai) and remain subject to the
  **Arphic Public License**, a copyleft licence.

The Arphic Public License is the sharpest constraint in this repository. It
requires that the notice travels with any derivative of the font data, that
derivatives stay under the same terms, and that you not charge for the font data
itself. If you redistribute LearneCN with the character data, you inherit that
obligation. Read the upstream repository's licence files before shipping a fork
commercially.

### HSK word lists — `data/hsk.json`

5,001 words, HSK 2012 official lists, levels 1–6. Word lists as such are factual
data and are not claimed as a copyrighted work by this project.

### Generated questions — `data/questions/`, `data/pinyin.json`

Written and generated for LearneCN, and derived in part from the sources above.
Released under **GPL-3.0-or-later** alongside the code, with the CC-CEDICT and
Make Me a Hanzi obligations still attaching to whatever they contributed.

---

## Vendored libraries

### Hanzi Writer — `vendor/`

Stroke-order animation and quiz rendering.

- Source: <https://hanziwriter.org> · <https://github.com/chanind/hanzi-writer>
- Licence: **MIT**

MIT is GPL-3.0 compatible, so the combined work distributes fine under the GPL.
The MIT copyright notice must stay with the vendored file — do not strip the
header comment when updating it.

### Hanzi Writer character data — loaded at runtime

Per-character stroke paths are fetched from jsDelivr rather than bundled. That
data is itself derived from Make Me a Hanzi and carries the same CC BY 4.0 and
Arphic terms described above.

---

## Speech

Listening questions are spoken by the browser's own Web Speech API. No audio
files are bundled and no speech service is called.
