// Local prototype setup: import the first 5 sampled questions, create one admin
// and two reviewers, and assign the same 5 questions to both reviewers.
// For local development only. Prints generated passwords once.
import { readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { openFromEnv } from "../src/db";
import { users } from "../src/db/schema";
import { assignItems, validateStudyData } from "../src/server/admin";
import { createUser, generatePassword } from "../src/server/auth";
import { importBundle, type StudyBundle } from "../src/server/importer";

if (process.env.DATABASE_URL) {
  console.error("Refusing to seed demo accounts into DATABASE_URL; demo:seed is for local PGlite only.");
  process.exit(1);
}
const handle = openFromEnv();
await handle.migrate();
const db = handle.db;
const bundle = JSON.parse(readFileSync("data/prepared/study-bundle.json", "utf8")) as StudyBundle;
const imported = await importBundle(db, bundle, { limit: 5 });
console.log(`Items: ${imported.inserted} imported, ${imported.unchanged} already present`);

const accounts = [
  { username: "admin", role: "admin" as const },
  { username: "reviewer1", role: "reviewer" as const },
  { username: "reviewer2", role: "reviewer" as const },
];
for (const acct of accounts) {
  const [existing] = await db.select().from(users).where(eq(users.username, acct.username));
  if (existing) {
    console.log(`${acct.username}: already exists (${existing.reviewerCode})`);
    continue;
  }
  const password = generatePassword();
  const u = await createUser(db, { ...acct, password });
  console.log(`${acct.username} (${acct.role}, ${u.reviewerCode}) password: ${password}`);
  if (acct.role === "reviewer") await assignItems(db, u.userId, { start: 0, count: 5 });
}
const report = await validateStudyData(db);
console.log(`Validation: ${report.ok ? "OK" : report.problems.join("; ")}`);
await handle.close();
