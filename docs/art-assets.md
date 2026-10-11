# Geo Conquest: art asset list for the avatar portraits (for Rod's Colab run)

These are the raster portraits used in question feedback and for the Baron. The map badges and tokens are NOT on this list: they stay as vector shapes drawn in code, so they're sharp at every zoom.
Until a file exists and is listed in the manifest, the game uses its built-in placeholder SVG. When art arrives, drop the files in place and list them in the manifest. No code changes are needed.

## Files (33 portraits + 1 manifest)
Path pattern: `assets/avatars/<id>/<expression>.webp`

| Character | id | Files |
|---|---|---|
| Pirate captain | `pirate` | `assets/avatars/pirate/happy.webp`, `cheer.webp`, `oops.webp` |
| Astronaut | `astronaut` | `assets/avatars/astronaut/happy.webp`, `cheer.webp`, `oops.webp` |
| Fox explorer | `fox` | `assets/avatars/fox/happy.webp`, `cheer.webp`, `oops.webp` |
| Robot | `robot` | `assets/avatars/robot/happy.webp`, `cheer.webp`, `oops.webp` |
| Knight | `knight` | `assets/avatars/knight/happy.webp`, `cheer.webp`, `oops.webp` |
| Scientist | `scientist` | `assets/avatars/scientist/happy.webp`, `cheer.webp`, `oops.webp` |
| Deep-sea diver | `diver` | `assets/avatars/diver/happy.webp`, `cheer.webp`, `oops.webp` |
| Ninja cat | `ninjacat` | `assets/avatars/ninjacat/happy.webp`, `cheer.webp`, `oops.webp` |
| Safari ranger | `ranger` | `assets/avatars/ranger/happy.webp`, `cheer.webp`, `oops.webp` |
| Polar explorer (with a penguin) | `polar` | `assets/avatars/polar/happy.webp`, `cheer.webp`, `oops.webp` |
| Baron von Blunder (rival) | `baron` | `assets/avatars/baron/mischievous.webp`, `smug.webp`, `grumpy.webp` |

Expressions:
- Characters:
  - `happy`: friendly smile, the default and picker look.
  - `cheer`: big open grin, arms or fist up. Used for a right answer on a streak of 3 or more, or a math nudge bonus.
  - `oops`: surprised or sheepish, small "o" mouth, worried brows. Used for a wrong answer. Never sad or crying.
- Baron:
  - `mischievous`: sly grin, scheming. His default and idle look, and used for taunts.
  - `smug`: self-satisfied, chin up, monocle glint. Used when he steals a country or the player misses.
  - `grumpy`: sulking, arms crossed, moustache drooping. Used when the player wins a country or a continent.

Manifest (`assets/avatars/manifest.json`): list every file that exists, relative to `assets/avatars/`, for example
`{ "files": ["fox/happy.webp", "fox/cheer.webp", "baron/smug.webp"] }`. The game only loads listed files, so a missing file never causes a 404. Partial sets are fine.

## Technical specs (every file)
- Size: **512 × 512 px**, square. The game shows them at 48 to 160 px, so this covers 3× screens.
- **Transparent background** (alpha). No white box, no drop-shadow baked onto the background.
- Shipped format: **WebP** (lossy, quality about 80, with alpha). Keep the PNG masters in the Colab or Drive folder; they're not shipped.
- File size target: **20 to 60 KB** each. Hard limit 80 KB.
- Lowercase file names exactly as listed above.
- Post-processing (not shipped): remove background → trim → pad back to square, with the character centred and about 6% margin → resize to 512 → export WebP → write `manifest.json` → make a contact sheet (all 33 on one page, labelled id/expression) for Don's keep/redo review.

## Style guide (one locked style for all 33)
- **One consistent friendly cartoon style:** flat colours with soft cel shading, clean dark-brown outlines (not pure black) about 3 to 4 px at 512 px, big expressive eyes, rounded shapes. Same line weight, lighting (soft key light from the top left) and rendering for every image. Use one fixed style prompt and negative prompt, and keep the same seed family per character across its three expressions.
- **Framing:** head-and-shoulders bust, facing the viewer or a slight three-quarter turn. The head fills about 60% of the frame height, shoulders cut off at the bottom edge, with the signature item visible (hat, helmet, ears).
- **Readable at 64 px:** strong silhouette, high contrast between face and costume, no fine detail that depends on size, no text or lettering.
- **Palette:** bright, saturated, kid-friendly. Each character keeps the main and background colours of its placeholder (shown in the game's picker) so the map badge and the portrait match. Suggested anchors:
  - pirate: crimson and gold
  - astronaut: white and teal
  - fox: orange and white on teal
  - robot: violet and silver
  - knight: steel grey and red plume on gold
  - scientist: white coat and goggles on blue
  - diver: brass helmet on cyan
  - ninja cat: black mask on pink
  - ranger: khaki hat on lime
  - polar: blue parka with a fur hood on orange, plus a small penguin peeking from the shoulder
  - Baron: purple top hat, monocle, curly black moustache
- **Kid-friendly:** for a 12-year-old. No weapons drawn or pointed. The knight can have a shield and the pirate a spyglass, but no swords out. Nothing scary, no gore. The Baron is silly-villain, not menacing.
- **Diverse:** human characters (pirate, astronaut, scientist, ranger, polar explorer, knight if the face shows) cover a range of skin tones, and are a mix of girls and boys or kept neutral. Match the placeholder skin tones.
- **Original only:** no real people, no celebrity likeness, no copyrighted or trademarked characters (nothing resembling Disney, Pixar, Pokémon, Nintendo or Star Wars designs), no logos, no watermarks.
- **License check for the model (required before generating):** confirm the open-source image model's license allows using its outputs commercially and publicly in a game. Examples: Stable Diffusion XL is under CreativeML Open RAIL++-M, which allows this. FLUX.1-schnell is Apache-2.0. FLUX.1-dev is non-commercial, so avoid it. Check every LoRA or checkpoint too. Write the model name, version, license and link in `assets/avatars/LICENSE-art.txt`.
