# Maple Layers: handoff notes for agents

Read this first; `README.md` has a shorter command list. This file describes the app as it is now. Where it and the code disagree, the code wins: fix this file.

## What it is
A one-screen website (page title `classic henehoes`; project name Maple Layers) for MapleStory Classic World:
- **Character book:** build an avatar from skin, face, hair and wearables (hat, face accessory, eye decoration, earrings, overall, top, bottom, gloves, shoes, cape, weapon, name tag ring, chat bubble ring), dye wearables with the game's Tone / Chroma / Brightness, try attack and ladder poses, save looks, and browse every released crate and box.
- **Housing book:** pick a home and place furniture in it (`src/housing.js`).
- Everything the app shows is stored in the project (`public/`). The running app makes **no API calls**; all sprite fetching happens in scripts.

Stack: Vite 5, vanilla JS (no framework). `pngjs` for scripts, `puppeteer-core` for browser tests (expects Chrome at `/Applications/Google Chrome.app`, hard-coded in `scripts/ui-test.mjs` and `scripts/layout-check.mjs`; `scripts/fetch-henesys.mjs` honours `CHROME_PATH`). Fonts self-hosted via `@fontsource/*` (Pixelify Sans, Silkscreen, Nunito, Noto Sans KR 500; all OFL). Deployed on Vercel.

## House rules
- **Keep the repository private.** MapleStory art belongs to Nexon; anything public needs sign-off first. Flag licensing when relevant.
- Commit locally; **push only when the owner says "push"**. Plan first (and check with the owner) before big features.
- Only the cash-shop content the owner specified is in the app: the Mystery Fashion Crates, Mystery Styles and Aurora Stamp Shop boxes. Pets, packs, megaphones, 10-day equip covers, Signature coupons and other shop items are deliberately left out. Drop rates are stored only where printed.
- British English, SGD, DD/MM/YYYY. No secrets in code (none are used). Never invent statistics or say something is tested unless it was run.
- User-facing wording (credits, notes, empty states) is usually the owner's exact text: do not reword it without asking.
- The saved Nexon pages (`*_Cash_Shop.html` + `_files/`) are source material only: git-ignored and purged from history. Never commit them.

## Run, build, test
    npm install
    npm run dev                      # http://localhost:5173 (use `npx vite --host ::` if localhost resolves oddly)
    npm run build                    # -> dist/
    node scripts/colour-check.mjs    # dye maths, no server needed
    node scripts/ui-test.mjs         # full browser test; needs the dev server running
    node scripts/layout-check.mjs    # layout at 3 window sizes; needs the dev server
    node scripts/verify.mjs <name> <ids>   # our layering vs a maplestory.io render

`scripts/ui-test.mjs` is the main regression suite (desktop, a 390x844 touch phone, zoomed-out and 3440px ultrawide pages). It reads `SHOW_UPCOMING` from `src/main.js` and takes item counts from `public/catalog.json`, so it follows the data. Tests that reload or open a second page must clear `maple-layers:working-v1`. Screenshots go to `tmp/` (ignored). Extend it when adding a feature.

