/*
 * LearneCN — https://github.com/clmpnn/LearneCN
 * Copyright (C) 2026 clmpnn
 *
 * This program is free software: you can redistribute it and/or modify it under
 * the terms of the GNU General Public License as published by the Free Software
 * Foundation, either version 3 of the License, or (at your option) any later
 * version.
 *
 * This program is distributed in the hope that it will be useful, but WITHOUT ANY
 * WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A
 * PARTICULAR PURPOSE. See the GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License along with
 * this program. If not, see <https://www.gnu.org/licenses/>.
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
/* LearneCN — offline support.

   The point of this file is a commute. Twenty minutes underground with no
   signal is the best study slot most people have, and it is exactly when a
   site that fetches its word lists over the network is useless.

   Three caches, because the three kinds of file want different treatment:

     shell    the pages, styles and scripts — small, changes on every deploy,
              so it is precached whole and thrown away when the version bumps
     study    word lists, question shards, generated study data — large,
              effectively immutable, fetched on demand and kept
     strokes  character outlines from jsDelivr — tiny, thousands of them,
              only worth keeping for characters actually met

   Nothing is bulk-downloaded. The bank is 89 MB and almost nobody studies
   all of it; caching a level the moment it is opened costs a few megabytes
   and covers the case that matters. */

const VERSION = 'v3';
const SHELL = `learnecn-shell-${VERSION}`;
const STUDY = 'learnecn-study';
const STROKES = 'learnecn-strokes';
const FONTS = 'learnecn-fonts';

/* Everything needed to open the app and start a session, assuming the study
   data is already there. Kept deliberately small — under 400 KB — so a first
   visit on cellular is not held up by it. */
const SHELL_FILES = [
  './',
  'index.html',
  '404.html',
  'manifest.webmanifest',
  'favicon.svg',
  'icons/apple-touch-icon.png',
  'icons/icon-192.png',
  'html/index.html',
  'html/path.html',
  'html/study.html',
  'html/progress.html',
  'html/practice.html',
  'html/writing.html',
  'html/characters.html',
  'html/add.html',
  'css/style.css',
  'css/pages.css',
  'js/app.js',
  'js/srs.js',
  'js/study.js',
  'js/path.js',
  'js/progress.js',
  'js/practice.js',
  'js/writing.js',
  'js/characters.js',
  'js/home.js',
  'js/add.js',
  'vendor/hanzi-writer.min.js',
  'data/pinyin.json',
  'data/learn/order.json',
  'data/learn/tones.json',
  'data/learn/path.json',
  'data/learn/phrases.json',
  'data/learn/grammar.json'
];

/* Rough ceilings, enforced oldest-first. A phone that has been used for a
   year should not be holding every question shard it ever saw. */
const LIMITS = { [STUDY]: 60, [STROKES]: 3000, [FONTS]: 40 };

const isStudyData = url =>
  url.origin === self.location.origin && /\/data\/.*\.json$/.test(url.pathname);

const isStrokeData = url =>
  url.hostname === 'cdn.jsdelivr.net' && url.pathname.includes('hanzi-writer-data');

const isFont = url =>
  url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com';

/* ---------- install ---------- */

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL);
    /* One bad path must not fail the whole install, so they go in one at a
       time and a miss is simply skipped. */
    await Promise.all(SHELL_FILES.map(async file => {
      try {
        const res = await fetch(new Request(file, { cache: 'reload' }));
        if (res.ok) await cache.put(file, res);
      } catch { /* offline during install, or the file moved */ }
    }));
    await self.skipWaiting();
  })());
});

/* ---------- activate ---------- */

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keep = new Set([SHELL, STUDY, STROKES, FONTS]);
    for (const name of await caches.keys()) {
      if (!keep.has(name)) await caches.delete(name);
    }
    if (self.registration.navigationPreload) {
      await self.registration.navigationPreload.enable();
    }
    await self.clients.claim();
  })());
});

/* ---------- fetch ---------- */

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  /* A page request: try the network so a deploy is picked up, fall back to
     whatever is cached, and fall back again to the study page — which is
     where somebody opening the app offline wanted to go anyway. */
  if (req.mode === 'navigate') {
    event.respondWith(navigateWith(event));
    return;
  }

  if (isStudyData(url)) { event.respondWith(cacheFirst(req, STUDY, true)); return; }
  if (isStrokeData(url)) { event.respondWith(cacheFirst(req, STROKES, false)); return; }
  if (isFont(url)) { event.respondWith(cacheFirst(req, FONTS, false)); return; }

  if (url.origin === self.location.origin) {
    event.respondWith(staleWhileRevalidate(req, SHELL));
  }
});

