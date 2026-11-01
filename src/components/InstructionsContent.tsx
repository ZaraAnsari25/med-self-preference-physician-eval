import type { InstrumentConfig } from "@/lib/rubric";
import { STUDIES, type StudyId } from "@/lib/studies";

/** Reviewer-facing instructions. Deliberately says nothing about study hypotheses or model performance. */
export function InstructionsContent({ config, study }: { config: InstrumentConfig; study: StudyId }) {
  const def = STUDIES[study];
  const noun = def.candidateNoun.toLowerCase();
  const multiTurn = study === "medsp1000";
  return (
    <div className="space-y-5 text-[0.95rem] leading-relaxed text-ink-2">
      {multiTurn ? (
        <>
          <p>
            You will review conversations between an AI clinician and a simulated patient, based on published
            standardized-patient teaching cases. Each scenario has{" "}
            <strong className="text-ink">eight AI clinician conversations</strong>, labelled Conversation A to Conversation
            H. Each shows eight turns: four from the clinician and four patient replies. Which system played the clinician
            is hidden, and the order is randomized for each reviewer.
          </p>
          <p>
            <strong className="text-ink">Evaluate only the clinician&rsquo;s behavior.</strong> The patient was played by a
            separate simulator; patient turns are there for context and show what information was available. Do not score
            the patient. Work independently. You will not see any other reviewer&rsquo;s or any automated evaluation.
          </p>
        </>
      ) : (
        <>
          <p>
            You will evaluate responses to real clinical questions submitted by physicians. Each question has{" "}
            <strong className="text-ink">eight AI-generated responses</strong>, labelled Response A to Response H. Which
            system wrote each response is hidden, and the order is randomized for each reviewer.
          </p>
          <p>
            Please judge each response on its <strong className="text-ink">clinical quality</strong>, as you would a
            specialist&rsquo;s answer to a colleague&rsquo;s consult question. Work independently. You will not see any
            other reviewer&rsquo;s or any automated evaluation.
          </p>
        </>
      )}

      <div>
        <h3 className="mb-2 font-semibold text-ink">For each {def.unitNoun}</h3>
        <ol className="list-decimal space-y-1.5 pl-5">
          <li>
            {multiTurn
              ? "Read the case information: what the clinician was given before the conversation."
              : "Read the clinical question."}
          </li>
          <li>Read all eight {noun}s in full.</li>
          {config.rubricMode !== "off" && (
            <li>
              Score every {noun} from 0 (lowest) to 5 (highest) on the five criteria below
              {config.rubricMode === "optional" ? " (optional for this study phase)" : ""}.
            </li>
          )}
          <li>
            <strong className="text-ink">Rank all eight {noun}s</strong> from 1 (best) to 8 (worst) using your overall
            clinical judgment, with no ties. Drag the entries or use the arrow buttons, then press{" "}
            <em>Confirm ranking</em>.
          </li>
          {config.errorMode !== "off" && (
            <li>
              Optionally, flag any {noun} in which the {multiTurn ? "clinician makes" : "response contains"} a clinically
              significant error.
            </li>
          )}
        </ol>
      </div>

      {config.rubricMode !== "off" && (
        <div>
          <h3 className="mb-2 font-semibold text-ink">Scoring criteria (0–5, higher is better)</h3>
          <dl className="grid gap-x-4 gap-y-1.5 sm:grid-cols-[10rem_1fr]">
            {def.criteria.map((c) => (
              <div key={c.key} className="contents">
                <dt className="font-medium text-ink">{c.label}</dt>
                <dd>{c.question}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}

      <div className="rounded-lg border border-line bg-subtle p-4">
        <p>
          <strong className="text-ink">Your ranking does not need to follow your scores.</strong> Rank on overall clinical
          quality; the scores and the ranking are recorded separately.
        </p>
      </div>

      <p>
        Your work saves automatically. You can leave and return at any time, and revisit earlier {def.unitNoun}s until you
        submit. After final submission, your evaluations are locked.
      </p>
    </div>
  );
}
