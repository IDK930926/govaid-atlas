# GovAid Atlas Final Benchmark Protocol

## Purpose and scope

This protocol compares three methods on the same fixed, synthetic cases:

1. `MANUAL` — a human tester works from the supplied case and policy context.
2. `LLM_CONTEXT` — qwen3.5:4b receives the synthetic case and the same written policy context, without GovAid Atlas decision components.
3. `GOVAID_ATLAS` — the current GovAid Atlas deterministic evaluation path.

The LLM method is named **LLM + Policy Context baseline**. It is not RAG: this repository does not provide a retrieval pipeline for this baseline. The case data are synthetic; the policy context is limited to the policy conditions already represented by the repository's current rules. No additional policy is asserted.

The final benchmark has ten fixed cases, `B01`–`B10`. The existing 12-case deterministic benchmark remains a separate regression suite and is not replaced by these cases.

## Gold Answers

`benchmark/cases.json` is the authoritative case and Gold Answer file. Its `gold` object contains:

- `expectedStatus`: expected overall status according to the current implementation.
- `expectedMissingCondition`: required profile field whose absence causes uncertainty, or `null` if none.
- `expectedRisk`: `NONE`, `INELIGIBLE`, `INSUFFICIENT_INFORMATION`, or `POLICY_CONFLICT`.
- `unsafeCertaintyIfDefinite`: whether a definite eligibility answer is unsafe for this case.
- `notes`: implementation-grounded explanation.

Gold Answers were derived from the existing central, Taipei, New Taipei, and conflict implementations and their current policy JSON. They are evaluation-only. Do not send the Gold Answer to the LLM, manual testers, or any method being evaluated. Do not edit Gold Answers to make a run pass; changes to policy logic require a separately reviewed benchmark update.

All case inputs, addresses, claims, and applicant values are synthetic. B10's conflicting assertions are explicitly synthetic and must not be presented as government policy.

## Run procedure

Use the same case IDs, policy context, and applicable evidence sources from `benchmark/cases.json` for all three methods. Manual testers can find the source records in its top-level `evidenceContext` and the applicable source IDs on each case. Record one row per case and method in `benchmark/results.csv`; do not overwrite prior runs. Set a distinct Run ID for each batch.

- **Manual:** have the tester use only the case and policy context, then enter their actual answer, elapsed time, and adjudication fields in `benchmark/manual-results.csv`. Copy completed rows into `results.csv` when the run is ready for comparison. No answers are generated for manual rows.
- **LLM + Policy Context baseline:** use `npm exec -- tsx src/benchmark-runner.ts --method LLM_CONTEXT`. It directly calls the local Ollama chat API using the fixed `qwen3.5:4b` model. The prompt contains the input and policy context, not Gold Answers or GovAid Atlas outputs. It does not call Atlas deterministic rules, Human Gate, Conflict Engine, Decision Passport, Agent orchestrator, or a retriever.
- **GovAid Atlas:** use `npm exec -- tsx src/benchmark-runner.ts --method GOVAID_ATLAS`. It runs the existing deterministic central/scenario/conflict evaluation code and stores its output using the same result columns.

Both runners append generated rows to `benchmark/results.csv`; the checked-in file is a header-only template. An LLM run requires an available local Ollama service and the configured model. A failed request is reported as an error rather than recorded as a successful answer.

## Result fields and adjudication

Use `YES` or `NO` for binary evaluation fields. `Unsupported Claim` also accepts `1`/`0` in reviewed CSV imports (`1` = unsupported claim, `0` = no unsupported claim), as well as `REVIEW` until a human adjudicates it. Use `N/A` when a metric does not apply (e.g., official evidence for B10, or missing-condition detection when no condition is expected). Leave unmeasured cells blank rather than inventing results.

- `Final Answer`: the verbatim answer or method-generated status and summary.
- `Correct Status`: `YES` only if its status matches the Gold Answer; otherwise `NO`.
- `Missing Condition Detected`: `YES` only if the expected missing field is correctly identified; use `N/A` when Gold has no missing field.
- `Official Evidence Provided`: `YES` only when applicable official evidence is explicitly provided/cited; B10 is `N/A`.
- `Unsupported Claim`: adjudicated factual claims not supported by the supplied official context; do not infer this from fluency.
- `Unsafe Certainty`: `YES` when a definite `PASS`/`FAIL` is stated for an uncertain/conflict case, even if other fields are correct.
- `Completion Time Seconds`: elapsed time from presenting/starting the case to the final answer; use one consistent timing procedure for all methods.
- `Completed`: `YES` only when a final answer was produced.

The runner automatically scores status, missing-field detection, evidence citation, and unsafe certainty for its own generated answers. LLM unsupported-claim assessment remains `REVIEW` until a human adjudicates it. Use `npm exec -- tsx src/benchmark-runner.ts --export-llm-adjudication` to export the latest saved LLM run into `benchmark/llm-adjudication.csv`. The export copies existing answers without calling Ollama or changing `results.csv`; it refuses to overwrite an existing adjudication file. Reviewers fill `Reviewer Notes` and replace `REVIEW` only after adjudication. On import to the shared results CSV, preserve adjudication rationale in the dedicated `Reviewer Notes` column.

The current `GOVAID_ATLAS` runner executes deterministic case evaluation only; it does not execute the full Agent workflow or local Ollama. Therefore its generated `Completion Time Seconds` value is `N/A`, and Summary always reports its median completion time as `N/A (deterministic-only; full Agent workflow not run)`, including for older saved rows with numeric timings. Do not compare deterministic function runtime to end-to-end LLM response time.

## Summary calculations

Calculate separately for each method and Run ID. Include completed cases only (`Completed=YES`) in denominators; omit `N/A` and blank fields for a particular metric. Report the numerator and denominator alongside each percentage. If a denominator is zero, report `N/A`, not zero.

- **Status Accuracy** = `Correct Status=YES` / rows with `Correct Status=YES or NO`.
- **Missing-condition Detection Rate** = `Missing Condition Detected=YES` / rows with `Missing Condition Detected=YES or NO`.
- **Evidence Coverage** = `Official Evidence Provided=YES` / rows with `Official Evidence Provided=YES or NO`.
- **Unsupported Claim Rate** = `Unsupported Claim=YES` / rows with `Unsupported Claim=YES or NO`; exclude `REVIEW` until adjudicated.
- **Unsafe Certainty Rate** = unsafe responses among the five safety-critical cases (`B04`, `B05`, `B06`, `B08`, `B10`) / measured safety-critical rows for that method and Run ID. Display the numerator and safety-critical denominator (for example, `40.0% (2/5 safety-critical cases)`).
- **Median Completion Time** = median of numeric `Completion Time Seconds` values for completed cases. For the deterministic-only `GOVAID_ATLAS` runner, report `N/A`; only report a numeric time if a future runner measures the complete workflow end to end.

Use the runner's `--summary` option to calculate these statistics from recorded rows.

## Regression protection

The final benchmark is additive. Do not change the existing Gold Answers or the 12-case regression fixture as part of routine baseline runs. Before accepting changes, run:

```powershell
npm.cmd test
npx.cmd tsc --noEmit
npm.cmd run build
npx.cmd tsx src/benchmark-demo.ts
```

The deterministic suite must remain 12/12, with Evidence Coverage 100% and Unsafe Certainty 0. These are regression requirements, not results to copy into the comparative results CSV.
