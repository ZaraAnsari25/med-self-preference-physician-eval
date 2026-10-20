"use client";

import { useState } from "react";
import type { InstrumentConfig } from "@/lib/rubric";
import type { ReviewerProgress, ValidationReport } from "@/server/admin";
import { Button, Card, cx, Pill, SectionLabel } from "./ui";

type Reviewer = Omit<ReviewerProgress, "submittedAt" | "lastSavedAt"> & { submittedAt: string | null; lastSavedAt: string | null };

const DATASETS = [
  ["rankings", "Physician rankings", "One row per reviewer × question × response with final rank and confirmation."],
  ["rubric_scores", "Physician rubric scores", "Five 0–5 scores per response with mean and sum."],
  ["error_annotations", "Clinical error annotations", "Separate instrument: error flag, categories, note."],
  ["assignments", "Assignments & completion", "Queue, stored presentation order, status, timestamps, active time."],
  ["llm_judgments", "Original LLM judgments", "Every judge's rank and scores for imported questions."],
  ["response_key", "Response key (unblinding)", "response_id → generator model and original generation_id."],
  ["analysis", "Analysis-ready join", "Physician judgments × every LLM judge for the same response, joined by ID."],
] as const;

async function post(url: string, body: unknown) {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `Request failed (HTTP ${res.status})`);
  return data;
}

