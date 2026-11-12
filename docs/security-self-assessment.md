# Security, Controllability & Governance Self-Assessment

## 1. Executive Summary

GovAid Atlas is architected around a **Deterministic-First, Bounded-Agent** security model:
- The LLM planner (`OpenAI` or local `Ollama`) is treated as an **untrusted proposal generator**.
- Every planner output must pass a 3-layer validation gate (`SCHEMA_VALIDATION` → `ALLOWLIST_VALIDATION` → `STATE_TRANSITION_VALIDATION`) before any tool executes.
- All eligibility calculations (`FAIL`, `NOT_COVERED`, `UNCERTAIN`, `PARTIAL_CHECK`, `PASS`) are computed exclusively by deterministic TypeScript modules (`src/rules.ts`, `src/scenario.ts`, `src/coverage.ts`, `src/status.ts`).

> **CRITICAL DISCLOSURE ON RBAC DEMO CONTROL:**
> The Role / Permission Switcher (`Applicant` / `Caseworker` / `Auditor` in `src/permissions.ts` and `src/permission-demo.ts`) is an **in-memory synthetic UI demonstration** of field-level data masking concepts. **It is NOT a production authentication, session management, or server-enforced Role-Based Access Control (RBAC) system.** Do not deploy or market this demo control as enterprise access control.

---

## 2. Fourteen-Point Security & Governance Assessment

### 2.1 Data Minimization
- **Implementation:** The application operates entirely on synthetic persona profiles (`src/demo.ts`, `benchmark/cases.json`). No national ID numbers, bank accounts, tax filings, or real residential street addresses are required to run the eligibility engine.
- **State Summary Minimization:** Per-step Agent traces (`src/agent/missing-fields.ts` `summarizeSafeState`) record only boolean presence flags (`ownsHomeProvided`, `receivesOtherHousingAidProvided`, `monthlyIncomeProvided`, `ageProvided`) and municipality-level names (`actualCity`, `whatIfCity`), avoiding raw personal data retention.

### 2.2 Secret Management
- **Implementation:** API keys (`OPENAI_API_KEY`) are read strictly on the Node.js server (`src/agent/providers/openai.ts`, `src/server.ts`) from `process.env`.
- **Browser Isolation:** No `VITE_*` secret environment variables exist, and the client bundle (`dist/`) never receives or stores any API key or bearer token.
- **Repository Hygiene:** `.gitignore` excludes `.env` and `.env.*` (except `.env.example`, which contains an empty `OPENAI_API_KEY=`). Secret scans across HEAD and git history (`docs/final-anonymity-audit.md`, `docs/anonymization-audit.md`) confirm zero leaked keys.

### 2.3 API Exposure & Network Binding
- **Implementation:** `src/server.ts` binds by default to loopback `127.0.0.1:8787` (`HOST = process.env.HOST ?? "127.0.0.1"`). Local Ollama binds to `127.0.0.1:11434` and is never exposed directly to the public internet.
- **Endpoints Exposed:** Only `GET /api/health`, `POST /api/agent/plan`, and static SPA assets under `dist/` (with path-traversal protection verifying resolved paths start with `DIST_DIR`).

### 2.4 Rate Limiting
- **Implementation:** `src/server.ts` enforces an in-memory per-IP sliding-window rate limiter (`checkRateLimit`, default `20 requests / 60,000 ms` window, configurable for tests via `setRateLimitMaxRequests`).
- **Behavior when Exceeded:** Returns HTTP `429 Too Many Requests` with `Retry-After` header and structured JSON `{ ok: false, errorCode: "RATE_LIMIT_EXCEEDED", error: "Too many requests. Please retry later." }`.
- **Verification:** Verified in `src/agent/wave2-hardening.test.ts` (`API Hardening — rate limit returns HTTP 429 with structured error`).

### 2.5 Payload & Input Limits
- **Implementation:**
  - `MAX_REQUEST_BODY_BYTES = 16384` (16 KB) enforced in `readBody` (`src/server.ts`) via both `Content-Length` header check and streaming byte-count accumulation; oversized requests are immediately destroyed and return HTTP `413` (`PAYLOAD_TOO_LARGE`).
  - `MAX_GOAL_LENGTH = 800` characters enforced on `goal`; oversized goals return HTTP `400` (`GOAL_TOO_LONG`).
  - Empty goals (`EMPTY_GOAL`), non-string goals (`INVALID_GOAL_TYPE`), non-object `profile` (`INVALID_PROFILE`), and malformed JSON (`INVALID_JSON_BODY`) return HTTP `400`.
