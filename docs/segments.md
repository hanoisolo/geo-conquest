# Segments (big-release)

Gate per segment: `node tests/check.mjs` (COVERAGE=0 before segment 4) + `node tests/e2e.mjs <tree>` visual review at 1280x800 and 390x844.
Max one fix round per segment. One local commit per clean segment. Nothing pushed until Don approves.

| # | Segment | Spec | Status | Commit |
|---|---------|------|--------|--------|
| 0 | Blueprint docs + check/e2e/validator tooling | — | done | 4b07b6d |
| 1 | Engine fixes, save v2, Easy rule, giveaway rule, question-type plumbing | §1 (+ §5 rendering) | done — check + e2e 22/22 | seg 1 commit |
| 2 | Map UX: pan, pointer/pinch zoom, focus, markers, labels, style | §2 | pending | |
| 3 | Sound, confetti, Baron, victory screen, visual polish | §3 | pending | |
| 4 | Hand-written geography bank (xtra files, full coverage) | §4 | pending | |
| 5 | Flags + capitals + map-tap generated questions | §5 | pending | |
| 6 | Math module + subject choice + hint UI | §6 | pending | |
| 7 | Hardening pass (a11y, mobile, copy) + final screenshots | all | pending | |