async function navigateWith(event) {
  const req = event.request;
  try {
    const preloaded = await event.preloadResponse;
    if (preloaded) {
      event.waitUntil(store(SHELL, req, preloaded.clone()));
      return preloaded;
    }
    const fresh = await fetch(req);
    event.waitUntil(store(SHELL, req, fresh.clone()));
    return fresh;
  } catch {
    return (await caches.match(req, { ignoreSearch: true }))
        || (await caches.match('html/study.html'))
        || (await caches.match('./'))
        || offlineResponse();
  }
}

/**
 * Cache-first, for things that do not change: a question shard or a
 * character's strokes are the same bytes forever. Going to the network for
 * them costs time on every card.
 *
 * `explain` decides what a miss looks like offline. Study data answers with
 * a readable 503 the page can act on. Everything else rethrows, so a blocked
 * font or an unreachable CDN fails exactly as it would with no worker
 * installed — inventing a JSON error body for a stylesheet only makes the
 * console harder to read.
 */
async function cacheFirst(req, cacheName, explain) {
  const hit = await caches.match(req);
  if (hit) return hit;
  try {
    const res = await fetch(req);
    if (res.ok || res.type === 'opaque') {
      await store(cacheName, req, res.clone());
      trim(cacheName);
    }
    return res;
  } catch (err) {
    if (!explain) throw err;
    return new Response(
      JSON.stringify({ error: 'offline', message: 'Not saved for offline use yet.' }),
      { status: 503, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

/** Serve the cached copy at once, then quietly refresh it for next time. */
async function staleWhileRevalidate(req, cacheName) {
  const hit = await caches.match(req);
  if (hit) {
    /* Refresh in the background; the page already has its answer. */
    fetch(req).then(res => { if (res.ok) store(cacheName, req, res.clone()); }).catch(() => {});
    return hit;
  }
  const res = await fetch(req);
  if (res.ok) store(cacheName, req, res.clone());
  return res;
}

async function store(cacheName, req, res) {
  try { (await caches.open(cacheName)).put(req, res); } catch { /* quota */ }
}

/** Keep a cache under its ceiling, discarding what went in first. */
async function trim(cacheName) {
  const limit = LIMITS[cacheName];
  if (!limit) return;
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  if (keys.length <= limit) return;
  for (const key of keys.slice(0, keys.length - limit)) await cache.delete(key);
}

function offlineResponse() {
  return new Response(
    `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
     <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
     <title>Offline — LearneCN</title>
     <style>
       :root{color-scheme:light dark}
       body{margin:0;min-height:100dvh;display:grid;place-content:center;gap:14px;
            text-align:center;padding:24px;
            font:1rem/1.6 ui-serif,Georgia,"Songti SC","Noto Serif CJK SC",serif;
            background:#f2ece0;color:#1b1815}
       b{font-size:2.6rem;color:#a82a1c;font-weight:400}
       p{max-width:32ch;margin:0;color:#776f61;font-size:.92rem}
       @media(prefers-color-scheme:dark){body{background:#171613;color:#efe8da}}
     </style></head><body>
     <b lang="zh">离线</b>
     <p>You are offline, and this page has not been saved yet.
        Open it once with a connection and it will be here next time.</p>
     </body></html>`,
    { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
  );
}

/* ---------- messages from the page ---------- */

self.addEventListener('message', event => {
  const msg = event.data || {};
  if (msg.type === 'usage') {
    event.waitUntil((async () => {
      const report = {};
      for (const name of [SHELL, STUDY, STROKES, FONTS]) {
        report[name] = (await (await caches.open(name)).keys()).length;
      }
      let bytes = null;
      if (navigator.storage && navigator.storage.estimate) {
        bytes = (await navigator.storage.estimate()).usage || null;
      }
      event.source && event.source.postMessage({ type: 'usage', counts: report, bytes });
    })());
  }
  if (msg.type === 'clear-study') {
    event.waitUntil((async () => {
      await caches.delete(STUDY);
      await caches.delete(STROKES);
      event.source && event.source.postMessage({ type: 'cleared' });
    })());
  }
});
