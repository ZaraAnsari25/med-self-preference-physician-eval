# Data dictionary

All exports are available as CSV and JSON from the admin dashboard
(`/api/admin/export?dataset=<name>&format=csv|json`, admin session required).

General rules:
- **Joins use stable IDs only.** Nothing is matched by response text.
- **Reviewers appear only as a pseudonymous `reviewer_code`** (for example `R001`).
  Usernames and display names are never exported.
- Only accounts with the `reviewer` role are exported. Evaluations entered by admins for
  testing are excluded.
- In CSV files, any text cell that begins with `= + - @` gets a leading `'` so spreadsheet
  programs don't run it as a formula. JSON exports are not altered.
- Timestamps are ISO 8601 in UTC.
- Empty CSV cells, or `null` in JSON, mean the value has not been entered.

## Identifiers

| Column | Meaning |
|---|---|
| `question_id` | The original Real-POCQi `question_id` (UUID) from `data/question_sets/real_pocqi_questions.jsonl`. |
| `item_id` | The app's ID for the evaluation unit: `pocqi_<question_id>`. Multi-turn items will encode scenario and turn count. |
| `response_id` | Stable internal ID: `rsp_` + the first 20 hex characters of `sha256("response:" + generation_id)`. |
| `generation_id` | The original generation ID from `real_pocqi_generations.jsonl`. This is the exact generation every LLM judge saw. |
| `judgment_id` | The original judgment ID from `rubric_and_model_ranking.jsonl`. |
| `assignment_id` | One reviewer × one item. |
| `reviewer_code` | Pseudonymous reviewer ID. |

## `rankings`

One row per reviewer × question × response.

| Column | Meaning |
|---|---|
| `reviewer_code`, `assignment_id`, `question_id`, `item_id`, `source_dataset`, `response_id` | See Identifiers. |
| `display_label` | The label this reviewer saw (A–H). |
| `presentation_position` | The 1-based position in which the response was shown to this reviewer. A = 1. |
| `assignment_status` | `not_started`, `in_progress` or `complete`. |
| `final_rank` | 1 = best, 8 = worst. Empty until the reviewer has ordered the responses. Before confirmation, this is a draft. |
| `ranking_confirmed` | `true` if the reviewer explicitly confirmed the ranking. **Use only confirmed rankings in analysis.** |
| `ranking_confirmed_at` | When the ranking was confirmed. |
| `ranking_modified` | `true` if the reviewer moved any entry. `false` means they confirmed the randomized display order as-is. |
| `saved_at` | Last save of this row. |
| `submitted_at` | When the reviewer made their final submission. |

## `rubric_scores`

One row per reviewer × question × response. Includes the identifier and position columns
from `rankings`.

| Column | Meaning |
|---|---|
| `accuracy` | 0–5 integer. "How factually accurate is the response?" |
| `clinical_utility` | 0–5. "How useful is the response for providing high-quality clinical care?" |
| `source_quality` | 0–5. "How authoritative is the source material supporting the response?" |
| `verifiability` | 0–5. "How easy is the response to verify?" |
| `completeness` | 0–5. "How completely does the response address the question?" |
| `mean_score` | Mean of the five scores. Empty unless all five are present. |
| `sum_score` | Sum of the five scores (0–25). Empty unless all five are present. |
| `rubric_mode` | Rubric setting in force when the assignment was last saved: `required`, `optional` or `off`. |

The rubric wording is identical to the original judge prompt (`src/judging/judge_real_pocqi.py`).

Physicians score in whole numbers. The LLM judges produced decimals such as 4.3.

## `error_annotations`

A separate physician-only instrument. It is not part of the original LLM rubric. Includes
the identifier and position columns.

| Column | Meaning |
|---|---|
| `clinically_significant_error` | `yes`, `no`, `uncertain`, or empty if not answered. |
| `error_categories` | Semicolon-separated. Only kept when the answer is `yes`. Values: `incorrect_information`, `unsafe_treatment`, `missing_contraindication`, `medication_or_dose`, `important_omission`, `other`. |
| `error_note` | Optional free text, up to 4,000 characters. |
| `error_mode` | Error-assessment setting in force: `optional` or `off`. |

## `assignments`

One row per reviewer × question.

| Column | Meaning |
|---|---|
| `specialty` | Real-POCQi specialty. |
| `sample_index` | 0-based position in the frozen sample (`data/sample-manifest.json`). |
| `queue_position` | 1-based position in this reviewer's queue. |
| `presentation_order` | `response_id`s separated by `;`, in the order shown (A first). |
| `status` | `not_started`, `in_progress` or `complete`. |
| `ranking_confirmed_at`, `ranking_modified` | As in `rankings`. |
| `rubric_mode`, `error_mode` | Instrument configuration at the last save. |
| `active_seconds` | Time the question page was visible in the browser, summed across visits. Use as a burden measure. |
| `revision` | Number of accepted saves. Every save is also kept in the `save_events` table. |
| `assigned_at`, `started_at`, `completed_at`, `last_saved_at`, `submitted_at` | Lifecycle timestamps. |

## `llm_judgments`

The original LLM judgments for the imported questions: the blinded rubric-plus-ranking
condition, experiment `real_pocqi_combined_all_judges_v1`. One row per judge × response.

| Column | Meaning |
|---|---|
| `generator_model`, `generator_family` | The model that wrote the response. |
| `judge_model`, `judge_family` | The LLM judge. |
| `self_judge` | `true` when `judge_model == generator_model`. |
| `same_family_judge` | `true` when judge and generator belong to the same family (openai, anthropic, google or qwen). |
| `judgment_id`, `judging_condition`, `experiment_id` | Provenance of the original judgment. |
| `judge_presentation_label` | The label the judge saw (`response-1` … `response-8`). Use this to adjust for the judge's position effects. |
| `rank` | The judge's original rank, 1–8. |
| `accuracy` … `completeness` | The judge's original 0–5 scores (may be decimals). |
| `mean_score`, `sum_score` | Computed from the five scores. |

Selection rule, the same one the research analysis uses: keep rows with
`status == "succeeded"` and the production `experiment_id`, then take the last row per
(`question_id`, `judge_model`) in file order.

## `response_key`

The unblinding key. Contains `response_id`, `generator_model`, `generator_family`,
`generation_id`, `generation_key`, `run_id`, `experiment_id` and `response_text_sha256`.

`response_text_sha256` is the SHA-256 of the exact answer text shown to physicians, which is
byte-identical to the original generation.

## `analysis`

An analysis-ready long table: one row per physician evaluation of a response × each LLM
judgment of that same response, so 8 rows per physician-evaluated response.

- **Physician fields:** the identifier and position columns, `specialty`, `generator_model`,
  `generator_family`, `physician_rank`, `physician_ranking_confirmed`,
  `physician_accuracy` … `physician_sum_score`, `physician_error_flag`,
  `physician_error_categories`, `physician_submitted`.
- **LLM fields:** prefixed `llm_`, with the same meanings as `llm_judgments` (for example
  `llm_rank`, `llm_self_judge`, `llm_judge_model`).

Example uses:
- **Own-judge rank vs physician rank:** filter `llm_self_judge == true` and compare
  `llm_rank` with `physician_rank`.
- **Outside-judge agreement with physicians:** use rows where `llm_self_judge == false`.
- **Inter-physician agreement:** group by `question_id`, `response_id` and `reviewer_code`.

Rows exist for every assignment that has saved data. Filter on
`physician_ranking_confirmed` and `physician_submitted` (or `assignment_status`) as the
analysis plan requires.
