# Maple Layers

Layer MapleStory character parts and recolour them. Sprites belong to Nexon.

## Run
    npm install
    npm run dev          # http://localhost:5173

## Rebuild the sprite data (only if the item lists change)
    node scripts/build-manifest.mjs   # names in data/names.txt and data/hairface.txt -> data/items.json
    node scripts/download.mjs         # part sprites -> public/sprites (resumable)
    node scripts/download-skins.mjs   # body, arm and head parts per skin tone (raw WZ API)
    node scripts/download-map.mjs     # Henesys preview backdrop -> public/maps/
    node scripts/place-skins.mjs      # positions each body part inside data/skin-renders/<tone>.png
    node scripts/download-icons.mjs   # wearable inventory icons (the card previews)
    node scripts/add-pinned.mjs       # hair and face styles pinned by id (data/pinned.json)
    node scripts/download-rings.mjs   # name tag and chat bubble pieces (data/rings.json)
    node scripts/build-catalog.mjs    # -> public/catalog.json, the only file the app reads

## Files you edit by hand
- `data/names.txt` wearable names; `data/hairface.txt` hair and face names under `# hair male` style headers
- `data/rules.json` hat/hair hiding and layer-name fallbacks
- `data/placeholders.json` items that could not be found. They show in the app with a PLACEHOLDER badge.
  Items found but without a drawable sprite, and unresolved hair/face names, become placeholders automatically.
  Entries marked CHECK are guesses or names shared by several items.

## Checks
    node scripts/verify.mjs <name> <id,id,...>   # my layering vs the maplestory.io render
    node scripts/colour-check.mjs                # tone / chroma / brightness maths on single pixels
    node scripts/ui-test.mjs                     # browser test, needs the dev server running

Source: maplestory.io API (the data behind maplestory.wiki), GMS v110 with v210.1.1 as fallback.
Placement: top-left = anchor - origin - mapOffset; anchors in skin-PNG pixels: brow 17,14 / navel 17,45 / hand 29,51.

## Credits
Unofficial fan project, not affiliated with Nexon. Sprites and map art belong to Nexon and are served by maplestory.io. Item names and ids were checked against henesys.gg, MeowDB and the Maple Classic Wiki. The dye behaviour was checked against meaegi.com's dressing room (the maths here is our own). Fonts: Pixelify Sans, Silkscreen and Nunito, under the SIL Open Font License. The look was styled from a Lovable mockup. The footer in `index.html` carries the same credits.