- **Verification:** Verified in `src/agent/wave2-hardening.test.ts`.

### 2.6 Provider Timeout Protection
- **Implementation:** `callPlanner` in `src/agent/client.ts` wraps provider promises with `withTimeout` (`DEFAULT_PROVIDER_TIMEOUT_MS = 15000`, overrideable via `timeoutMs` or `AGENT_PROVIDER_TIMEOUT_MS`).
- **Behavior on Timeout:** Resolves cleanly with `providerStatus: "UNAVAILABLE"` and `error: "AGENT_PROVIDER_TIMEOUT"` without crashing the server or hanging the client request.
- **Verification:** Verified in `src/agent/wave2-hardening.test.ts` (`API Hardening — provider timeout returns controlled AGENT_PROVIDER_TIMEOUT fallback`).

### 2.7 Tool Allowlist Enforcement
- **Implementation:** Only the 11 tools defined in `ALLOWED_TOOLS` (`src/agent/tools.ts`) and `ALLOWED_AGENT_TOOL_NAMES` (`src/agent/types.ts`) are recognized:
  1. `evaluate_central_rules`
  2. `evaluate_actual_scenario`
  3. `evaluate_what_if_scenario`
  4. `evaluate_childcare_rules`
  5. `detect_policy_conflict`
  6. `generate_decision_passport`
  7. `generate_childcare_passport`
  8. `get_policy_evidence`
  9. `request_missing_field`
  10. `request_human_confirmation`
  11. `complete`
- **Defense-in-Depth:** Checked both in `validatePlannerProposal` (`src/agent/orchestrator.ts`) and inside `callTool` (`src/agent/tools.ts`). Any unallowlisted tool (e.g., `run_shell_cmd`, `execute_shell_command`) is rejected with `TOOL_NOT_IN_ALLOWLIST`. Domain isolation prevents housing tools from executing on childcare queries and vice versa.

### 2.8 Three-Stage Proposal Validation & Loop Protection
- **Implementation (`validatePlannerProposal` in `src/agent/orchestrator.ts`):**
  1. `SCHEMA_VALIDATION`: Verifies JSON object shape, non-empty `reasoningSummary`, valid `nextAction`, and valid `toolArguments` type.
  2. `ALLOWLIST_VALIDATION`: Verifies `toolName` is in the allowlist and conforms to the detected benefit domain (`HOUSING` vs `CHILDCARE`).
  3. `STATE_TRANSITION_VALIDATION`:
     - Blocks `toolArguments` containing override keys (`status`, `overallStatus`, `eligibilityStatus`, `overrideStatus`, `forcePass`, `result`) or attempting to mutate existing non-null `ApplicantProfile` fields (`UNSAFE_PROFILE_MUTATION_<field>`).
     - Blocks premature `COMPLETE` when required evaluations have not yet run (`PREMATURE_COMPLETE_BEFORE_EVALUATION` or `PREMATURE_COMPLETE_BEFORE_CHILDCARE_EVALUATION`).
     - Blocks duplicate tool execution when state signature has not changed (`DUPLICATE_TOOL_CALL_WITHOUT_STATE_CHANGE`).
- **Step Ceiling:** `MAX_AGENT_STEPS = 8` prevents runaway loops and fails closed with `MAX_AGENT_STEPS_EXCEEDED`.

### 2.9 Deterministic Policy Authority
- **Implementation:** The LLM planner cannot pass custom eligibility statuses or modify rule JSONs. `buildToolArguments` (`src/agent/orchestrator.ts`) constructs tool inputs directly from the authoritative `InternalExecutionState`, ignoring any LLM-supplied profile overrides.
- **Status Aggregation Priority (`src/status.ts`):** Enforces `FAIL > NOT_COVERED > UNCERTAIN > PARTIAL_CHECK > PASS`. A deterministic `FAIL` can never be downgraded or masked by another scenario or planner action.