export function AdminPanel({
  reviewers,
  itemCount,
  validation,
  config,
  studySeed,
}: {
  reviewers: Reviewer[];
  itemCount: number;
  validation: ValidationReport;
  config: InstrumentConfig;
  studySeed: string | null;
}) {
  const [message, setMessage] = useState<{ tone: "done" | "danger"; text: string } | null>(null);
  const run = async (fn: () => Promise<string | void>) => {
    try {
      const text = await fn();
      if (text) setMessage({ tone: "done", text });
      else window.location.reload();
    } catch (e) {
      setMessage({ tone: "danger", text: e instanceof Error ? e.message : "Request failed" });
    }
  };

  const physicians = reviewers.filter((r) => r.role === "reviewer");
  const totals = physicians.reduce((a, r) => ({ assigned: a.assigned + r.assigned, complete: a.complete + r.complete }), { assigned: 0, complete: 0 });

  return (
    <main className="mx-auto max-w-[1300px] space-y-6 px-6 py-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Study administration</h1>
          <p className="text-sm text-muted">Physicians cannot access this page. Evaluation content is not shown here.</p>
        </div>
      </div>

      {message && (
        <div
          role="status"
          className={cx(
            "flex items-start justify-between gap-3 rounded-xl border px-4 py-3 text-sm",
            message.tone === "done" ? "border-done-line bg-done-soft text-done" : "border-[#f5c2bd] bg-danger-soft text-danger",
          )}
        >
          <span className="whitespace-pre-wrap">{message.text}</span>
          <button type="button" className="underline" onClick={() => setMessage(null)}>
            Dismiss
          </button>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Questions imported" value={itemCount} />
        <Stat label="Physician reviewers" value={physicians.length} />
        <Stat label="Assignments completed" value={`${totals.complete} / ${totals.assigned}`} />
        <Card className="p-4">
          <div className="text-sm text-muted">Data mapping check</div>
          <div className="mt-1 flex items-center gap-2">
            {validation.ok ? <Pill tone="done">All checks passed</Pill> : <Pill tone="danger">{validation.problems.length} problems</Pill>}
          </div>
          <div className="mt-1 text-xs text-muted">
            {validation.responses} responses · {validation.judgmentRows} LLM judgment rows
          </div>
        </Card>
      </div>

      {!validation.ok && (
        <Card className="p-4">
          <SectionLabel className="mb-2">Validation problems</SectionLabel>
          <ul className="list-disc space-y-1 pl-5 font-mono text-xs text-danger">
            {validation.problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </Card>
      )}

      <Card>
        <div className="border-b border-line px-5 py-3">
          <h2 className="font-semibold">Reviewers</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-subtle text-left text-xs uppercase tracking-wider text-muted">
              <tr>
                {["Code", "Username", "Role", "Progress", "Status", "Last saved", ""].map((h) => (
                  <th key={h} className="px-4 py-2 font-semibold">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {reviewers.map((r) => (
                <tr key={r.userId} className={cx("border-t border-line", !r.active && "opacity-50")}>
                  <td className="px-4 py-2.5 font-mono font-semibold">{r.reviewerCode}</td>
                  <td className="px-4 py-2.5">
                    {r.username}
                    {r.displayName && <span className="block text-xs text-muted">{r.displayName}</span>}
                  </td>
                  <td className="px-4 py-2.5">{r.role}</td>
                  <td className="px-4 py-2.5">
                    {r.role === "reviewer" ? (
                      <div className="flex items-center gap-2">
                        <div className="h-2 w-28 overflow-hidden rounded-full bg-line">
                          <div className="h-full bg-done" style={{ width: r.assigned ? `${(r.complete / r.assigned) * 100}%` : 0 }} />
                        </div>
                        <span className="tabular-nums text-ink-2">
                          {r.complete}/{r.assigned}
                        </span>
                        {r.inProgress > 0 && <span className="text-xs text-progress">{r.inProgress} in progress</span>}
                      </div>
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    {r.role === "admin" ? (
                      <span className="text-muted">—</span>
                    ) : r.submittedAt ? (
                      <Pill tone="done">Submitted</Pill>
                    ) : !r.active ? (
                      <Pill>Inactive</Pill>
                    ) : r.complete === r.assigned && r.assigned > 0 ? (
                      <Pill tone="progress">Ready to submit</Pill>
                    ) : (
                      <Pill>Grading</Pill>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-xs text-muted">{r.lastSavedAt ? new Date(r.lastSavedAt).toLocaleString() : "—"}</td>
                  <td className="space-x-1 whitespace-nowrap px-4 py-2.5 text-right">
                    {r.submittedAt && (
                      <Button size="sm" onClick={() => run(async () => void (await post("/api/admin/reopen", { userId: r.userId })))}>
                        Reopen
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        run(async () => {
                          if (!window.confirm(`Reset the password for ${r.username}?`)) return "Cancelled";
                          const d = await post("/api/admin/reviewers", { action: "reset_password", userId: r.userId });
                          return `New temporary password for ${r.username}: ${d.password}\nShare it securely; it will not be shown again.`;
                        })
                      }
                    >
                      Reset password
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => run(async () => void (await post("/api/admin/reviewers", { action: "set_active", userId: r.userId, active: !r.active })))}
                    >
                      {r.active ? "Deactivate" : "Activate"}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <AssignForm reviewers={physicians} itemCount={itemCount} run={run} />
        <CreateReviewerForm run={run} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <ConfigForm config={config} run={run} />
        <Card className="p-5">
          <h2 className="mb-1 font-semibold">Importing questions</h2>
          <p className="text-sm text-ink-2">
            Questions are imported from the prepared study bundle with <code className="font-mono text-xs">npm run db:import</code>. The
            importer is insert-only and refuses to change any original response. Study seed:{" "}
            <code className="font-mono text-xs">{studySeed ?? "not set"}</code>.
          </p>
        </Card>
      </div>

      <Card>
        <div className="border-b border-line px-5 py-3">
          <h2 className="font-semibold">Exports</h2>
          <p className="text-xs text-muted">
            Reviewers appear only as pseudonymous codes; admin test evaluations are excluded. Column definitions are in docs/DATA_DICTIONARY.md.
          </p>
        </div>
        <ul>
          {DATASETS.map(([key, title, desc]) => (
            <li key={key} className="flex flex-wrap items-center gap-3 border-t border-line px-5 py-3 first:border-t-0">
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium">{title}</div>
                <div className="text-xs text-muted">{desc}</div>
              </div>
              <a className="rounded-md border border-line px-3 py-1 text-sm hover:bg-subtle" href={`/api/admin/export?dataset=${key}&format=csv`}>
                CSV
              </a>
              <a className="rounded-md border border-line px-3 py-1 text-sm hover:bg-subtle" href={`/api/admin/export?dataset=${key}&format=json`}>
                JSON
              </a>
            </li>
          ))}
        </ul>
      </Card>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <Card className="p-4">
      <div className="text-sm text-muted">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
    </Card>
  );
}

type Run = (fn: () => Promise<string | void>) => Promise<void>;
const inputCls = "mt-1 block h-9 w-full rounded-lg border border-line bg-surface px-3 text-sm";

function AssignForm({ reviewers, itemCount, run }: { reviewers: Reviewer[]; itemCount: number; run: Run }) {
  const [selected, setSelected] = useState<string[]>([]);
  const [start, setStart] = useState(1);
  const [count, setCount] = useState(Math.min(5, itemCount) || 5);
  return (
    <Card className="p-5">
      <h2 className="mb-1 font-semibold">Assign questions</h2>
      <p className="mb-4 text-sm text-muted">
        Questions follow the frozen sample order (1 to {itemCount}). Selected reviewers each get the same range, in their own counterbalanced
        presentation order. Questions a reviewer already has are skipped.
      </p>
      <fieldset className="mb-4">
        <legend className="mb-1.5 text-sm font-medium">Reviewers</legend>
        <div className="flex flex-wrap gap-2">
          {reviewers.map((r) => (
            <label key={r.userId} className="flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-sm">
              <input
                type="checkbox"
                checked={selected.includes(r.userId)}
                onChange={(e) => setSelected((s) => (e.target.checked ? [...s, r.userId] : s.filter((x) => x !== r.userId)))}
              />
              <span className="font-mono">{r.reviewerCode}</span>
              <span className="text-muted">{r.username}</span>
            </label>
          ))}
          {reviewers.length === 0 && <span className="text-sm text-muted">No reviewers yet.</span>}
        </div>
      </fieldset>
      <div className="mb-4 grid grid-cols-2 gap-3">
        <label className="text-sm font-medium">
          From sample question #
          <input type="number" min={1} max={itemCount} value={start} onChange={(e) => setStart(Number(e.target.value))} className={inputCls} />
        </label>
        <label className="text-sm font-medium">
          Number of questions
          <input type="number" min={1} max={itemCount} value={count} onChange={(e) => setCount(Number(e.target.value))} className={inputCls} />
        </label>
      </div>
      <Button
        variant="primary"
        disabled={!selected.length || itemCount === 0}
        onClick={() =>
          run(async () => {
            const d = await post("/api/admin/assign", { reviewerIds: selected, start: start - 1, count });
            const n = Object.values(d.results as Record<string, number>);
            setTimeout(() => window.location.reload(), 1200);
            return `Assigned ${n.join(", ")} new question(s) to ${n.length} reviewer(s).`;
          })
        }
      >
        Assign
      </Button>
    </Card>
  );
}

function CreateReviewerForm({ run }: { run: Run }) {
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  return (
    <Card className="p-5">
      <h2 className="mb-1 font-semibold">Add reviewer</h2>
      <p className="mb-4 text-sm text-muted">
        A pseudonymous reviewer code is generated automatically and used in all exports. The temporary password is shown once.
      </p>
      <div className="mb-4 grid grid-cols-2 gap-3">
        <label className="text-sm font-medium">
          Username
          <input value={username} onChange={(e) => setUsername(e.target.value)} className={inputCls} autoComplete="off" />
        </label>
        <label className="text-sm font-medium">
          Display name (optional)
          <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} className={inputCls} autoComplete="off" />
        </label>
      </div>
      <Button
        variant="primary"
        disabled={username.trim().length < 3}
        onClick={() =>
          run(async () => {
            const d = await post("/api/admin/reviewers", { action: "create", username, displayName: displayName || undefined, role: "reviewer" });
            setUsername("");
            setDisplayName("");
            return `Created ${d.username} (${d.reviewerCode}). Temporary password: ${d.password}\nShare it securely; it will not be shown again. Reload to see the reviewer in the table.`;
          })
        }
      >
        Create reviewer
      </Button>
    </Card>
  );
}

function ConfigForm({ config, run }: { config: InstrumentConfig; run: Run }) {
  const [c, setC] = useState(config);
  return (
    <Card className="p-5">
      <h2 className="mb-1 font-semibold">Instrument configuration</h2>
      <p className="mb-4 text-sm text-muted">
        Applies to all reviewers from their next save. The configuration in force is recorded with every assignment, so pilot arms can be compared.
      </p>
      <div className="mb-4 grid grid-cols-2 gap-3">
        <label className="text-sm font-medium">
          Five-axis rubric
          <select value={c.rubricMode} onChange={(e) => setC({ ...c, rubricMode: e.target.value as InstrumentConfig["rubricMode"] })} className={inputCls}>
            <option value="required">Required (all 40 scores)</option>
            <option value="optional">Optional</option>
            <option value="off">Hidden (ranking only)</option>
          </select>
        </label>
        <label className="text-sm font-medium">
          Clinical error assessment
          <select value={c.errorMode} onChange={(e) => setC({ ...c, errorMode: e.target.value as InstrumentConfig["errorMode"] })} className={inputCls}>
            <option value="optional">Shown (optional)</option>
            <option value="off">Hidden</option>
          </select>
        </label>
      </div>
      <Button variant="primary" onClick={() => run(async () => void (await post("/api/admin/config", c)))}>
        Save configuration
      </Button>
    </Card>
  );
}
