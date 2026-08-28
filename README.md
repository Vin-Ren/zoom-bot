# zoom-bot

Spin up multiple **dummy participants** in a single Zoom meeting using
Playwright + Chromium. Each bot joins through the browser web client with a
distinct preset name. No microphone or camera access is requested.

For load testing, demos, and filling a room — not for disrupting meetings you
don't own.

---

## Requirements

- Node.js 18+
- The target meeting must allow **"Join from your browser"** and let guests in
  without a Zoom account.

## Setup

```bash
cd zoom-bot
npm install
```

`npm install` also runs `playwright install chromium` (and the lighter
`chromium-headless-shell` is used automatically in headless mode — install it
once with `npx playwright install chromium-headless-shell` if it's missing).

---

## Usage

```bash
npm start
```

Defaults: **3 bots, headless, one shared Chromium process, assets blocked.**

### Examples

```bash
# more bots
BOT_COUNT=8 npm start

# watch it happen (visible windows; one browser process per bot)
HEADLESS=false BOT_COUNT=3 npm start

# a different meeting
MEETING_URL="https://xxx.zoom.us/j/1234567890?pwd=abcd" npm start

# maximum isolation, still headless (one process per bot)
SHARED_BROWSER=false BOT_COUNT=5 npm start

# keep images/CSS (closer to a real client, more memory)
BLOCK_ASSETS=false npm start
```

Stop everything with **Ctrl+C** — all browsers close.

---

## Configuration (environment variables)

| Var              | Default                                | Meaning                                                        |
|------------------|----------------------------------------|---------------------------------------------------------------|
| `MEETING_URL`    | hardcoded UI-AC-ID join link           | Meeting to join. A `/j/<id>?pwd=` link is auto-rewritten to the `/wc/join/` web-client link. |
| `BOT_COUNT`      | `3`                                    | Number of concurrent bots.                                     |
| `HEADLESS`       | `true`                                 | `false` shows browser windows (and forces one process per bot).|
| `SHARED_BROWSER` | `true` (headless only)                 | All bots share one Chromium process (big memory saving). `false` = one process per bot. |
| `BLOCK_ASSETS`   | `true`                                 | Abort image / font / media / stylesheet requests.             |

---

## How it works

1. **Direct web-client URL.** `…/j/<id>?pwd=…` is rewritten to
   `…/wc/join/<id>?pwd=…` so the page never tries to launch the desktop app —
   no `zoommtg://` / `xdg-open` prompt. Any such navigation is also aborted at
   the network layer as a fallback.
2. **One isolated context per bot.** Separate cookies, storage, cache and
   session — whether or not the OS process is shared.
3. **Distinct identity per bot:**
   - **Name** — `assignNames()` shuffles `PRESET_NAMES` and gives each bot a
     unique one (numeric suffix once the list is exhausted).
   - **Fingerprint** — `fingerprint()` varies user-agent, viewport, locale,
     timezone and device-scale per context.
4. **Join flow.** Navigate → dismiss cookie/consent banners → fill the name
   field → click Join → dismiss the in-meeting audio dialog → idle in the
   meeting for one hour.

Edit `PRESET_NAMES`, `UA_POOL`, or the join timeout in `index.js`.

---

## Memory footprint

Lightest config is the default in headless mode:

- **`SHARED_BROWSER=true`** — all bots are isolated *contexts* inside a single
  Chromium process instead of N processes. Biggest single saving; each extra
  bot is roughly a renderer, not a whole browser.
- **`chromium-headless-shell`** — smaller binary/runtime than full Chromium,
  used automatically when headless.
- **`BLOCK_ASSETS=true`** — drops image/font/media/stylesheet requests.
- Lean Chromium flags: `--renderer-process-limit=1`,
  `--js-flags=--max-old-space-size=128`, `--disable-dev-shm-usage`,
  `--disable-gpu`, `--disable-extensions`, `--disable-background-networking`, …

Use `SHARED_BROWSER=false` only if you need process-level isolation per bot.

---

## Do shared-process bots get kicked?

No — Zoom can't see the OS process. Drops at the app layer come from:

- **Identical display names** → handled: every bot gets a distinct name.
- **Identical device fingerprint** → handled: per-context UA / viewport /
  locale / timezone.
- **Same public IP** → normal for the web client, not blocked for guests. If
  drops persist, run `SHARED_BROWSER=false` and/or route bots through separate
  networks or proxies.

---

## Notes & limitations

- Zoom changes its web-client DOM often. If a step is missed, run once with
  `HEADLESS=false` and adjust the selectors in `index.js`.
- Bots idle for one hour then exit; re-run to rejoin.
- Waiting rooms, authentication requirements, or registration-only meetings
  will block the bots at the corresponding step.
