# Medical LLM Physician Evaluation

A web platform for collecting **blinded physician evaluations** of the clinical answers
studied in *"The Judge Is Not Impartial: Self-Preference in Medical LLM Evaluation."*

For each assigned question, a physician sees the original Real-POCQi question and the
eight original model answers, shown as Responses A–H with model identity hidden. They:

- score each answer on the study's five-axis rubric (0–5);
- rank all eight answers from best to worst, with no ties and an explicit confirmation;
- may optionally flag clinically significant errors (a separate instrument).

The data are stored so that every physician judgment can be joined, by ID, to the
original LLM judges' rankings and scores.

The source data comes from
[DaneshjouLab/Medical-LLM-Self-Preference](https://github.com/DaneshjouLab/Medical-LLM-Self-Preference),
pinned at commit `a40d3617a2e55cb6fe4255198a4b05ba774c3f4c`. That repository is only read,
never modified.

| Document | Contents |
|---|---|
| [docs/METHODS.md](docs/METHODS.md) | Data audit, sampling, randomization, blinding, limitations, pre-deployment checklist |
| [docs/DATA_DICTIONARY.md](docs/DATA_DICTIONARY.md) | Every exported column |
| [data/sample-manifest.json](data/sample-manifest.json) | The frozen 100-question sample: question IDs, seed, source file hashes |

## Status

| Done and tested locally | Not done |
|---|---|
| Data preparation from the pinned repo: all 620 questions validated, 100 sampled | Deployment to a hosted server |
| 5-question prototype: login, instructions, grading, autosave, resume, submit, lock | Importing or assigning the full 100 questions (prepared, waiting for study-team approval) |
| Admin dashboard: progress, assignment, reviewer accounts, reopen, instrument config, exports | MedSP1000 multi-turn data preparation (the schema and UI are ready for it; see METHODS §7) |
| 33 unit/integration tests and 35 browser end-to-end checks | IRB, data-use and de-identification sign-off (see METHODS §8) |

## Stack

- Next.js 16 (App Router) with TypeScript and Tailwind CSS 4
- Postgres through Drizzle ORM. Local development and tests use **PGlite**, an embedded
  Postgres, so no database server is needed. Staging and production use a normal Postgres
  database through `DATABASE_URL`, with the same schema and migrations.
- Sign-in uses username and password accounts created by an admin. Passwords are hashed
  with bcrypt, and sessions are server-side in HttpOnly cookies. There are two roles,
  `reviewer` and `admin`.
- `@dnd-kit` handles drag-and-drop ranking with keyboard support. `react-markdown` renders
  answers safely: raw HTML is never rendered.

## Local setup

Requirements: Node.js 20.9 or newer, and git. You do not need git-lfs, Docker or Postgres.

### Quick start (try the prototype)

```bash
npm install
npm run demo
```

Then open http://localhost:3123 and sign in as `reviewer1`, `reviewer2` or `admin`, with the
password `physicantest`.

`npm run demo` downloads the research data (about 200 MB, first run only), prepares the
5-question prototype, creates the demo accounts and starts the app. Running it again keeps
the accounts and any saved grading. These demo accounts are for local testing only; never
use them for real reviewers.

### Step by step

```bash
npm install

# 1. Get the original research data at the pinned commit. The large LFS judgment file
#    is downloaded from GitHub's media endpoint and checked against the sha256 in its
#    LFS pointer.
npm run data:fetch

# 2. Build the study bundle deterministically. This validates all 620 questions and
#    writes the 100-question stratified sample:
#      data/prepared/study-bundle.json   gitignored; contains the model mapping
#      data/sample-manifest.json         committed; no answer text or model mapping
npm run data:prepare

# 3. Prototype: import the first 5 sampled questions, create admin + reviewer1 +
#    reviewer2, and assign the same 5 questions to both reviewers. The password is
#    DEMO_PASSWORD if set, otherwise "physicantest".
npm run demo:seed

npm run dev    # http://localhost:3000
```

Sign in as `reviewer1` to grade, or as `admin` for the dashboard. `demo:seed` refuses to run
when `DATABASE_URL` is set, so it can never touch a shared database.

### Tests

```bash
npm test                 # unit + integration tests (in-memory Postgres)
npm run typecheck

# Browser end-to-end checks against a running server with freshly seeded demo data.
# Uses the locally installed Google Chrome through playwright-core.
E2E_BASE_URL=http://localhost:3000 E2E_R1_PASSWORD=... E2E_R2_PASSWORD=... \
  E2E_ADMIN_PASSWORD=... npm run test:e2e -- --screenshots ./shots
```

Coverage of the QA list in the study brief:

| Requirement | Where it is tested |
|---|---|
| All 8 responses load; IDs match the original questions | `tests/prepared-data.test.ts`, `persistence.test.ts`, admin validation, e2e |
| No model identity visible, including in API payloads | `persistence.test.ts › blinding`; e2e checks page text and every HTTP response body |
| Reproducible, counterbalanced randomization | `ordering.test.ts`, `persistence.test.ts` |
| Strict unique ranks; explicit confirmation required | `evaluation-state.test.ts`, `persistence.test.ts`, e2e |
| Rubric saved separately; ranking independent of scores | `evaluation-state.test.ts`, `persistence.test.ts` |
| Autosave, refresh persistence, resume | `persistence.test.ts`, e2e |
| Failed save is visible and can be retried | e2e (simulated network failure) |
| Reviewers isolated; no cross-reviewer overwrite; stale-write detection | `persistence.test.ts`, e2e |
| Submit only when complete; locked after submit (HTTP 423) | `persistence.test.ts`, e2e |
| Exports match the database; identities recoverable for analysis | `persistence.test.ts › exports`, e2e |
| Long responses shown in full | e2e (character counts of rendered responses) |
| Keyboard access | e2e ranks with Move up/down buttons and the keyboard drag handle |

## Configuration

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Postgres connection string. If unset, the app uses PGlite in `./.data/pglite` (local only). |
| `PGLITE_DIR` | Optional location for the local PGlite database. |
| `COOKIE_SECURE` | Set to `true` whenever the app is served over HTTPS. |

Copy `.env.example` to `.env`. Never commit `.env`, `data/prepared/`, `.source/` or `.data/`;
all four are gitignored.

The **instrument configuration** is changed on the admin dashboard, not through environment
variables:
- **Rubric:** required (all 40 scores), optional, or hidden.
- **Error assessment:** shown or hidden.

The configuration in force is stored with each assignment, so pilot arms (for example
rubric vs. ranking-only) can be compared.

## Deployment

The app is a standard Node.js server and needs a Postgres database (version 14 or newer).
It has been tested only locally. **No deployment has been done.**

1. Provision Postgres at a host your institution has approved for this data, and set
   `DATABASE_URL`.
2. On the server, set `COOKIE_SECURE=true` and serve the app over HTTPS only.
3. Apply migrations:

   ```bash
   DATABASE_URL=... npm run db:migrate
   ```

   The server also applies pending migrations on startup.
4. From a trusted machine, prepare and import the data into the production database:

   ```bash
   npm run data:fetch && npm run data:prepare
   DATABASE_URL=... npm run db:import -- --limit 5     # prototype
   DATABASE_URL=... npm run db:import                  # all 100, after approval
   ```

   The importer is insert-only. It verifies that items already present are byte-identical,
   and it refuses to change any original response.
5. Create the first admin:

   ```bash
   DATABASE_URL=... PE_PASSWORD='<strong password>' \
     npm run user:create -- --username <name> --role admin
   ```

   Then create reviewers and assign questions from the dashboard.
6. Build and start the app:

   ```bash
   npm run build && npm start
   ```

   Any Node host works: an institutional VM, Render, Fly.io or Railway. The deployment bundle
   excludes `.source/`, `data/` and `.data/`.

Physicians need only a browser and the credentials you give them.

## Project layout

```
scripts/            fetch-source, prepare-data, import-bundle, create-user, seed-demo, migrate, e2e-prototype
src/lib/            shared logic: rubric, evaluation state + validation, ordering, sampling/prep
src/db/             Drizzle schema + connection (PGlite or Postgres)
drizzle/            SQL migrations
src/server/         auth, evaluations (physician-facing), admin, exports, importer
src/app/            pages + API routes
src/components/     Workspace, ResponseCard, RankingPanel, QuestionNav, AdminPanel, …
tests/              Vitest suites
```

The physician-facing code path, `src/server/evaluations.ts`, never reads the
`response_provenance` or `llm_judgments` tables. Its payloads identify responses only by
display label (A–H), never by internal ID.
