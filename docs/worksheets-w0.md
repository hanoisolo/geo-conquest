# Worksheets mode — W0 baseline (Oct 18 2026)
Base: origin/main 7525471, branch `worksheets`.

## Baseline
- `node tests/check.mjs`: CHECK PASSED (node --check all js, validate.py with coverage, avatars + math tests 2,251,148 checks).
- `node tests/e2e.mjs`: 125/125. `node tests/e2e-multi.mjs`: 128/128. Screenshots in /workspace/geo-ws-w0/ (not committed).

## CSP / inline audit
- No inline `<script>` blocks, no inline event handlers (`on*=`), no eval / new Function. All scripts are `js/*.js` from 'self'.
- Inline style attributes: 2 (index.html:13 SVG defs `style="position:absolute"`, game.js:1098 mastery bar width in
  innerHTML). CSSOM `.style.x =` writes (map.js, confetti.js, game.js) are allowed by CSP.
- External: only an `<a href>` to naturalearthdata.com (navigation, not a fetch). Fonts, images and data are local.
- Decision: add in W5 (with the worksheet UI) a meta CSP:
  `default-src 'self'; script-src 'self'; connect-src 'self' https://api.mistral.ai https://generativelanguage.googleapis.com https://api.openai.com; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'self'; form-action 'none'`.
  `'unsafe-inline'` for styles only (keeps the 2 style attributes as they are, so the default game is unchanged); scripts stay strict.
  Verify with both e2e suites plus a console CSP-violation check.

## Test hook
`tests/check.mjs` now runs every `tests/ws-*.test.js` (sorted); prints "ws tests: none yet" when there are none.
Verified: no file → pass; failing file → CHECK FAILED; passing file → pass.
