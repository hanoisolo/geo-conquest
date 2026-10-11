# Geo Conquest: Avatars + Passport release (proposed by Rod, Oct 11 2026; Don said go ahead)

Repo: hanoisolo/geo-conquest (conquest.inguyen.ca). Audience: Don's son, 12, grade 7.
Keep the existing stack and rules: plain HTML/CSS/vanilla JS, no build step, no frameworks.
Follow Forge's PLAYBOOK: plan with Don first, one section at a time, check + e2e at 1280x800 and 390x844,
visual review, decisions log, no push without Don's approval.

## Goal
Make the game look colourful and personal: each player has a character token (Monopoly-style) that
appears on the map, and a passport book that collects what they've conquered.

## A. Avatars (first)
- Character picker: 8-12 original cartoon explorer characters (e.g. pirate, astronaut, fox explorer,
  robot, knight, scientist, diver, ninja cat). Kid-friendly, diverse, no real people, no copyrighted characters.
- Solo: the player picks one. Multiplayer setup: each player picks one (unique), alongside the existing colour.
- Saved in the solo save and the multiplayer save (migrate old saves: default avatar, never crash).
- Map:
  - Full token on the player's home country (multiplayer) / starting country (solo).
  - Claimed countries keep the owner's colour fill and get a small round face badge (vector/SVG or tiny
    image) at the country's marker point; at world zoom badges stay small or hide to avoid clutter;
    zooming in grows them into full tokens. Must stay tappable and not block country clicks.
  - Tiny countries (existing round markers) show the badge on the marker.
- Conquest animation: the token hops from the player's nearest owned country (or home) to the new
  country and plants a flag; reuse existing confetti/sound; respect prefers-reduced-motion.
- Expressions: each character has happy / cheer / oops images used in the question result feedback.
- Baron von Blunder: illustrated portrait with mischievous / smug / grumpy expressions replacing or
  upgrading the current animated Baron (keep the taunts).

## B. Passport book (second)
- Every conquered country stamps a passport page: flag (existing assets/flags), capital (data/capitals.json),
  continent, and one fun fact (reviewed, stable textbook facts; Forge fact-checks).
- Opens from the side panel; pages grouped by continent; shows collected vs total; works on a 390px phone.
- Solo: stored with the solo save. Multiplayer: per-player passport for that game (optional, raise with Don).

## C. Later (not in this release unless Don wants)
- Landmark cards unlocked per continent win (illustrated), shown on the victory screen and in the passport.
- Unlockable cosmetic outfits for 100% continent mastery (safari hat, parka, etc.).

## Art pipeline
- Character portraits, expression sets, the Baron, and (later) landmark cards: generated on Don's Google
  Colab (G4 GPU, 200 credits/month) with an open-source image model, one locked style guide and palette for
  consistency. Check each model's license allows this use. Rod runs the Colab notebook; Forge specifies the
  exact asset list, sizes and file names, and integrates them.
- Post-processing script (not shipped with the game): remove background, trim, resize, export WebP/PNG with
  transparency, target ~20-60 KB each; contact sheet for Don's keep/redo review.
- Map badges and tokens that must stay sharp at every zoom: simple vector shapes by Forge, using the
  character's colours/face, not the raster art.
- Placeholder art (simple coloured SVG tokens) first so code can be built and tested before the art is ready.

## Done means
- Picker, map tokens/badges, hop animation, expressions and Baron art work in solo and multiplayer,
  on desktop and phone, with old saves loading fine; passport book complete for all 68 countries;
  check + e2e pass; Don approves the screenshots before any push.
