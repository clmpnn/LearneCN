# Security policy

## What the attack surface actually is

LearneCN is static files on GitHub Pages. There is no server, no database, no
accounts, no analytics and no third-party scripts. Quiz progress and any
questions you write live in `localStorage` and never leave the browser.

That leaves three things worth reporting:

1. **Cross-site scripting.** The Add page and the dictionary search take user
   input and render it. If you can get script to execute through either — or
   through a crafted `questions.json` that someone imports — that is a real bug.
2. **The vendored copy of Hanzi Writer** in `vendor/`, if a vulnerability is
   published against the version pinned there.
3. **The jsDelivr stroke-data fetch** in `js/writing.js`, if the request can be
   made to load something other than the character data it expects.

## Supported versions

Only the current `main` branch and the site published from it.

## Reporting

Use [private vulnerability reporting](https://github.com/clmpnn/LearneCN/security/advisories/new)
so the details stay unpublished until there is a fix. If that is unavailable,
contact the maintainer through their [GitHub profile](https://github.com/clmpnn)
rather than opening a public issue.

Please include the page, the input, and what you were able to make happen.

Expect an acknowledgement within about a week. This is a spare-time project, so
that is a realistic estimate rather than a service commitment. There is no bug
bounty.

## Out of scope

Anything that requires an attacker to already control the visitor's browser or
machine. Missing security headers that GitHub Pages does not let this repository
set. Errors in the dictionary or question data — those go to the
[data error form](https://github.com/clmpnn/LearneCN/issues/new/choose).
