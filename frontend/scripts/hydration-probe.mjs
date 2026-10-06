/**
 * Hydration probe: loads each route several ways in headless Edge and reports
 * React hydration mismatches (console errors / recoverable errors).
 *
 *   terminal A:  cd frontend && npm run dev     (or: npm run build && npx next start -p 3001)
 *   terminal B:  node scripts/hydration-probe.mjs [APP_URL]
 */

import { existsSync } from "node:fs";
import puppeteer from "puppeteer-core";

const APP = process.argv[2] ?? process.env.APP_URL ?? "http://127.0.0.1:3000";
const EDGE =
  process.env.EDGE_PATH ??
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";

const issues = [];

function attach(page, scenario) {
  const record = (kind, text) => {
    if (/hydrat|did not match|server rendered|Minified React error/i.test(text)) {
      issues.push(`[${scenario}] ${kind}: ${text.slice(0, 600)}`);
    }
  };
  page.on("console", (msg) => record(`console.${msg.type()}`, msg.text()));
  page.on("pageerror", (err) => record("pageerror", String(err)));
}

async function main() {
  if (!existsSync(EDGE)) throw new Error(`Edge not found at ${EDGE}`);
  const browser = await puppeteer.launch({
    executablePath: EDGE,
    headless: true,
    args: ["--no-sandbox", "--disable-gpu"],
  });

  try {
    const page = await browser.newPage();

    // 1. hard load of /attendance
    attach(page, "hard /attendance");
    await page.goto(`${APP}/attendance`, { waitUntil: "networkidle2", timeout: 60000 });
    await new Promise((r) => setTimeout(r, 1500));

    // 2. client-side navigation recognition -> attendance -> recognition -> attendance
    attach(page, "client nav");
    await page.goto(`${APP}/recognition`, { waitUntil: "networkidle2", timeout: 60000 });
    await page.click('a[href="/attendance"]');
    await new Promise((r) => setTimeout(r, 1500));
    await page.click('a[href="/recognition"]');
    await new Promise((r) => setTimeout(r, 1000));
    await page.click('a[href="/attendance"]');
    await new Promise((r) => setTimeout(r, 1500));

    // 3. reload from the client-nav state (URL now /attendance)
    attach(page, "reload /attendance");
    await page.reload({ waitUntil: "networkidle2", timeout: 60000 });
    await new Promise((r) => setTimeout(r, 1500));

    // 4. back/forward navigation
    attach(page, "history back/forward");
    await page.goBack({ waitUntil: "networkidle2", timeout: 60000 }).catch(() => {});
    await new Promise((r) => setTimeout(r, 1000));
    await page.goForward({ waitUntil: "networkidle2", timeout: 60000 }).catch(() => {});
    await new Promise((r) => setTimeout(r, 1000));
  } finally {
    await browser.close();
  }

  if (issues.length === 0) {
    console.log(`\n${APP}: no hydration issues detected`);
  } else {
    console.log(`\n${APP}: ${issues.length} hydration issue(s):`);
    for (const issue of issues) console.log(`  ${issue}`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err?.stack ?? String(err));
  process.exitCode = 1;
});
