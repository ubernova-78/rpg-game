# RPG Learning Game — local project

## Folder layout

```
rpg-game/
  game/       <- the actual game: open game/index.html in a browser to play
  tests/      <- the automated test suite (see "Running tests" below)
  package.json
```

Everything the game needs to run lives in `game/` — it's a static site (no build
step), so you can open `game/index.html` directly, or serve the folder with any
static file server if you hit browser file:// restrictions:

```
cd game
python3 -m http.server 8791
# then visit http://localhost:8791/index.html
```

## About the art assets

Most of the art in this game is **not** separate image files — it's embedded as
base64 text directly inside a few specific files:

- `assets_data.js` — the bulk of it: tiles, buildings, characters, UI icons
- `monster_assets.js` — the battle monster sprites
- `dojo_assets.js` — the dojo's wall-decoration weapons

There's also a real `assets/` folder with a handful of actual PNG files (a few
pieces cropped for the dojo). So there isn't one clean "drop your images here"
folder the way a typical project has — most art lives as text inside those three
`.js` files.

This was a deliberate choice early on, to keep everything self-contained and
avoid path/CORS issues in a sandboxed environment. It works fine, but it's not
the most natural setup for local development with Claude Code, where you'd
probably rather drop a PNG into a folder and reference it by path.

**If you want to switch to a real asset-folder structure** (recommended for
ongoing local work), that's a genuine one-time migration: decode the embedded
base64 back into real PNG files in `game/assets/`, and update the few `loadImage()`
calls to fetch by path instead of looking up the embedded data. This is a
reasonable first task to hand to Claude Code once it's set up — just describe
what you want and point it at this README.

## Running tests

The test suite in `tests/` is the same one used throughout this project's
development — it loads the actual game files in a headless browser-like
environment and checks real behavior (battles, PvP duels, the place-value and
measuring mini-games, etc.), not just that the code parses.

One-time setup:

```
npm install
```

Then run the main suite:

```
npm test
```

Two of the test files (`test_measure_bench.js` and `test_script_boundary.js`)
load the game over a real local HTTP server rather than reading files directly,
so start a server first:

```
cd game && python3 -m http.server 8791 &
cd ../tests
node test_measure_bench.js
node test_script_boundary.js
```

`test_script_boundary.js` specifically catches a class of bug the other tests
can't (script-load-order issues) — worth running after any change that touches
`index.html`'s `<script>` tag order or adds a new file.
