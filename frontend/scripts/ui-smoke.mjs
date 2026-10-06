/**
 * Browser smoke test for the four screens.
 *
 * Drives the real UI in headless Edge (already installed on Windows - no
 * browser download) against a running backend + `next dev` server:
 * dashboard -> enroll a student -> upload face photos -> recognise a classroom
 * photo -> mark attendance -> correct a status -> read the audit trail.
 *
 *   terminal A:  cd backend  && ... uvicorn app.main:app
 *   terminal B:  cd frontend && npm run dev
 *   terminal C:  cd frontend && npm run test:ui
 *
 * Requires the demo assets in backend/test_data.
 */

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const APP = process.env.APP_URL ?? "http://127.0.0.1:3000";
const EDGE =
  process.env.EDGE_PATH ??
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";

const here = fileURLToPath(new URL(".", import.meta.url));
const testAsset = (...parts) => resolve(here, "..", "..", "backend", "test_data", ...parts);
const FACES = ["01.jpg", "02.jpg", "03.jpg"].map((f) =>
  testAsset("students", "101_Rahul_Sharma", f),
);
const CLASSROOM = testAsset("attendance", "classroom_01.jpg");

const ROLL = `99${String(Date.now()).slice(-4)}`;
const NAME = "UI Smoke Student";

let passed = 0;
let failed = 0;

function check(label, ok, detail = "") {
  if (ok) {
    passed += 1;
    console.log(`  PASS  ${label}${detail ? `  (${detail})` : ""}`);
  } else {
    failed += 1;
    console.log(`  FAIL  ${label}${detail ? `  (${detail})` : ""}`);
  }
  return ok;
}

/** Wait until the page text matches, with a readable timeout. */
async function waitForText(page, pattern, timeout = 30000) {
  try {
    await page.waitForFunction(
      (source) => new RegExp(source, "i").test(document.body.innerText),
      { timeout },
      pattern.source ?? pattern,
    );
    return true;
  } catch {
    const text = (await page.evaluate(() => document.body.innerText))
      .replace(/\s+/g, " ")
      .slice(0, 400);
    console.log(`        timed out waiting for /${pattern}/ — page said: ${text}`);
    return false;
  }
}

/**
 * Click a button inside the table row whose text contains `rowText`.
 * Retries, because the table is replaced by a spinner while it refetches.
 */
