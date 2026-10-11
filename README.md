# Pitch Trainer

A small, local-first web app for practicing pitch and musical intervals. The MVP is designed around quick listening drills, with an optional virtual keyboard and browser-synthesized tones; it does not claim to teach perfect pitch.

The current practice flow covers identifying a note, choosing the second note in an interval, and recalling a short three-note melody. The app uses generated tones and does not upload practice data. Microphone-based pitch detection and harmony exercises are future work.

## Run locally

The app uses browser-native ES modules and has no runtime dependencies. From the repository root:

```sh
npm test
npm run serve
```

Then open [http://localhost:4173](http://localhost:4173). Python's static server serves the files; there is no build step. Browser audio starts after a user interaction, as required by browser autoplay policies.

## Offline use

The service worker precaches the app shell and serves same-origin assets from cache after the first successful install. It uses network-first navigation with the cached app page as an offline fallback. For a deployed site, open it once while online, then it can load offline. Service workers require HTTPS; localhost is treated as a secure context for development. Clearing the browser's site data removes the saved cache.

## GitHub Pages

The workflow in `.github/workflows/pages.yml` runs `npm test` before assembling and deploying the static site on pushes to `main`, and supports manual runs. It copies only the app entry point, styles, manifest, icon, service worker, and source modules into the Pages artifact.

Before the first workflow run, go to **Settings → Pages** and set the build and deployment source to **GitHub Actions**. The workflow uses `actions/configure-pages` to read the Pages configuration, then deploys with `pages: write` and `id-token: write`; checkout uses `contents: read`.

## Development

- Application code lives in `src/` as vanilla ES modules.
- `npm test` runs Node's built-in test runner over `tests/*.test.js`.
- CI also runs `tests/browser-smoke.mjs` in Chromium: a complete 10-question session, all three modes, replay scoring, persistence, mobile overflow, and offline gameplay under the Pages subpath. To run it locally, install Playwright 1.62.1 and Chromium, serve this folder from its parent on port 4173, then run `node tests/browser-smoke.mjs`. Set `PITCH_BASE_URL` if serving at a different URL.
- Keep deployable asset URLs relative so the app works under the repository subpath on GitHub Pages.
- Update the service worker cache version when changing the shell's cache policy or asset layout.