### 2.10 Trace Redaction & Sanitization
- **Implementation:** `sanitizeForTrace` (`src/agent/trace.ts`) recursively strips sensitive property names (`apiKey`, `authorization`, `token`, `secret`, `password`, `systemPrompt`, `rawPrompt`, `chainOfThought`, `nationalId`, `phone`, `email`, `fullAddress`) and scrubs inline `sk-...` keys, `Bearer ...` tokens, and Taiwan ID patterns before serializing or exporting traces to `artifacts/traces/<run-id>.json`.

### 2.11 Human Intervention & Input Validation Gate
- **Implementation:** When required fields across housing or childcare (`ownsHome`, `receivesOtherHousingAid`, `city`, `monthlyIncome`, `age`, `centralRentApproved`, `newTaipeiResidenceStudyWork`, `registeredCity`, `childAgeMonths`, `childHasBirthOrInitialHouseholdRegistration`, `receivesPublicOrQuasiPublicChildcare`, `isGovernmentPlaced`, `birthOrder`, `childRegisteredCity`) are `null` or missing, the Agent halts at `WAITING_FOR_HUMAN` and prompts via dynamic human gate controls.
- **Arbitrary Case UI & Input Validation:** All 14 supported fields have dedicated interactive input controls and strict type/range validators (e.g. numeric validation rejecting negative income, non-numeric strings, or invalid month counts) before mutating state and resuming execution (`src/case-input.ts`).

### 2.12 `NOT_COVERED` Boundary Enforcement
- **Implementation:** `src/coverage.ts` inspects both the user's natural-language query (`assessQueryCoverage`) and scenario cities (`assessCityCoverage`):
  - **Childcare Domain:** The 115-fiscal-year Under-2 Childcare Allowance (`育有未滿2歲兒童育兒津貼`) is supported with verified deterministic logic and benefit calculations. Unsupported childcare queries (e.g. `托育補助`, `生育獎勵`, `就學補助`, `育嬰留職停薪`) return `NOT_COVERED` (`CHILDCARE_POLICY_NOT_IMPLEMENTED`) accompanied by verified official referral links (MOHW / SFAA / twbaby.sfaa.gov.tw).
  - **Housing & Municipalities:** Central rental subsidy intake navigation is supported for Taipei, New Taipei, and Taoyuan City (`TAOYUAN_CENTRAL_RENT_115`, returning `PARTIAL_CHECK` and enforcing Taoyuan income caps). Unimplemented Taoyuan-local-only programs (such as indigenous rental aid) or unsupported municipalities (e.g. `臺中市`, `高雄市`) return policy-specific `NOT_COVERED` with official referrals to the National Land Management Agency (NLMA `has.nlma.gov.tw/subsidyOnline/`) and never claim `PASS`.

### 2.13 Failure Recovery & Graceful Degradation
- **Implementation:** If OpenAI or Ollama is unreachable, returns HTTP 500, outputs malformed JSON, or times out, the orchestrator records `AGENT_LLM_CALL_FAILED` / `AGENT_PROPOSAL_REJECTED`, sets `fallbackUsed = true`, and completes the deterministic rule evaluation so the user never experiences a blank screen or silent fake `PASS`. Server fallback proposals automatically match the detected benefit domain (`evaluate_childcare_rules` for childcare, `evaluate_central_rules` for housing, or safe non-tool completion for unsupported domains).

### 2.14 Known Security & Governance Limitations
1. **Synthetic RBAC Only:** As disclosed in §1, `src/permissions.ts` is a client-side educational demonstration of role views (`Applicant`, `Caseworker`, `Auditor`), not a backend authentication or access-control enforcement layer.
2. **In-Memory Rate Limiter:** The rate limiter in `src/server.ts` stores IP counters in process memory and resets on server restart; behind a reverse proxy/tunnel (`cloudflared`), all requests may share `127.0.0.1` unless proxy headers are configured with a trusted proxy list.
3. **No Persistent Database or Encryption-at-Rest:** GovAid Atlas is a stateless prototype and does not persist user sessions to an external database.
4. **Policy Scope & Completeness:** Housing rental policies encode verified core rules returning `PARTIAL_CHECK` (preliminary verification), while Under-2 Childcare Allowance encodes complete national statutory criteria. Official final determinations remain with municipal and ministerial reviewing caseworkers.