Not tested: real Retina hardware or a real phone (only Chrome emulation; WebKit was checked once with Playwright's iPhone profile, installed outside the project), browsers other than Chrome.

## Data pipeline
`public/catalog.json` is the only data file the app reads (plus pictures and the pose/housing JSON). It is written by `node scripts/build-catalog.mjs`, which merges `data/items.json` with `data/rules.json`, `rings.json`, `boxes.json`, `upcoming.json`, `game-dye.json`, `weapon-types.json`, `zmap.json`, `skins*.json`, `henesys-*.json`, placeholders, and writes `warnings` (e.g. `dyeUnknown`, `boxUnresolved`, `noWeaponTypes`). **Re-run it after any data change.**

Sources:
- **maplestory.io** (scripts only): older wearables (GMS by name), Classic data region `MCW` version `1` for hair/face and newer wearables, the Henesys backdrop, skins (raw WZ endpoint).
- **The game's own files** (via libwz): hats, rings, dye flags, weapon types, poses, housing, some hair/face styles. The owner says extraction is permitted with credit.
- **henesys.gg**: Classic ids and the salon list (hair/face, both genders).

Steps (run what the change needs, then `build-catalog.mjs`):
- Wearables: `data/names.txt` -> `build-manifest.mjs` (also appends `data/mcw-wearables.json`, `collab-wearables.json`, `game-wearables.json`; entries may carry `region`, `classicId`, `collab`) -> `download.mjs` (sprites into `public/sprites/wearable/<id>`; retries, `DOWNLOAD_WORKERS` default 6) -> `download-icons.mjs`.
- Hair/face: `fetch-henesys.mjs` (drives Chrome) -> `add-styles.mjs` (rebuilds every style in `data/items.json` from the salon list + MCW, applies `data/released.json`, appends `data/game-styles.json`, uses `data/art-sources.json` for styles MCW lacks) -> `download.mjs` (stores **every** colour of every style under `public/sprites/mcw/<kind>/<id>`; when MCW has only an icon it tries TWMS 256, JMS 444, GMS 270, TMS 209, SEA 220 and records `source` in `meta.json`).
- Skins: `download-skins.mjs` + `place-skins.mjs` (locates each part inside the flattened render in `data/skin-renders/`).
- Backdrop: `download-map.mjs` -> `public/maps/henesys.png` + `henesys.json` (`groundRow`, `footholdRow`, `centreX`).
- Favicon: `make-favicon.mjs` (Orange Cat Beanie icon).
- From the game files (need `WZ_DATA`): `extract-wearables.mjs cap`, `extract-styles.mjs <hair|face> <ids>`, `extract-rings.mjs`, `extract-dyeable.mjs` (-> `data/game-dye.json`), `extract-weapon-types.mjs` (-> `data/weapon-types.json`), `extract-upcoming.mjs` (-> `data/upcoming.json`, `public/sprites/upcoming/`), `extract-weapon-hold.mjs <id> <class>`, `extract-poses.mjs` (about 2 min; -> `public/poses/`, `public/sprites/pose/`), `extract-housing.mjs` (-> `public/housing/`).

Game-file environment (`scripts/lib-wz.mjs`):
- `WZ_DATA` = the client's Data folder. On this Mac (CrossOver): `~/Library/Application Support/MapleStoryNA/Bottles/maplestory/drive_c/Nexon/Library/maplestorycw/appdata/Data`.
- `WZ_VERSION` (default `779`): the files only open with the right client version.
- `LIBWZ_DIR`: load libwz from a local checkout (`<dir>/dist/index.js`) instead of the package.
- Install libwz for a run with `npm install --no-save --ignore-scripts libwz`. **Never add libwz to `package.json`**: its install step builds a native addon and breaks `npm install` on Vercel.
- libwz cannot write to a path it wrote before (even after a rename), so extractors write pictures through fresh temporary names.

Hand-edited data:
- `data/rules.json`: `partHiddenBy`, `zFallback`, `fitHelmet`, `stand2Only`, `baseBody`, `listFirst`, `upcomingExclude`, `useEarlierId`, `exclude`, `holds` (unused by the app now; the file's `_comment` still describes a Hold choice that was removed).
- `data/released.json`: released hair/face styles per gender, by name or Classic id (a number). A name releases only the lowest-id style with that name. Then run `add-styles.mjs` and `build-catalog.mjs`.
- `data/boxes.json`: groups (`mystery-crates`, `mystery-styles`, `aurora`; `tab` is the short label, `title` the long one) and boxes (`name`, `pill`, `dates`, `start`/`end` in UTC, `latest`, `pending`, `note`, `items` by name with optional `rate`, `kind`/`gender`/`sex` for styles, `match` when the game name has a colour prefix, e.g. "Black Wild Tangles Hair").
- `data/names.txt`, `data/placeholders.json`. `data/hairface.txt` and `data/pinned.json` are no longer used for styles.
- Legacy, safe to ignore: `scripts/lookup.mjs`, `calibrate*.mjs`, `add-pinned.mjs`, `data/matched*.json`, `data/unmatched*.json`.

## Code map
- `src/main.js`: state, UI, drawing. `src/compose.js`: `composite`, `blit` (alpha-correct), `adjustColour` (dye). `src/ring.js`: name tag drawing (`drawNameTag`, `drawPlainTag`, `loadFont`). `src/housing.js`: the Housing book. `src/style.css`: all styles. The phone layout is the `@media (max-width: 800px)` block.
- **State:** `state = fresh()` holds `sex`, `skin`, `face`/`hair` `{style, colour}`, `wear[slot]` `{item, h, c, b, two}` and `text.name`. `two` is unused. Other module state: `gender` (Face/Hair list filter), `activeTab` (opens on `'past'`), `mode` (`'character' | 'housing'`), `source` (`'released' | 'rotation' | 'datamine'`), `crate`, `hatFit`, `weaponType`, `search`, `browse` (list colour), `configTarget` (selected Equipped tile), `pose`, `resting`, `baseline`.
- **Render cycle:** `afterChangeKeep` runs `renderTabs`, `renderFilters` (search box, plus the switch row in `#source`), `renderContent`, `renderColour` (Equipped panel), and `renderPreview`. Card builders `skinCard`, `styleCard`, `wearableCard`, `ringCard` and `optionCard` are shared by every tab. `infoNote` draws the framed "i" note.
- **Drawing:** `buildLayers(sel, view)` requests every part at once, then `withScene` composes into a **fresh canvas per call**, then `paintFocus` draws whole device pixels.
- Working canvas `W x H` = 160 x 230, skin at `OX, OY` = 60, 112.
- Views: `VIEW` (head-and-chest crop, `ART_H` 84px art), `BODY_VIEW`/`LOOK_VIEW` (whole body, `.art-box.tall`), `MINI_VIEW` (Equipped tiles), `PREVIEW_VIEW` 150 with `PREVIEW_PAD` 256.
- `#preview` exposes `data-zoom`, `data-view` and `data-pose` for tests.
- `exportPng()` exists but is not wired to any button.
- **Feature flags:** `SHOW_UPCOMING = false`. `DISABLED_SLOTS` is empty (a slot named there is hidden everywhere).
- **Storage keys** (localStorage, prefix kept as `maple-layers:` so saves survive): `looks-v1` (Look Book), `working-v1` (the stage's current look and baseline), `default-v2` (legacy single default, migrated into the book as `look-1` on first read), `housing-v2`.
- Vercel Analytics: `if (import.meta.env.PROD) import('@vercel/analytics').then(m => m.inject()).catch(() => {})`. **Keep it a dynamic, fail-safe import.** A static import let ad blockers (which block anything named "analytics") kill the whole module graph and blank the page. Mention analytics in any privacy notice.
- `vercel.json` caches `/assets` for a year, `/sprites` and `/maps` for 7 days, and `catalog.json` for 1 hour. A sprite regenerated in place can show up to 7 days late.

## Rendering facts (hard to rediscover)
- **Placement:** part top-left = `anchor - origin - mapOffset`. Anchors in skin-PNG pixels: brow (17,14), navel (17,45), hand (29,51); two-handed hand (22,45) (`ANCHORS`/`ANCHORS2` in `build-catalog.mjs`).
- **Layer order** comes from the game's `data/zmap.json`. Each part carries its game layer name. `zFallback` maps names zmap lacks (e.g. `mailChestBelowBody` -> `backMailChest`).
- **Hiding** uses the game's slot codes (`Base/smap.img`). A part whose layer is in `partHiddenBy` is hidden when **another** worn item lists that code in its `vslots` (an item never hides its own parts; `covering` in `buildLayers`):
  - H1 hides `hairOverHead`; H2 hides `hair`.
  - Hb hides `hairBelowBody`; Hs hides `hairShade`.
  - Hd head, Fc face, Af face accessory, Ay eye decoration, Ae earrings.
  - H3 to H6 and Hf are **back-view** layers. They do nothing here, but hats list them.
- **Hair** takes only `default/hair`, `hairOverHead`, `hairBelowBody`, `hairShade`. `backDefault/*` is the back view (ladders and ropes). Drawing it doubles the hair, so **do not extract it**.
- `hairShade` is one picture per skin tone (`tones` on the part; `buildLayers` skips parts whose `tones` exclude the worn skin). It is shared between poses (`shared: true`).
- **Overall vs top/bottom** are mutually exclusive (`select`).
- **Undergarments:** `baseOf(sel)` draws the gender's starter top/bottom (`rules.baseBody` -> `catalog.base`) unless a top, bottom or overall covers them. They are not in `state.wear`, not in Top/Bottom lists, have no tile. Any `fresh()` used for a preview must copy `sex` and `skin`.
- **Two-handed stance:** only weapons in `stand2Only` (Toy Rifle: no one-handed art) get `pose: 'stand2'` and switch the whole body to `parts2`.
  - Every other weapon stands one-handed, so there is no Hold choice: a cash weapon is drawn from the class of the weapon held, so the real hold varies.
  - The Orange Toy Hammer's one-handed art was extracted from the game (class 30) by `extract-weapon-hold.mjs` (maplestory.io only had stand2).
- **Crisp pixels:** sprite pixels are whole device pixels. Never CSS-scale canvases by non-whole factors.
  - `init()` redraws on `resize` **and** polls `devicePixelRatio` twice a second, because zoom and display changes often send no event.
  - The redraw must include `renderColour()`.
- **WebKit trap:** every thumbnail must compose into its own canvas (`withScene`). A shared scratch canvas made each iPhone card show its neighbour's art.
- **Preview:**
  - The stage is 330 CSS px (`--stage-h` via `setStageHeight`, taller up to 480 when zoomed out; 235px on a phone).
  - Zoom is the largest whole number that fits `viewW`/`viewH` per axis.
  - Wearing a ring widens the frame to fit it (only measured on the unpadded scene).
  - `PREVIEW_PAD` lets big weapon effects run off the stage.
  - Thumbnails are not padded.
- **Backdrop:** `drawBackdrop` lines `groundRow` (feet planted a few rows into the grass) up with `FOOT_EDGE`. It mirrors the 800px picture left, right and below so wide or zoomed-out stages are always full. Sky/meadow come from `Map/Back/grassySoil.img` layers 0, 1, 4 over the Henesys street floor (map x=1700).
- **Dye** (`adjustColour`): game model as seen on meaegi.com.
  - Tone 0-359 (HSL hue turn).
  - Chroma -99..99 (linear saturation).
  - Brightness -99..99 (blend toward white/black).
  - Pure black and white are never changed; colours on the 17-step palette stay on it (channels cap at 238).
  - +Chroma has no visible effect on already-saturated sprites. That is not a bug.
- **Dyeable:** items the game knows but does not flag (`info/colorvar`) get `dyeable: false`. `dyeOf` then draws them undyed and the panel says "This item can't be dyed in the game."

## Features as they stand
**Layout.**
- `.topbar` holds the book tabs (`#books`, `.bk`, `renderBooks`) and the credits line, `Sprites © Nexon. Dye behaviour from meaegi.com.` (the owner's wording; README credits are longer on purpose).
- Left: stage (preview) above the Equipped panel. Right: the "book" with a tab rail (`renderTabs`, `TAB_NAMES`, `CHAPTER_TITLES`).
- `.grid` is `repeat(auto-fill, minmax(100px, 1fr))`, gap 8px. `--book-extra` (102px) keeps catalogue and Equipped cards the same width.
- `.app` is capped at 2400px and centred.
- Class-name traps: do not name a new class `.book` (the catalogue panel) or `.search` (the search box).

**Rail order:**
1. All (search; class `lookup`).
2. Body, Face, Hair (green "character" tabs).
3. Wearable tabs in `WEAR_ORDER` (Hat ... Weapon, Name Ring, Chat Ring).
4. Then, set apart: Look Book (pink), Released, Upcoming (purple).

A tab shows a check (`.tick`) when something in it is worn (never on Look Book, Released or Upcoming), and a "!" when it has released placeholders.

**Search (All tab, `renderSearch`).**
- Needs `MIN_SEARCH` (3) characters; matching ignores case, spaces and punctuation (`flat`).
- Results are grouped by category and capped at `MAX_RESULTS` (60). Rings and upcoming items are excluded.
- Typing debounces 150ms. Clicking equips and stays on the tab.
- Other tabs have a per-list search box. It clears on tab change and is absent on Released, Upcoming and Look Book.

**Body.**
- Cards show the whole body per skin (`SKIN_NAMES`; tones 9, 12, 13 are not in Classic and are hidden).
- `Gender: Male | Female` (`renderSexPicker`, `state.sex`) picks the undergarments. It is separate from the Face/Hair list filter; whether they should be linked is undecided.

**Face and Hair (`renderStyles`).**
- Colour bar (`renderColourBar`, `HAIR_COLOURS`/`EYE_COLOURS`) recolours the list only (`browse`), never what is worn.
- `All / ♂ Male / ♀ Female` filter (`gender`, default All; collab styles are `gender: 'both'`).
- `Show: Released | Mystery Rotation | All · Datamine` (`renderSourceSwitch`). Mystery Rotation lists only styles in a Mystery Styles box on sale now, with an ends line. Released is a clean list with no rotation markers (per-card labels were tried and judged too busy).
- Datamine cards: blue frame + DATAMINE badge. Frieren collab: green `FRIEREN COLLAB` badge. Tooltips show the Classic id.
- A new character has no face or hair, and cards never borrow a face.
- **White eyes:** cannot be set with the Signature Eye Colour Coupon (owner's report). `NO_COUPON_EYES`, `eyeWhiteNote` and `whiteEyesWorn` warn on the swatch, the list, the Equipped tile/panel and the colour preview.

**Wearable tabs (`renderWearable`).** Clicking a card equips it; clicking the worn card takes it off. Wearables sort by sprite id (Classic id for hats and game-file items), with `listFirst` ids first.
- **Hat "Fit" filter** (`renderFit`, `hairEffectOf`, `HAT_FITS`):
  - Topper = no H1 (hair untouched).
  - Cap = H1 without H2 (hair flattened).
  - Helmet = H2, or listed in `rules.fitHelmet` (Demon Goblin, Iljimae Mask), which sets `item.fit`.
  - The names are ours: the game has no player-facing term.
  - Counts are in the buttons. The filter is kept across tabs, not saved.
  - About 16 game hats list H1 but not H2 yet look like helmets, so spot-check when adding hats.
- **Weapon "Type" filter** (`renderWeaponType`):
  - Each weapon's `worksWith` (from the game's item description via `extract-weapon-types.mjs`; `["weapon"]` = any weapon) says which weapon types it can be worn over.
  - `goesOver(item, type)` is true for "any weapon" items too.
  - `weaponTypeGroups` merges the `WEAPON_TYPES` that exactly the same set of listed weapons accepts into one option (e.g. "1H Sword / Axe / Blunt"), so options and counts follow the data. `weaponType` holds the first type of the chosen group.
- `.seg` switch rows wrap on narrow screens (`flex-wrap: wrap`, `min-width: 0`, 2px overlap and padding so wrapped lines align).

**Rings (Name Ring, Chat Ring).**
- All 76 name tags and 81 chat bubbles in the client are in the catalogue (duplicate White Label 1112222 skipped via `SKIP`). Released ones are `RELEASED` in `extract-rings.mjs`; the rest are datamine, with the same `Released | All · Datamine` switch.
- **Chat bubbles** are the item's own `info/sample` picture, not editable. Reason: several rings share a design number in this client, and the pieces for newer designs are missing, so piece-drawing gives wrong looks.
- A blank bubble gets text only when the game records its design's text colour (`clr`). Today only the Ink-and-Wash Thought Bubble qualifies, drawn as white "Maple" via `effect.text`. Do not guess colours for the other blank bubbles: the owner wants only deterministic output.
- **Name tags** are editable once worn (Name box, max 12 characters, placeholder/default `henehoe`, saved with the look). Each tag is drawn one of three ways:
  - From the game's design pieces (13 tags).
  - As a plain translucent box (White Label, `drawPlainTag`).
  - From pieces cut out of its sample (`cutTag`, with `MANUAL`/`TEXT` overrides in `extract-rings.mjs`). Patterned middles become plain strips.
- Cards and Equipped tiles show the sample picture.
- Placement: tag under the feet, bubble over the head (`ringLayer`).
- Text font is Noto Sans KR Medium 11px (the client's own English font).
- Scoreboard bubble animation is not done.

**Equipped panel (left, `renderColour`).**
- Small tiles (`equippedCard`, `MINI_VIEW`, `SHORT_LABEL`). Hover x (`removeEquipped`). Dye palette badge while dyed (`isDyed`, `syncDyed` flips it live without redrawing).
- The selected tile's panel starts with `panelHeading` (`<Category> · <name>`):
  - Face/hair: an Eye/Hair colour section of colour previews (`colourGrid`).
  - Wearables: Tone/Chroma/Brightness sliders with typed number boxes (`sliderRow`; gradient tracks) plus Random dye (full range) and Reset colour, or the can't-be-dyed note.
  - Weapons add a "Works with" chip section.
  - Rings: the Name box or a note.
- Every panel ends with **Availability** (`availability`, `BOX_NOUN`): "Available now · N days left · Mystery Face", "Last available … ago", "Not in any Mystery box on record" or "Not released yet".
- Empty state: an info note (says "above" on phones, `narrowLayout`).

**Stage tools.**
- Randomise: current gender filter, keeps rings, body gender and name; skips upcoming.
- Save to Look Book: always adds a new look.
- Undo changes since the look was loaded or saved (`undoChanges`, back to `baseline`).
- The page reopens on `working-v1`; on a first visit, on the newest saved look.

**Poses (`poseButtons`, `playPose`).**
- One column of buttons on the stage's right (one row along the bottom on phones): six attack motions (`MOTION_BUTTONS`: one-handed swing, two-handed swing, spear, dagger stab, crossbow, bow), then Ladder.
- Icons are the owner's pixel designs (`POSE_ICONS` letter grids, `poseSvg`, `ICON_SHADE`, drawn in `currentColor`).
- Each motion click plays its next action once (`motionStep`, wraps) and rests in the motion's stance (stand1 or stand2).
- Ladder climbs twice and returns to `resting` without resetting the count. There is no Stand button.
- A motion the worn weapon lacks is disabled (`motionFor`). Two-handed falls back to the polearm swings (`fallback`) for weapons with only those.
- Pose data is fetched on first press (`fetchPose`) from `public/poses/body.json` (`motions`, `actions`, points), `poses/w/<id>.json` and `poses/hair/<colour id>.json`; pictures are de-duplicated in `public/sprites/pose/<hash>.png`.
- The face moves with the brow and is hidden (with face/eye accessories) when the frame turns away.
- Weapon `effect` parts are drawn; afterimages are not. Thumbnails always stand. Rope and F variants are not extracted.

**Look Book (`renderLooks`).**
- Whole-body cards (`LOOK_VIEW`, sized to the body at the current zoom), newest first, no caption (number and date in the tooltip).
- Opening the tab never changes the character; clicking a card wears it.
- Hover x deletes at once, with no confirm.

**Released tab (`renderPast`).**
- Category file tabs (`.past-tab`, from `data/boxes.json` groups), date-first pills with sale dots (`onSale`, `.sale-dot`), then the selected box's title (under its date line, `boxWhen`: a dot and "Ends in 14 days" in green, or "Ended 1 day ago" in grey; the short form because the dates are already on the line above) and cards grouped by slot (Mystery Styles: Hairstyles/Faces sections with their colour bar, split Male/Female).
- Opens on the `latest` box (currently the Nov 4 crate).
- Rates appear only in card tooltips.
- Timing:
  - `start`/`end` are UTC. A timed `end` is the last minute sold (on sale to the end of that minute).
  - A date-only `end` (`isDay`) counts to the end of that UTC day.
  - No `end` means still on sale, with no ends line.
  - `tickEnds`/`wakeAt` update lines and dots only when their words change.

**Upcoming tab (`renderUpcoming`).** Shows only `unconfirmedNote()`, always fully expanded: upcoming items can no longer be datamined (Nexon now changes boxes during maintenance and no longer flags coming items as dyeable ahead of launch).
- With `SHOW_UPCOMING = false`, the possible-upcoming items (`upcoming: true` in the catalogue) are not listed anywhere, not randomised, not searchable and not restored from saves.
- Their code (`renderCrateSwitch`, `hasUpcoming`, `inView`, `regular`, UPCOMING badge) and data (`data/upcoming.json`, `public/sprites/upcoming/`) stay.
- Items from a released box are marked `released: true` in `data/upcoming.json` and become ordinary items.

**Housing (`src/housing.js`).**
- Tabs: Homes, then furniture groups (decor, chests, crafting stations; the placed art for stations is the NPC).
- 2 homes (Yellow Mushroom House, Kerning City Apartment), cropped to the house. The stage is sized to the home's shape (`sizeStage`), and the left column widens via `--left`.
- Pieces: max `MAX_PIECES` (16) per home. Drag to move. On-piece mirror and remove buttons (`placeButtons`). Keyboard: arrows, F, Delete. One stage tool: Clear all.
- Saved per home in `housing-v2`.
- Not done: snapping or collision, animation (first frame only), sharing a layout, Housing in Search. Chairs, reward items and the Straw Training Dummy (encrypted `.ms` pack) are left out.

**Phone (≤800px).**
- One column, in this order: sticky stage, book, Equipped, credits. Equipped goes last so nothing above a tapped card moves when it grows.
- `.side` uses `display: contents`. Tabs become a sideways strip whose scroll position is kept across re-renders. The page scrolls as a whole.
- The tab strip is not sticky (known trade-off).

## Gotchas
- `el()` filters only `null`/`undefined` children: write `cond ? el(...) : null`, never `cond && el(...)` (it prints "false").
- `extract-styles.mjs` mangles "Übel" in `data/items.json`, and a re-run rewrites hair PNGs with identical pixels. Restore both from git afterwards so only real changes show. Game strings with U+FFFD are patched in the extractors.
- Changing an item's id (e.g. moving it to its Classic id) silently drops it from looks saved under the old id.
- Classic ids differ from GMS sprite ids for many items. **A Classic id identifies the style** (MCW art at that id), not the name: name matching picked the wrong art.
- Weapon art in the client is stored per weapon class (`Character/Weapon/0<id>.img/<class>/<anim>`). A cash weapon is drawn from the class of what is held.
- `extract-upcoming.mjs` ignores items flagged `upcoming` when deciding what is already in the catalogue. `rules.upcomingExclude` keeps the Skull Overalls out on purpose.
- A box `end` with no time must be written date-only (`"2026-11-18"`). Add the time once Nexon prints it (the Nov 4 crate's end is date-only).

## Open items
- Nov 4 Mystery Fashion Crate: real end time and rates unknown.
- Not built: palette (hue-band) filter, dye-slider arrow buttons, skin-tone protection for chroma, hair/face thumbnails showing worn wearables, the gun-class (49) hold for the hammer, Scoreboard bubble animation, prone pose.
- The Orange Toy Hammer's two-handed art still comes from the API, not the game's class-30 stand2. It looks right but was never diffed.
- Possibly link the Body gender to the Face/Hair filter (undecided).
- Credits do not yet name the game files as a source. Add a privacy notice for Vercel Analytics before going public.
- `npm audit` reports a moderate esbuild/Vite dev-server advisory (fix needs a major Vite upgrade; it affects only the dev server).
- No admin panel, by decision: rules stay hand-edited files.
