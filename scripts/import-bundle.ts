// Import prepared study items into the database (insert-only).
//   npm run db:import                 # all items in data/prepared/study-bundle.json
//   npm run db:import -- --limit 5    # first 5 items of the frozen sample (prototype)
import { readFileSync } from "node:fs";
import { openFromEnv } from "../src/db";
import { validateStudyData } from "../src/server/admin";
import { importBundle, type StudyBundle } from "../src/server/importer";

const i = process.argv.indexOf("--limit");
const limit = i >= 0 ? Number(process.argv[i + 1]) : undefined;
const file = process.argv.includes("--file") ? process.argv[process.argv.indexOf("--file") + 1] : "data/prepared/study-bundle.json";

const handle = openFromEnv();
await handle.migrate();
const bundle = JSON.parse(readFileSync(file, "utf8")) as StudyBundle;
const result = await importBundle(handle.db, bundle, { limit });
console.log(`Imported ${result.inserted} new items (${result.unchanged} already present, verified identical)`);
const report = await validateStudyData(handle.db);
console.log(`Validation: ${report.ok ? "OK" : "PROBLEMS"} — ${report.items} items, ${report.responses} responses, ${report.judgmentRows} LLM judgment rows`);
for (const p of report.problems) console.log(`  - ${p}`);
await handle.close();
if (!report.ok) process.exit(1);
