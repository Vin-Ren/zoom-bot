import { chromium } from "playwright";

// ---- Config ----------------------------------------------------------------

const MEETING_URL =
  process.env.MEETING_URL ||
  "https://ui-ac-id.zoom.us/j/91675026657?pwd=mJ311AYyOoO1OAbCCkvwemMestpLIz.1";

// How many bots to launch at once.
const BOT_COUNT = Number(process.env.BOT_COUNT || 3);

// Run headless (no visible window) unless HEADLESS=false.
const HEADLESS = process.env.HEADLESS !== "false";

// Memory: share ONE browser process across all bots (isolated context each).
// Set SHARED_BROWSER=false to give every bot its own browser process instead.
const SHARED_BROWSER = process.env.SHARED_BROWSER !== "false" && HEADLESS;

// Memory: block images / fonts / media / css (unless BLOCK_ASSETS=false).
const BLOCK_ASSETS = process.env.BLOCK_ASSETS !== "false";

// Preset names – each bot gets a DISTINCT one (Zoom can make identical
// display names look like duplicates / drop-outs).
const PRESET_NAMES = [
  "Andi Pratama",
  "Budi Santoso",
  "Citra Lestari",
  "Dewi Anggraini",
  "Eko Nugroho",
  "Fitri Handayani",
  "Gilang Ramadhan",
  "Hana Kusuma",
  "Indra Wijaya",
  "Joko Susilo",
  "Kartika Sari",
  "Lukman Hakim",
];

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shuffle = (arr) => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

// Distinct name per bot; add a suffix once the preset list runs out.
function assignNames(count) {
  const pool = shuffle(PRESET_NAMES);
  return Array.from({ length: count }, (_, i) =>
    i < pool.length ? pool[i] : `${pool[i % pool.length]} ${Math.floor(i / pool.length) + 1}`
  );
}

// A distinct-ish "device" fingerprint per bot so N sessions from one machine
// don't look like one client being cloned.
const UA_POOL = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
];
function fingerprint(i) {
  return {
    userAgent: UA_POOL[i % UA_POOL.length],
    viewport: {
      width: 1200 + ((i * 37) % 240),
      height: 720 + ((i * 53) % 180),
    },
    locale: pick(["en-US", "en-GB", "id-ID"]),
    timezoneId: pick(["Asia/Jakarta", "Asia/Makassar", "Asia/Singapore"]),
    deviceScaleFactor: pick([1, 1.25, 2]),
  };
}

// Turn a normal join link (…/j/<id>?pwd=…) into the direct web-client link
// (…/wc/join/<id>?pwd=…). This skips the "open zoommtg:// / xdg-open" prompt
// entirely because the page never tries to launch the desktop app.
function toWebClientUrl(url) {
  try {
    const u = new URL(url);
    const m = u.pathname.match(/\/j\/(\d+)/);
    if (m) u.pathname = `/wc/join/${m[1]}`;
    return u.toString();
  } catch {
    return url;
  }
}

const WEB_URL = toWebClientUrl(MEETING_URL);

// Lean Chromium flags – trims per-process and renderer memory.
const LEAN_ARGS = [
  "--use-fake-ui-for-media-stream", // auto-dismiss mic/cam prompt
  "--disable-blink-features=AutomationControlled",
  "--disable-external-intent-requests", // no xdg-open for zoommtg://
  "--disable-dev-shm-usage",
  "--disable-gpu",
  "--disable-extensions",
  "--disable-background-networking",
  "--disable-sync",
  "--disable-translate",
  "--disable-component-update",
  "--mute-audio",
  "--no-first-run",
  "--no-default-browser-check",
  "--renderer-process-limit=1",
  "--js-flags=--max-old-space-size=128",
];

const LAUNCH_OPTS = {
  headless: HEADLESS,
  args: LEAN_ARGS,
  // headless-shell is a much smaller binary/footprint than full Chromium.
  ...(HEADLESS ? { channel: "chromium-headless-shell" } : {}),
};

// ---- Single bot ----------------------------------------------------------

async function attachBot(context, id, name) {
  const tag = `[bot ${id} | ${name}]`;
  const page = await context.newPage();

  // Block heavy resources + any zoommtg:// handoff.
  await page.route("**/*", (route) => {
    const req = route.request();
    const url = req.url();
    if (url.startsWith("zoommtg:") || url.startsWith("zoomus:")) {
      return route.abort();
    }
    if (
      BLOCK_ASSETS &&
      ["image", "media", "font", "stylesheet"].includes(req.resourceType())
    ) {
      return route.abort();
    }
    return route.continue();
  });

  try {
    console.log(`${tag} opening web client…`);
    await page.goto(WEB_URL, { waitUntil: "domcontentloaded" });

    for (const sel of [
      'a:has-text("Join from your browser")',
      'a:has-text("Join from Your Browser")',
    ]) {
      const el = page.locator(sel).first();
      if (await el.count().catch(() => 0)) {
        await el.click().catch(() => {});
        await sleep(1500);
      }
    }

    for (const sel of [
      'button:has-text("Accept Cookies")',
      'button:has-text("Accept")',
      "#onetrust-accept-btn-handler",
    ]) {
      const el = page.locator(sel).first();
      if (await el.count().catch(() => 0)) await el.click().catch(() => {});
    }

    const nameInput = page
      .locator('#input-for-name, input[placeholder*="name" i], input#inputname')
      .first();
    await nameInput.waitFor({ timeout: 20000 });
    await nameInput.fill(name);

    const joinBtn = page
      .locator('button:has-text("Join"), #joinBtn, button.preview-join-button')
      .first();
    await joinBtn.click();

    console.log(`${tag} join clicked – staying in meeting.`);

    await sleep(4000);
    for (const sel of [
      'button:has-text("Continue without Audio")',
      'button:has-text("Cancel")',
      'button[aria-label="close"]',
    ]) {
      const el = page.locator(sel).first();
      if (await el.count().catch(() => 0)) await el.click().catch(() => {});
    }

    await page.waitForTimeout(1_000 * 60 * 60);
  } catch (err) {
    console.error(`${tag} error:`, err.message);
  }
}

// ---- Launch all bots ----------------------------------------------------

async function main() {
  console.log(
    `Launching ${BOT_COUNT} bot(s) into:\n  ${WEB_URL}\n` +
      `(headless=${HEADLESS}, sharedBrowser=${SHARED_BROWSER}, blockAssets=${BLOCK_ASSETS})\n`
  );

  const browsers = [];
  const cleanup = async () => {
    await Promise.all(browsers.map((b) => b.close().catch(() => {})));
    process.exit(0);
  };
  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);

  const jobs = [];
  const names = assignNames(BOT_COUNT);

  // Shared browser (one process) if enabled; each bot still gets a fully
  // isolated context with its own cookies/storage AND a distinct fingerprint,
  // so Zoom sees N independent guests, not one client cloned.
  let sharedBrowser = null;
  if (SHARED_BROWSER) {
    sharedBrowser = await chromium.launch(LAUNCH_OPTS);
    browsers.push(sharedBrowser);
  }

  for (let i = 1; i <= BOT_COUNT; i++) {
    let browser = sharedBrowser;
    if (!browser) {
      browser = await chromium.launch(LAUNCH_OPTS);
      browsers.push(browser);
    }
    const context = await browser.newContext({
      permissions: [],
      ...fingerprint(i),
    });
    jobs.push(attachBot(context, i, names[i - 1]));
    await sleep(2000);
  }

  await Promise.all(jobs);
}

main().catch((e) => {
  console.error("fatal:", e);
  process.exit(1);
});
