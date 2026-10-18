# Coin Runner

Coin Runner is an original, code-drawn 2D platform game available in two editions: a Python/pygame desktop game and a browser version built with HTML5 Canvas, CSS, and JavaScript. Run, jump, collect coins, stomp enemies, avoid hazards, and reach the flag across three scrolling levels.

No third-party character art, music, or proprietary game assets are included. Both editions draw their visuals in code and generate simple sound effects at runtime.

![Coin Runner menu](screenshots/menu.png)

## Play in a browser

The web game lives in `docs/` and needs no build step, backend, database, API key, or paid service.

To preview it locally, start an HTTP server from the repository root:

```bash
python -m http.server 8000
```

Then open <http://localhost:8000/docs/>. On Windows, `py -m http.server 8000` works if `python` is not recognized. Opening `docs/index.html` directly may work, but an HTTP server matches GitHub Pages more closely.

### Deploy with GitHub Pages

1. Push the repository to GitHub.
2. Open the repository's **Settings → Pages**.
3. Under **Build and deployment**, select **Deploy from a branch**.
4. Select the publishing branch (usually `main`), choose `/docs` as the folder, and save.
5. GitHub will display the public URL after deployment finishes.

All web paths are relative, so the game works at a repository URL such as `https://username.github.io/repository/`.

## Run the Python desktop edition

Requirements:

- Python 3.10 or newer
- `pygame-ce` 2.5 or newer

Install and run:

```bash
pip install -r requirements.txt
python platformer.py
```

On Windows, use `py` instead of `python` if needed. Do not install `pygame` and `pygame-ce` together because they provide the same module and can conflict.

## Controls

| Action | Desktop keyboard | Browser touch |
|---|---|---|
| Move | Left/Right arrows or A/D | Left/Right buttons |
| Jump | Space, Up, or W; hold for more height | Jump button; hold for more height |
| Pause/resume | P or Escape | Pause overlay appears when focus is lost |
| Restart level | R from the desktop pause screen; button in browser pause/completion overlay | Restart level button |
| Help | H on the desktop menu/pause screen; **How to play** in browser | **How to play** button |
| Sound | M | Sound button |
| Confirm | Enter or Space | On-screen buttons |

## Features and rules

- Three levels: Sunny Meadow, Crystal Caves, and Sky Islands
- Scrolling camera and responsive Canvas presentation
- Variable-height jumping, coyote time, and jump buffering
- Coins, patrolling enemies, spikes, pits, and goal flags
- Three lives, temporary invulnerability after damage, knockback, and safe-ground recovery after falls
- 10 points per coin, 100 per enemy, 200 per completed level, and a 300-point all-coins bonus
- Score and lives carry between levels
- Persistent high score (`highscore.json` on desktop and browser `localStorage` on the web)
- Generated sound effects with mute support
- Keyboard controls in both editions and touch controls in the browser edition
- Start, pause, restart, level-complete, game-over, and victory states

## Tests

Run the Python suite from the repository root:

```bash
python -m unittest -v
```

The suite checks physics, collisions, jumping assists, hazards, enemies, scoring, game flow, rendering, sound generation, level validation, and recorded playability runs. To also run the slower live solver test:

```bash
RUN_SLOW_TESTS=1 python -m unittest -v
```

On PowerShell, set the variable first with `$env:RUN_SLOW_TESTS = "1"`.

The browser edition is static and dependency-free. Its JavaScript can be syntax-checked with:

```bash
node --check docs/js/game.js
```

## Editing levels

Desktop levels are defined as 14-row text maps in `levels.py`. The browser port mirrors those maps in `docs/js/game.js`.

| Symbol | Meaning |
|---|---|
| `.` | Empty space |
| `#` | Solid ground or platform |
| `o` | Coin |
| `^` | Spikes |
| `E` | Walking enemy |
| `P` | Player start (exactly one) |
| `F` | Goal flag (exactly one) |

After changing Python levels, run `python solver.py` to regenerate playable runs, then run the test suite. Mirror intentional map changes into the web edition so both versions remain aligned.

## Project structure

```text
docs/
  index.html       GitHub Pages entry point
  css/style.css    Responsive page, overlays, and touch controls
  js/game.js       Canvas renderer, game rules, input, and Web Audio
platformer.py      Desktop rendering, menus, controls, and sound
world.py           Testable desktop physics and game rules
levels.py          Desktop level maps
solver.py          Automated level playability solver
replays.json       Recorded winning runs used by tests
test_platformer.py Python automated tests
requirements.txt  Desktop dependency
screenshots/       Desktop screenshots
```

## Implementation notes

The browser edition closely follows the desktop constants and rules but is a JavaScript port rather than a Python runtime in the browser. Audio uses Web Audio oscillators instead of pygame's generated sample buffers. Browser high scores are stored per browser and origin, so they do not synchronize with the desktop `highscore.json` file or between devices.

## License and assets

Coin Runner uses original geometric artwork generated by its own rendering code. No Nintendo or Mario artwork, audio, names, or other copyrighted franchise assets are included. Review and add an explicit repository license before redistributing the source if the project does not already have one.
