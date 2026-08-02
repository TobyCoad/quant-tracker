# Quant Tracker

Phone-homescreen PWA: quant application pipeline + daily feed from
[quant-role-scout](https://github.com/TobyCoad/quant-role-scout).

- **Pipeline tab** — applications with status (Not applied / Applied / OA /
  Interview / Offer / Rejected), notes, links.
- **Scout tab** — new postings from the scout's daily run (fit scores,
  one-liners, red flags), one-tap Track.

## Data & privacy

No personal data lives in this (public) repo. Applications are stored in
`localStorage` and synced to `tracker/applications.json` in the **private**
scout repo via the GitHub API; the scout feed is read from the same repo
(`data/seen.json`, `data/last_run.json`). Both need a fine-grained PAT
(repo: quant-role-scout, Contents read+write) pasted into the app's settings.

## Dev

Serve the folder statically and open with `?mock=1` to use `dev-mock/`
fixtures instead of the GitHub API (`dev-mock/` is git-ignored):

    python -m http.server 5610

Deploys to GitHub Pages via Actions on push to `main`. Bump `CACHE_VERSION`
in `sw.js` on every deploy — installed apps then show an update pill.
