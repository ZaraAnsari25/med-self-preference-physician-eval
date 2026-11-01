// Browser end-to-end check of the running app, using the local Chrome install.
//
//   E2E_BASE_URL=http://localhost:3000 \
//   E2E_R1_PASSWORD=... E2E_R2_PASSWORD=... E2E_ADMIN_PASSWORD=... \
//   npx tsx scripts/e2e-prototype.ts [--screenshots <dir>]
//
// Expects a freshly seeded database (`npm run demo:seed`): reviewer1/reviewer2 for
// Real-POCQi, sp-reviewer1 for MedSP1000, and admin, with nothing graded yet.
import { mkdirSync } from "node:fs";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright-core";

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const shotsArg = process.argv.indexOf("--screenshots");
const SHOTS = shotsArg >= 0 ? process.argv[shotsArg + 1] : null;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

const MODEL_PATTERN = /gpt-5|claude-(opus|sonnet)|gemini-3|qwen\/|openai|anthropic|rsp_[0-9a-f]|gen-[0-9a-f]{8}|judgment-/i;

let failures = 0;
function check(cond: unknown, label: string) {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}`);
  if (!cond) failures++;
}

async function shot(page: Page, name: string, fullPage = false) {
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage });
}

async function login(browser: Browser, username: string, password: string) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const payloads: string[] = [];
  page.on("response", async (r) => {
    if (r.url().startsWith(BASE)) payloads.push(await r.text().catch(() => ""));
  });
  await page.goto(`${BASE}/login`);
  await page.fill('input[name="username"]', username);
  await page.fill('input[name="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
  return { page, payloads };
}

async function waitSaved(page: Page) {
  await page.getByText("All changes saved").waitFor({ timeout: 15000 });
}

async function main() {
  const browser = await chromium.launch({ channel: "chrome", headless: true });

  // --- Reviewer 1 ---------------------------------------------------------
  const { page, payloads } = await login(browser, "reviewer1", process.env.E2E_R1_PASSWORD!);
  check(page.url().endsWith("/instructions"), "first login lands on instructions");
  await shot(page, "01-instructions", true);
  await page.getByRole("button", { name: /Begin evaluation|Continue grading/ }).click();
  await page.waitForURL(/\/study\/real_pocqi\/q\/1$/);
  await page.getByText("Response H", { exact: true }).first().waitFor();
  await shot(page, "02-question-top");

  const cards = page.locator("section[id^='response-']");
  check((await cards.count()) === 8, "eight response cards render");
  const bodyText = await page.locator("body").innerText();
  check(!MODEL_PATTERN.test(bodyText), "no model identity or internal IDs in visible page text");
  check(!payloads.some((p) => MODEL_PATTERN.test(p)), "no model identity or internal IDs in any HTTP payload");

  // Longest card fully rendered (no truncation): compare text length with a generous lower bound.
  const lengths = await cards.evaluateAll((els) => els.map((e) => (e.querySelector(".md") as HTMLElement)?.innerText.length ?? 0));
  check(lengths.every((n) => n > 50), `all responses rendered in full (chars: ${lengths.join(", ")})`);

  // Score every response on every axis.
  for (const label of "ABCDEFGH") {
    const card = page.locator(`#response-${label}`);
    for (const [i, crit] of ["Accuracy", "Clinical utility", "Source quality", "Verifiability", "Completeness"].entries()) {
      await card.getByRole("radio", { name: `${crit}: ${(i + label.charCodeAt(0)) % 6}` }).click();
    }
  }
  await waitSaved(page);
  check(
    (await page.locator("li", { hasText: "Responses have not been ranked yet." }).count()) > 0,
    "question incomplete until ranked",
  );

  // Rank: move Response D to the top with the accessible arrow buttons, then E down one.
  for (let i = 0; i < 3; i++) await page.getByRole("button", { name: "Move Response D up" }).click();
  await page.getByRole("button", { name: "Move Response E down" }).click();
  // Keyboard drag: focus the handle for H, lift with space, move up twice, drop.
  await page.getByRole("button", { name: /Drag Response H/ }).focus();
  for (const key of ["Space", "ArrowUp", "ArrowUp", "Space"]) {
    await page.keyboard.press(key);
    await page.waitForTimeout(250); // let dnd-kit's keyboard sensor settle between steps
  }
  await page.getByRole("button", { name: "Confirm ranking" }).click();
  await waitSaved(page);
  const ranking = await page.locator("ol[aria-label='Ranking, best first'] li").evaluateAll((els) =>
    els.map((e) => /Response ([A-H])/.exec(e.textContent ?? "")?.[1]),
  );
  check(ranking.length === 8 && new Set(ranking).size === 8, `ranking is a strict permutation (${ranking.join(" > ")})`);
  check(ranking[0] === "D", "arrow-button reorder applied (D ranked first)");
  check(ranking.indexOf("H") === 5, "keyboard drag applied (H moved from 8th to 6th)");
  check(await page.getByText("This question is complete.").isVisible(), "question marked complete");
  await shot(page, "03-ranked-and-scored");
  await page.locator("#response-B").scrollIntoViewIfNeeded();
  await page.locator("#response-B").getByRole("radio", { name: "Yes" }).click();
  await page.locator("#response-B").getByRole("button", { name: "Incorrect medication or dosage" }).click();
  await page.locator("#response-B textarea").fill("Example note entered by the automated test.");
  await waitSaved(page);
  await shot(page, "04-error-flag");

  // Persistence across a full reload.
  await page.reload();
  await page.getByText("Response H", { exact: true }).first().waitFor();
  const rankingAfter = await page.locator("ol[aria-label='Ranking, best first'] li").evaluateAll((els) =>
    els.map((e) => /Response ([A-H])/.exec(e.textContent ?? "")?.[1]),
  );
  check(JSON.stringify(rankingAfter) === JSON.stringify(ranking), "ranking persists after refresh");
  check(await page.getByText("Ranking confirmed. Moving any entry").isVisible(), "confirmation persists after refresh");
  check(
    (await page.locator("#response-A").getByRole("radio", { name: "Accuracy: 5" }).getAttribute("aria-checked")) === "true",
    "rubric score persists after refresh",
  );
  check((await page.locator("#response-B textarea").inputValue()).startsWith("Example note"), "error note persists after refresh");
  check(
    (await page.getByRole("button", { name: "Question 1, completed" }).count()) === 1,
    "question navigation shows question 1 completed",
  );

  // Navigate to question 2 via Save & next; resume logic sends us back to 2 on /study/real_pocqi.
  await page.getByRole("button", { name: /Save & next question/ }).click();
  await page.waitForURL(/\/study\/real_pocqi\/q\/2$/);
  await page.locator("#response-C").getByRole("radio", { name: "Accuracy: 3" }).click();
  await waitSaved(page);
  // Simulated network failure: the save error is visible and Retry recovers without losing input.
  await page.route("**/api/studies/real_pocqi/evaluations/2", (route) => route.abort("failed"));
  await page.locator("#response-C").getByRole("radio", { name: "Clinical utility: 2" }).click();
  await page.getByText("Save error").waitFor({ timeout: 15000 });
  check(await page.getByRole("alert").filter({ hasText: "Not saved" }).isVisible(), "failed save shows a visible error banner");
  await page.unroute("**/api/studies/real_pocqi/evaluations/2");
  await page.getByRole("button", { name: "Retry save" }).click();
  await waitSaved(page);
  await page.reload();
  await page.locator("#response-C").waitFor();
  check(
    (await page.locator("#response-C").getByRole("radio", { name: "Clinical utility: 2" }).getAttribute("aria-checked")) === "true",
    "retry after failure persists the change",
  );

  await page.goto(`${BASE}/study/real_pocqi`);
  await page.waitForURL(/\/study\/real_pocqi\/q\/2$/);
  check(true, "resume goes to first incomplete question (2)");
  check((await page.getByRole("button", { name: "Question 2, in progress" }).count()) === 1, "question 2 shows in progress");
  await shot(page, "05-question-nav-states");

  // Submit is blocked while incomplete.
  await page.goto(`${BASE}/study/real_pocqi/submit`);
  check(await page.getByRole("button", { name: "Submit evaluations" }).isDisabled(), "submit disabled while questions incomplete");
  await shot(page, "06-submit-page", true);

  // --- Reviewer 2: independent view --------------------------------------
  const r2 = await login(browser, "reviewer2", process.env.E2E_R2_PASSWORD!);
  await r2.page.getByRole("button", { name: /Begin evaluation|Continue grading/ }).click();
  await r2.page.waitForURL(/\/study\/real_pocqi\/q\/1$/);
  await r2.page.getByText("Response H", { exact: true }).first().waitFor();
  check(await r2.page.getByText("Not ranked yet.").isVisible(), "reviewer 2 does not see reviewer 1's ranking");
  check(
    (await r2.page.locator("#response-A").getByRole("radio", { name: "Accuracy: 5" }).getAttribute("aria-checked")) === "false",
    "reviewer 2 does not see reviewer 1's scores",
  );
  const r1First = await page.context().newPage().then(async (p) => {
    await p.goto(`${BASE}/study/real_pocqi/q/1`);
    await p.locator("#response-A .md").waitFor();
    return p.locator("#response-A .md").innerText();
  });
  const r2First = await r2.page.locator("#response-A .md").innerText();
  check(r1First !== r2First, "reviewer 2 sees a different presentation order");
  const forbidden = await r2.page.request.get(`${BASE}/api/admin/export?dataset=analysis&format=json`);
  check(forbidden.status() === 403, "reviewers cannot access admin exports");
  const adminPage = await r2.page.request.get(`${BASE}/admin`, { maxRedirects: 0 });
  check(adminPage.status() >= 300 && adminPage.status() < 400, "reviewers are redirected away from /admin");

  // Reviewer 2 completes all five questions (scores + confirmed ranking) and submits.
  for (let q = 1; q <= 5; q++) {
    await r2.page.goto(`${BASE}/study/real_pocqi/q/${q}`);
    await r2.page.getByText("Response H", { exact: true }).first().waitFor();
    for (const label of "ABCDEFGH") {
      const card = r2.page.locator(`#response-${label}`);
      for (const crit of ["Accuracy", "Clinical utility", "Source quality", "Verifiability", "Completeness"]) {
        await card.getByRole("radio", { name: `${crit}: 3` }).click();
      }
    }
    await r2.page.getByRole("button", { name: "Move Response B up" }).click();
    await r2.page.getByRole("button", { name: "Confirm ranking" }).click();
    await r2.page.getByText("This question is complete.").waitFor();
    await waitSaved(r2.page);
  }
  await r2.page.goto(`${BASE}/study/real_pocqi/submit`);
  r2.page.once("dialog", (d) => d.accept());
  await r2.page.getByRole("button", { name: "Submit evaluations" }).click();
  await r2.page.waitForURL(/\/study\/real_pocqi\/done$/);
  check(await r2.page.getByText("Thank you").isVisible(), "submission shows the thank-you page");
  await shot(r2.page, "08-done");
  await r2.page.goto(`${BASE}/study/real_pocqi/q/1`);
  check(await r2.page.getByText("submitted and are read-only").isVisible(), "submitted evaluations are shown read-only");
  check(await r2.page.getByRole("radio", { name: "Accuracy: 3" }).first().isDisabled(), "controls are disabled after submission");
  const lockedSave = await r2.page.request.put(`${BASE}/api/studies/real_pocqi/evaluations/1`, {
    data: { state: { ranking: null, rankingConfirmed: false, rankingModified: false, responses: {} }, baseRevision: 99 },
    headers: { Origin: BASE },
  });
  check(lockedSave.status() === 423, `server rejects writes after submission (HTTP ${lockedSave.status()})`);

  // --- MedSP1000 (separate login) -----------------------------------------
  const sp = await login(browser, "sp-reviewer1", process.env.E2E_SP_PASSWORD ?? process.env.E2E_R1_PASSWORD!);
  check(sp.page.url().endsWith("/study/medsp1000/instructions"), "MedSP1000 reviewer lands on MedSP1000 instructions");
  check(await sp.page.getByText("Evaluate only the clinician", { exact: false }).first().isVisible(), "MedSP1000 instructions say to evaluate only the clinician");
  await shot(sp.page, "09-medsp-instructions", true);
  await sp.page.getByRole("button", { name: /Begin evaluation/ }).click();
  await sp.page.waitForURL(/\/study\/medsp1000\/q\/1$/);
  await sp.page.getByText("Conversation H", { exact: true }).first().waitFor();
  check(await sp.page.getByText("Case information", { exact: true }).isVisible(), "case information panel shown");
  const convs = sp.page.locator("section[id^='response-']");
  check((await convs.count()) === 8, "eight conversation cards render");
  const turnCounts = await convs.evaluateAll((els) => els.map((e) => e.querySelectorAll("ol[aria-label='Conversation turns'] > li").length));
  check(turnCounts.every((n) => n === 8), `each conversation shows 8 turns (${turnCounts.join(", ")})`);
  check((await sp.page.getByText("Turn 2 · Patient (context)").count()) === 8, "patient turns labelled as context");
  check(
    await sp.page.locator("#response-A").getByText("How factually and clinically accurate are the clinician's statements across the encounter?").isVisible(),
    "multi-turn rubric wording shown",
  );
  check(!MODEL_PATTERN.test(await sp.page.locator("body").innerText()), "no model identity in MedSP1000 page text");
  check(!sp.payloads.some((p) => MODEL_PATTERN.test(p)), "no model identity in any MedSP1000 HTTP payload");
  await shot(sp.page, "10-medsp-scenario-top");
  for (const label of "ABCDEFGH") {
    const card = sp.page.locator(`#response-${label}`);
    for (const crit of ["Accuracy", "Clinical utility", "Source quality", "Verifiability", "Completeness"]) {
      await card.getByRole("radio", { name: `${crit}: 4` }).click();
    }
  }
  await sp.page.getByRole("button", { name: "Move Conversation C up" }).click();
  await sp.page.getByRole("button", { name: "Confirm ranking" }).click();
  await sp.page.getByText("This scenario is complete.").waitFor();
  await waitSaved(sp.page);
  await sp.page.locator("#response-B").scrollIntoViewIfNeeded();
  await shot(sp.page, "11-medsp-scored");
  await sp.page.reload();
  await sp.page.getByText("Conversation H", { exact: true }).first().waitFor();
  check(await sp.page.getByText("Ranking confirmed. Moving any entry").isVisible(), "MedSP1000 ranking persists after refresh");
  check((await sp.page.getByRole("button", { name: "Scenario 1, completed" }).count()) === 1, "scenario navigation shows scenario 1 completed");
  const crossStudy = await sp.page.goto(`${BASE}/study/real_pocqi/q/1`);
  check(crossStudy?.status() === 404, `MedSP1000 reviewer cannot open Real-POCQi questions (HTTP ${crossStudy?.status()})`);

  // --- Admin ----------------------------------------------------------------
  const admin = await login(browser, "admin", process.env.E2E_ADMIN_PASSWORD!);
  check(admin.page.url().endsWith("/admin"), "admin lands on dashboard");
  check(await admin.page.getByText("All checks passed").isVisible(), "admin dashboard reports data mapping OK");
  await shot(admin.page, "07-admin", true);
  const exp = await admin.page.request.get(`${BASE}/api/admin/export?dataset=analysis&format=json`);
  const data = await exp.json();
  const r1Rows = data.rows.filter((r: Record<string, unknown>) => r.reviewer_code === "R001" && r.physician_rank !== null);
  check(r1Rows.length === 64, `analysis export: 8 responses × 8 judges for reviewer 1's ranked question (${r1Rows.length})`);
  const selfRows = r1Rows.filter((r: Record<string, unknown>) => r.llm_self_judge);
  check(selfRows.length === 8, "analysis export identifies one self-judgment per response");
  const top = r1Rows.find((r: Record<string, unknown>) => r.physician_rank === 1 && r.display_label === "D");
  check(Boolean(top), "physician rank 1 is attached to the response shown as D");
  const spRows = data.rows.filter((r: Record<string, unknown>) => r.study === "medsp1000" && r.physician_rank !== null);
  check(spRows.length === 64 && spRows.every((r: Record<string, unknown>) => r.turn_count === 8), `analysis export joins MedSP1000 to 8-turn judgments (${spRows.length})`);
  check(spRows.every((r: Record<string, unknown>) => r.llm_experiment_id === "medsp1000_all_eight_judges_v2"), "MedSP1000 rows use the 8-model judgments");
  const csv = await (await admin.page.request.get(`${BASE}/api/admin/export?dataset=rankings&format=csv`)).text();
  check(csv.startsWith("study,reviewer_code,assignment_id,question_id"), "CSV export has header");

  // --- Study plan (admin) ------------------------------------------------------
  const created: { username: string; password: string }[] = [];
  for (let i = 1; i <= 8; i++) {
    const res = await admin.page.request.post(`${BASE}/api/admin/reviewers`, {
      data: { action: "create", username: `e2e-doc${i}`, role: "reviewer", specialty: "Internal Medicine", yearsInPractice: 5 + i },
      headers: { Origin: BASE },
    });
    created.push(await res.json());
  }
  await admin.page.reload();
  const card = admin.page.locator("div.rounded-xl", { has: admin.page.getByRole("heading", { name: "Real-POCQi", exact: true }) });
  for (const c of created) await card.getByRole("checkbox", { name: new RegExp(c.username) }).check();
  await card.getByRole("button", { name: "Preview plan" }).click();
  await card.getByText("✓ Every block case has exactly 3 graders").waitFor();
  check(await card.getByText("✓ Each physician has 40 different cases").isVisible(), "plan preview: each physician has 40 cases");
  check(await card.getByText("✓ Every calibration case is graded by all 8 physicians").isVisible(), "plan preview: calibration graded by all 8");
  await shot(admin.page, "12-plan-preview", true);
  admin.page.once("dialog", (d) => d.accept());
  await card.getByRole("button", { name: "Apply plan" }).click();
  await admin.page.getByText("Plan applied: 320 assignments created.").waitFor();
  await admin.page.reload();
  check(await card.getByText("Plan applied", { exact: true }).isVisible(), "plan applied and shown on the dashboard");
  check(await admin.page.getByText("All checks passed").isVisible(), "data check still passes with the plan");
  await shot(admin.page, "13-plan-applied", true);
  const planCsv = await (await admin.page.request.get(`${BASE}/api/admin/export?dataset=plan&format=json`)).json();
  check(planCsv.row_count === 100, `plan export lists all 100 cases (${planCsv.row_count})`);

  const doc = await login(browser, created[0].username, created[0].password);
  check(doc.page.url().endsWith("/study/real_pocqi/instructions"), "plan physician lands on Real-POCQi instructions");
  check(await doc.page.getByText("You have 40 questions assigned").isVisible(), "plan physician has 40 questions");
  await doc.page.getByRole("button", { name: /Begin evaluation/ }).click();
  await doc.page.waitForURL(/\/study\/real_pocqi\/q\/1$/);
  check((await doc.page.getByRole("button", { name: /^Question 40, / }).count()) === 1, "question navigation runs to 40");
  check(!(await doc.page.locator("body").innerText()).toLowerCase().includes("calibration"), "calibration cases are not labelled for physicians");

  await browser.close();
  console.log(failures ? `\n${failures} check(s) failed` : "\nAll end-to-end checks passed");
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
