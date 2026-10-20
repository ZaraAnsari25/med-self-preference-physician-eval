// Create a reviewer or administrator account.
//   npm run user:create -- --username jdoe --role reviewer [--name "Dr. Doe"]
// The password is read from the PE_PASSWORD environment variable, or generated
// and printed once if unset.
import { openFromEnv } from "../src/db";
import { createUser, generatePassword, type Role } from "../src/server/auth";

function arg(name: string) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const username = arg("username");
const role = (arg("role") ?? "reviewer") as Role;
if (!username || !["reviewer", "admin"].includes(role)) {
  console.error("usage: npm run user:create -- --username <name> --role reviewer|admin [--name <display name>]");
  process.exit(1);
}
const password = process.env.PE_PASSWORD || generatePassword();
const handle = openFromEnv();
await handle.migrate();
const u = await createUser(handle.db, { username, password, role, displayName: arg("name") ?? null });
console.log(`Created ${role} ${u.username} (reviewer code ${u.reviewerCode})`);
if (!process.env.PE_PASSWORD) console.log(`Temporary password: ${password}`);
await handle.close();