async function clickInRow(page, rowText, buttonText, timeout = 30000) {
  const deadline = Date.now() + timeout;
  let problem = `no row containing "${rowText}"`;
  while (Date.now() < deadline) {
    problem = await page.$$eval(
      "tbody tr",
      (rows, wantRow, wantButton) => {
        const row = rows.find((r) => r.innerText.includes(wantRow));
        if (!row) return `no row containing "${wantRow}"`;
        const button = [...row.querySelectorAll("button")].find(
          (b) => b.innerText.trim() === wantButton,
        );
        if (!button) return `no "${wantButton}" button in that row`;
        button.click();
        return null;
      },
      rowText,
      buttonText,
    );
    if (problem === null) return null;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return problem;
}

async function main() {
  if (!existsSync(EDGE)) throw new Error(`Edge not found at ${EDGE}`);
  if (!existsSync(CLASSROOM)) throw new Error(`missing demo asset ${CLASSROOM}`);
  console.log(`\napp: ${APP}\n`);

  const browser = await puppeteer.launch({
    executablePath: EDGE,
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-gpu",
      "--disable-dev-shm-usage",
      "--disable-extensions",
      "--no-first-run",
      "--disable-background-networking",
    ],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1360, height: 900 });

  const consoleErrors = [];
  const pageErrors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => pageErrors.push(String(err)));
  page.on("dialog", (dialog) => void dialog.accept());

  try {
    /* ---------------------------------------------------------- dashboard */
    console.log("dashboard");
    await page.goto(`${APP}/`, { waitUntil: "networkidle2", timeout: 60000 });
    check("page renders", await waitForText(page, "dashboard"));
    check(
      "health data shown",
      await waitForText(page, "match threshold", 20000),
      "threshold stat present",
    );
    const body = await page.evaluate(() => document.body.innerText);
    check("storage backend reported", /memory|mongodb/i.test(body));

    /* ------------------------------------------------------------ students */
    console.log("\nstudents + face enrollment");
    await page.goto(`${APP}/students`, { waitUntil: "networkidle2", timeout: 60000 });
    check("registry renders", await waitForText(page, "registry"));

    await page.click("button::-p-text(New student)");
    await page.waitForSelector('input[placeholder="101"]');
    await page.type('input[placeholder="101"]', ROLL);
    await page.type('input[placeholder="Rahul Sharma"]', NAME);
    await page.type('input[placeholder="8"]', "8");
    await page.type('input[placeholder="A"]', "A");
    await page.click("button::-p-text(Create student)");
    check("student appears in registry", await waitForText(page, `\\b${ROLL}\\b`, 20000), ROLL);

    const openFaces = await clickInRow(page, ROLL, "Faces");
    check("faces panel opened", openFaces === null, openFaces ?? "row action");
    await page.waitForSelector('input[type="file"]');
    const faceInput = await page.$('input[type="file"]');
    await faceInput.uploadFile(...FACES);
    check(
      "three photos enrolled",
      await waitForText(page, "3 ready", 90000),
      "badge shows 3 ready",
    );
    check(
      "face metadata listed",
      await waitForText(page, "det 0\\.", 20000),
      "det_score shown per face",
    );

    /* --------------------------------------------------------- recognition */
    console.log("\nrecognition");
    await page.goto(`${APP}/recognition`, { waitUntil: "networkidle2", timeout: 60000 });
    check("page renders", await waitForText(page, "dry run"));
    const recInput = await page.$('input[type="file"]');
    await recInput.uploadFile(CLASSROOM);
    await page.click("button::-p-text(Run recognition)");
    check("results returned", await waitForText(page, "faces found", 120000));
    const recBody = await page.evaluate(() => document.body.innerText);
    check(
      "a student matched",
      /matched/i.test(recBody) && !/no students matched/i.test(recBody),
      `${(recBody.match(/\d\.\d{3}/g) ?? []).slice(0, 3).join(", ") || "no scores"}`,
    );
    check("confidence labelled as similarity", /cosine similarity/i.test(recBody));

    /* ---------------------------------------------------------- attendance */
    console.log("\nattendance");
    await page.goto(`${APP}/attendance`, { waitUntil: "networkidle2", timeout: 60000 });
    check("page renders", await waitForText(page, "mark attendance"));
    const attInput = await page.$('input[type="file"]');
    await attInput.uploadFile(CLASSROOM);
    await page.click("button::-p-text(Process photo)");
    check("photo processed", await waitForText(page, "already present|written", 120000));

    // The register reloads after the run, so wait for the rows rather than
    // sampling the table the instant the results card appears.
    const rowsReady = await page
      .waitForFunction(() => document.querySelectorAll("table tbody tr").length > 0, {
        timeout: 60000,
      })
      .then(() => true)
      .catch(() => false);
    check("register shows rows", rowsReady);
    const rows = await page.$$("table tbody tr");
    check("register has rows", rows.length > 0, `${rows.length} row(s)`);

    // Change the first row's status; React needs a real bubbling change event.
    const changed = await page.$$eval('select[aria-label^="Status for"]', (selects) => {
      const select = selects[0];
      if (!select) return "no status select on the page";
      select.value = "late";
      select.dispatchEvent(new Event("input", { bubbles: true }));
      select.dispatchEvent(new Event("change", { bubbles: true }));
      return null;
    });
    check("status select changed", changed === null, changed ?? "first row");
    check("correction applied", await waitForText(page, "audited", 30000), "success banner");

    const auditClick = await page.$$eval("button", (buttons) => {
      const button = buttons.find((b) => b.innerText.trim() === "Audit");
      if (!button) return "no Audit button";
      button.click();
      return null;
    });
    check("audit button clicked", auditClick === null, auditClick ?? "");
    check("audit trail opened", await waitForText(page, "manual_update", 30000));

    /* ------------------------------------------------- navigation + cleanup */
    console.log("\nnav + cleanup");
    for (const href of ["/students", "/recognition", "/attendance", "/"]) {
      const clicked = await page.$$eval(
        "a[href]",
        (links, want) => {
          const link = links.find((l) => l.getAttribute("href") === want);
          if (!link) return `no link to ${want}`;
          link.click();
          return null;
        },
        href,
      );
      // Nav labels are always in the header, so assert on the path instead.
      const landed =
        clicked === null &&
        (await page
          .waitForFunction(
            (path) => document.location.pathname === path,
            { timeout: 30000 },
            href,
          )
          .then(() => true)
          .catch(() => false));
      check(`nav ${href}`, landed, clicked ?? page.url().replace(APP, ""));
    }

    await page.goto(`${APP}/students`, { waitUntil: "networkidle2", timeout: 60000 });
    await waitForText(page, `\\b${ROLL}\\b`, 20000);
    const deleteClick = await clickInRow(page, ROLL, "Delete");
    const deleted = await page
      .waitForFunction(
        (roll) => !new RegExp(`\\b${roll}\\b`).test(document.body.innerText),
        { timeout: 20000 },
        ROLL,
      )
      .then(() => true)
      .catch(() => false);
    check(
      "student deleted",
      deleteClick === null && deleted,
      deleteClick ?? "dialog confirmed automatically",
    );

    /* -------------------------------------------------------- console health */
    console.log("\nruntime health");
    check("no uncaught page errors", pageErrors.length === 0, pageErrors.join(" | ") || "clean");
    check(
      "no console errors",
      consoleErrors.length === 0,
      consoleErrors.slice(0, 3).join(" | ") || "clean",
    );
  } finally {
    await browser.close();
  }

  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error("\n" + (err?.stack ?? String(err)));
  console.log(`\n${passed} passed, ${failed} failed (aborted)\n`);
  process.exitCode = 1;
});
