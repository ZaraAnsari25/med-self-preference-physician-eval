import { openFromEnv } from "../src/db";

const handle = openFromEnv();
await handle.migrate();
await handle.close();
console.log("Database migrated");
