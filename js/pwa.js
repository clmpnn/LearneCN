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
/* LearneCN — installing, and working without a connection.

   Everything here is additive. With no service worker, no manifest support
   and no home screen, the site behaves exactly as it did before; this file
   only ever adds. */

const PWA = (() => {

  /* The site sits at /LearneCN/ on Pages and at / almost anywhere else, and
     pages live one directory down. Deriving the root from this script's own
     URL is the only way to get the service worker's scope right in both
     places without hardcoding a repository name. */
  const here = (document.currentScript && document.currentScript.src) || '';
  const ROOT = here ? here.replace(/js\/pwa\.js.*$/, '') : './';

  const standalone = () =>
    window.navigator.standalone === true ||
    (window.matchMedia && matchMedia('(display-mode: standalone)').matches);

  const isIOS = () =>
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  /* Only Safari can add to the home screen on iOS. Chrome and Firefox there
     are Safari underneath but have no such menu item, so telling their users
     to look for one is just confusing. */
  const isIOSSafari = () =>
    isIOS() && !/CriOS|FxiOS|EdgiOS|OPiOS/.test(navigator.userAgent);

  let worker = null;

  /* ---------- registration ---------- */

  async function register() {
    if (!('serviceWorker' in navigator)) return null;
    if (location.protocol === 'file:') return null;   /* opened off disk */
    try {
      worker = await navigator.serviceWorker.register(ROOT + 'sw.js', { scope: ROOT });
      return worker;
    } catch {
      return null;                                     /* http, or blocked */
    }
  }

  /**
   * Ask the browser to treat this site's storage as worth keeping.
   *
   * Everything you have learned lives in localStorage, and a browser under
   * storage pressure is entitled to throw it away. Safari is stricter than
   * most. The request is usually granted once a site is on the home screen,
   * which is the main practical reason to install it.
   */
  async function keepStorage() {
    if (!navigator.storage || !navigator.storage.persist) return null;
    try {
      if (await navigator.storage.persisted()) return true;
      return await navigator.storage.persist();
    } catch {
      return null;
    }
  }

  /* ---------- what is saved ---------- */

  /** Ask the worker what it is holding. Resolves to null if it cannot say. */
  function usage(timeout = 1500) {
    return new Promise(resolve => {
      const sw = navigator.serviceWorker;
      if (!sw || !sw.controller) return resolve(null);
      const timer = setTimeout(() => { sw.removeEventListener('message', onMsg); resolve(null); }, timeout);
      function onMsg(e) {
        if (!e.data || e.data.type !== 'usage') return;
        clearTimeout(timer);
        sw.removeEventListener('message', onMsg);
        resolve(e.data);
      }
      sw.addEventListener('message', onMsg);
      sw.controller.postMessage({ type: 'usage' });
    });
  }

  function clearStudyCache() {
    return new Promise(resolve => {
      const sw = navigator.serviceWorker;
      if (!sw || !sw.controller) return resolve(false);
      const timer = setTimeout(() => resolve(false), 3000);
      function onMsg(e) {
        if (!e.data || e.data.type !== 'cleared') return;
        clearTimeout(timer);
        sw.removeEventListener('message', onMsg);
        resolve(true);
      }
      sw.addEventListener('message', onMsg);
      sw.controller.postMessage({ type: 'clear-study' });
    });
  }

  /* ---------- offline notice ---------- */

  function mountOfflineBadge() {
    const badge = document.createElement('div');
    badge.className = 'offline-badge';
    badge.setAttribute('role', 'status');
    badge.hidden = true;
    badge.textContent = 'Offline — studying from what is saved';
    document.body.appendChild(badge);

    const sync = () => { badge.hidden = navigator.onLine; };
    addEventListener('online', sync);
    addEventListener('offline', sync);
    sync();
  }

  /* ---------- add to home screen ---------- */

  const HINT_KEY = 'cn.installHint';

  function mountInstallHint() {
    if (standalone()) return;
    if (!isIOSSafari()) return;
    let seen = 0;
    try { seen = Number(localStorage.getItem(HINT_KEY) || 0); } catch { return; }
    if (seen >= 2) return;                       /* asked twice is enough */

    /* Not on the first page view. Somebody who has not yet decided the site
       is useful does not want to be asked to install it. */
    let visits = 0;
    try {
      visits = Number(localStorage.getItem('cn.visits') || 0) + 1;
      localStorage.setItem('cn.visits', String(visits));
    } catch { /* private mode */ }
    if (visits < 3) return;

    const sheet = document.createElement('div');
    sheet.className = 'install-sheet';
    sheet.innerHTML =
      '<div class="install-body">' +
        '<p class="install-title">Keep LearneCN on your home screen</p>' +
        '<p class="install-copy">It opens without Safari around it, and study sessions ' +
          'keep working with no signal. Tap <span class="ios-share" aria-hidden="true"></span> ' +
          '<b>Share</b>, then <b>Add to Home Screen</b>.</p>' +
      '</div>' +
      '<button class="install-close" type="button" aria-label="Dismiss">Not now</button>';
    document.body.appendChild(sheet);
    requestAnimationFrame(() => sheet.classList.add('in'));

    const dismiss = () => {
      sheet.classList.remove('in');
      setTimeout(() => sheet.remove(), 260);
      try { localStorage.setItem(HINT_KEY, String(seen + 1)); } catch { /* fine */ }
    };
    sheet.querySelector('.install-close').addEventListener('click', dismiss);
    setTimeout(dismiss, 15000);
  }

  /* ---------- go ---------- */

  document.addEventListener('DOMContentLoaded', () => {
    if (standalone()) document.documentElement.classList.add('standalone');
    if (isIOS()) document.documentElement.classList.add('ios');
    mountOfflineBadge();
    register().then(reg => { if (reg) keepStorage(); });
    setTimeout(mountInstallHint, 2600);
  });

  return { register, keepStorage, usage, clearStudyCache, standalone, isIOS, isIOSSafari, ROOT };
})();
