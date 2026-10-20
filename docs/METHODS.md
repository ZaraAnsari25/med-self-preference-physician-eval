# Methods, data provenance and limitations

## 1. Source data audit

**Source:** `DaneshjouLab/Medical-LLM-Self-Preference` at commit
`a40d3617a2e55cb6fe4255198a4b05ba774c3f4c`, fetched by `npm run data:fetch`.

| Need | File in source repo | Finding |
|---|---|---|
| Questions | `data/question_sets/real_pocqi_questions.jsonl` | 620 questions, 30 specialties. Fields: `question_id` (UUID), `question_text`, `specialty`, and provenance (`source_revision`, `source_row_index`). No other context exists. |
| Answers | `data/outputs/generations/real_pocqi_generations.jsonl` | 5,051 attempts and 4,960 judged answers (620 × 8). Qwen has 86 extra successful generations from truncation retries. |
| LLM judgments | `data/real_pcoqi/judgements/rubric_and_model_ranking.jsonl` (Git LFS) | 4,960 successful production judgments (620 × 8 judges). Each lists the exact `generation_id` of every candidate it ranked. |
| Rubric and prompts | `src/judging/real_pocqi.py`, `src/judging/judge_real_pocqi.py` | The five axes match the study brief word for word. Judges saw only `CLINICAL SPECIALTY` and `CLINICAL QUESTION`, followed by the candidates. |

**Validation.** `npm run data:prepare` validates all 620 questions, not only the sampled
ones. For every question it checks:
- exactly 8 judges;
- all judges saw the same 8 `generation_id`s;
- 8 distinct generators;
- every generation exists, succeeded, and belongs to the question;
- question text and specialty are identical across the question set, generations and
  judgments;
- every ranking is a permutation;
- all five scores are present.

**All 620 questions pass.** None of the judged generations hit the output-length limit.

**Which answer version is used.** Answers are taken by the `generation_id` the judges
actually saw, never by "latest attempt". This handles the 86 duplicate Qwen generations.

**Things not available or not used**
- The README links to `docs/` and the manuscript PDF; neither exists at this commit.
- These judgment files are fetched (with `--all`) but not yet imported:
  - the other Real-POCQi conditions: direct ranking, identity-revealed and score-only;
  - the MedSP1000 judgments.
- MedSP1000 has **6** clinician models (no Qwen) and 200 scenarios, so a multi-turn item
  would have 6 conversations ranked 1–6.

## 2. Sampling

`stratifiedSample` in `src/lib/prep/realPocqi.ts` draws 100 of the 620 questions with
seed `pe-real-pocqi-v1`:

1. **Allocation:** proportional allocation across the 30 specialties by the largest-remainder
   method, with at least 1 question per specialty. The resulting allocation is recorded in
   `data/sample-manifest.json`.
2. **Selection within a specialty:** questions are ordered by `sha256("<seed>:stratum:<specialty>:<question_id>")`
   and the first *k* are taken.
3. **Overall order:** the 100 are ordered by `sha256("<seed>:order:<question_id>")`.
   The first 5 are the prototype questions.

Because only SHA-256 is used, any language can reproduce the sample exactly. Re-running
`data:prepare` produces byte-identical output, which was verified.

## 3. Presentation order and counterbalancing

`presentationOrder` in `src/lib/ordering.ts`:

1. **Base order:** each question's 8 responses are put in a base order by
   `sha256("<seed>:base:<item_id>:<response_id>")`.
2. **Reviewer offset:** each reviewer has a fixed `reviewer_slot`, the order in which the
   account was created. Their *k*-th question uses row `(k + slot) mod 8` of an 8×8
   **Williams Latin square**, applied to the base order.
3. **Balance within a reviewer:** over every 8 consecutive questions, each base slot appears
   in each display position exactly once, and each ordered pair of neighbours appears once.
4. **Balance across reviewers:** two reviewers with consecutive slots see every response in
   a different position on the same question.
5. **Storage:** the computed order is stored on the assignment (`presentation_order`), so it
   never needs to be recomputed. Labels A–H always mean "position 1–8 for this reviewer".

The LLM judges' own presentation labels (`response-1`…`response-8`, seeded by question and
judge in the original pipeline) are exported separately, so position effects can be modelled
for both physicians and LLMs.

## 4. Blinding

**Screens.** Physicians see the specialty, the question text, and the answer text with
labels A–H. They never see:
- model or family names;
- generation, judgment or internal response IDs;
- LLM scores or ranks;
- other reviewers' work.

**Code.** `src/server/evaluations.ts`, the only physician-facing data module, never reads
`response_provenance` or `llm_judgments`. Its payloads identify responses only by label.
The server translates labels to `response_id`s using the stored order.

**Tests.**
- `tests/persistence.test.ts › blinding` checks the payload for model names, families and
  internal IDs.
- The browser end-to-end run checks the visible page text and every HTTP response body
  received while grading.

**Instructions.** The instructions say nothing about study hypotheses or which models
performed well.

**Admin dashboard.** It shows progress counts only, not evaluation content.

**Known limitation: writing style.** Model output keeps each model's own style: headings,
length, citation habits and phrasing. An expert reader might recognise a model family from
its style. Removing this would mean editing the original text, which the study design
forbids. The LLM judges faced the same stylistic cues in the blinded condition.

A scan of all 4,960 answers found no self-identifying model names. The only matches were two
references to the GEMINI clinical trial.

## 5. Methodological parallels and differences vs. the LLM judges

| Aspect | LLM judges | Physicians |
|---|---|---|
| Inputs | Specialty + question + 8 answers | Same |
| Rubric | Five axes, 0–5, identical wording | Same wording; whole numbers only |
| Ranking | Strict 1–8, need not follow scores | Same. Never derived from scores, with explicit confirmation |
| Order | Seeded per (question, judge) | Seeded per (question, reviewer), Williams-balanced |
| Error flag | Not collected | Optional separate instrument, labelled as such |

- **Draft rankings.** A draft ranking is saved, but only `ranking_confirmed = true` rows
  count as final.
- **Confirming the shown order.** If a physician confirms without moving any entry,
  `ranking_modified = false` is recorded, so these cases can be analysed separately.

## 6. Data integrity

**Original answers never change.**
- The importer is insert-only.
- On re-import it verifies that existing questions and answers are byte-identical, and stops
  otherwise.
- Every answer's SHA-256 is stored, and the admin "data mapping check" recomputes it.

**Saving.**
- Saves are full-state and idempotent.
- They are guarded by a revision number: a stale write from another tab returns HTTP 409
  instead of overwriting.
- Every accepted save is also kept in the append-only `save_events` table.

**After final submission**, the server rejects all writes (HTTP 423) until an admin reopens
the reviewer.

**Exports were checked against the source.** On the prototype, every exported LLM row
(320/320) was compared with the original JSONL by `generation_id`: rank, scores, generator
and judgment ID. There were zero mismatches. All 40 answer-text hashes also matched the
original generations.

## 7. Multi-turn (MedSP1000) readiness

Already in place:
- `items.item_type = 'multi_turn'`, `items.turn_count`, `responses.content_format = 'transcript'`
  and `responses.transcript`;
- the UI renders clinician and patient turns, with patient turns labelled as context;
- ranking, ordering and validation work for any number of responses (6 for MedSP1000).

Still to do: a `prepare-medsp1000` step, which should:
- take `question_text`, the clinician-visible packet, as case information;
- **never include `private_patient_context`**;
- cut each conversation to 2, 4, 6 or 8 visible turns exactly as the original judging
  pipeline did;
- link conversations to the MedSP1000 judgment files by `generation_id`.

## 8. Before collecting real physician evaluations

This checklist is for the study team. **None of these items has been confirmed by this
software.**

- [ ] **IRB / institutional review** decision for collecting physician evaluations.
- [ ] **Data use:**
  - Real-POCQi is CC-BY-4.0, so attribution is required.
  - The source repository is MIT.
  - Confirm that hosting the questions and model outputs on the chosen server is allowed.
- [ ] **De-identification review of the questions.** An automated pattern scan found no
  names, record numbers or dates of birth, only ages and years. This is not a formal review.
- [ ] **Hosting** approved for the data class, with HTTPS (`COOKIE_SECURE=true`) and backups.
- [ ] **Reviewer accounts:** create them with pseudonymous usernames where possible, and
  share passwords through a secure channel.
- [ ] **Pilot decisions:**
  - rubric `required` vs `optional` vs `off`;
  - error instrument on or off;
  - how many reviewers per question (the system supports any overlap).
- [ ] **Approval to expand** from the 5-question prototype to the 100-question sample.
