# Third-Party Resource & Dependency Disclosure

## 1. Purpose

This document inventories all third-party services, LLM models, npm packages, infrastructure components, and external policy documents referenced or used by GovAid Atlas / GovID AI (`C:\Projects\govaid-atlas`), as required for NAPAI 2026 competition transparency and compliance disclosure.

> **Verification Policy:** No licenses or commercial terms are invented. Where an external model weight license, cloud account tier, or government document reuse term is not explicitly bundled in the repository, it is marked **`UNKNOWN — VERIFY BEFORE SUBMISSION`**.

---

## 2. AI / LLM Providers & Models

| Resource / Service | Purpose | Data Sent | License / Terms | Runtime Dependency | Fallback Behavior | Competition Disclosure Relevance |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **OpenAI API** (`https://api.openai.com/v1/responses`) | Primary cloud LLM planner provider (`src/agent/providers/openai.ts`) using Responses API for strict structured tool proposals (`AgentDecision` JSON schema) | User goal string (`≤ 800` chars) and list of allowlisted tool names (`ALLOWED_AGENT_TOOL_NAMES`). **No** real PII or API keys are sent to browser. | Commercial API Terms of Service (`UNKNOWN — VERIFY BEFORE SUBMISSION` for specific account tier / data-sharing opt-out settings) | **Optional** (enabled when `AGENT_PROVIDER=openai` or `auto` with `OPENAI_API_KEY` set) | Automatically falls back to local Ollama (`src/agent/client.ts`) and then to deterministic rule routing (`fallbackUsed = true`) if unavailable or timed out (`15 s`) | Must disclose whether live stage demo uses OpenAI Cloud (`gpt-4o-mini` / `gpt-5.4-mini`) or local Ollama (`qwen3.5:4b`) |
| **OpenAI Models** (`gpt-4o-mini` default in `openai.ts`; `gpt-5.4-mini` in `docs/openai-live-validation.md`) | Structured JSON planner proposal generation (`nextAction`, `toolName`, `missingField`, `reasoningSummary`) | Same as OpenAI API above | Proprietary OpenAI Model Terms (`UNKNOWN — VERIFY BEFORE SUBMISSION`) | **Optional** | Falls back to Ollama (`qwen3.5:4b`) or deterministic workflow | Disclose exact model ID used in live validation (`gpt-5.4-mini` in `docs/openai-live-validation.md`, default `gpt-4o-mini` in code) |
| **Ollama Local Runtime** (`http://127.0.0.1:11434`) | Local inference server (`src/agent/providers/ollama.ts`) for offline/on-device secondary fallback planning and `LLM_CONTEXT` baseline | Synthetic case inputs, user goal (`≤ 800` chars), allowlisted tool names, and JSON schema (`format` parameter) over loopback `127.0.0.1` | Ollama runtime is MIT License (`UNKNOWN — VERIFY BEFORE SUBMISSION` for exact installed binary version on demo host) | **Optional at runtime** (app works deterministically without it); **Required** if running live local LLM planning or `--method LLM_CONTEXT` benchmark | Deterministic planner & rule engine (`OLLAMA_PROVIDER_UNAVAILABLE` → `fallbackUsed = true`) | Demonstrates on-device privacy-preserving execution with `$0` cloud API cost |
| **Qwen Model (`qwen3.5:4b`)** | Local open-weight model executed via Ollama (`OLLAMA_MODEL=qwen3.5:4b`) for planner routing and `LLM_CONTEXT` benchmark baseline | Same local loopback payload as Ollama (`127.0.0.1:11434`) | `UNKNOWN — VERIFY BEFORE SUBMISSION` (verify exact Qwen weight license version on demo machine before final submission) | **Optional** (loaded by local Ollama daemon) | Deterministic rule engine fallback (`src/agent/orchestrator.ts`) | Primary local LLM used in `benchmark/results.csv` and `docs/demo-reliability-wave3.md` |

> **Provider Architecture:** The planner operates via a 3-tier cascade:
> **OpenAI primary** (`/v1/responses` structured output) → **Ollama fallback** (`qwen3.5:4b`) → **Deterministic safe fallback** (domain-aware rule execution).

---

## 3. NPM Runtime & Development Libraries (`package.json`)

| Package | Version in `package.json` | Purpose | Data Sent Externally | License (per `node_modules` / standard registry) | Runtime Dependency | Fallback | Competition Disclosure Relevance |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **`react`** | `^19.3.1` | Frontend UI component rendering (`src/App.tsx`) | None (runs in browser) | MIT (`VERIFY IN package-lock.json`) | **Required** (Frontend UI) | Static offline HTML showcase (`demo/govaid-atlas-competition-showcase.html`) | Standard open-source UI library |
| **`react-dom`** | `^19.3.1` | DOM mounting for React application (`src/main.tsx`) | None | MIT (`VERIFY IN package-lock.json`) | **Required** (Frontend UI) | Static offline HTML showcase | Standard open-source UI library |
| **`vite`** | `^8.3.6` | Frontend bundler and local dev server (`vite.config.ts`) | None | MIT (`VERIFY IN package-lock.json`) | **Dev / Build-time only** (`src/server.ts` serves built `dist/` in production) | Pre-built `dist/` assets | Build toolchain |
| **`@vitejs/plugin-react`** | `^6.2.1` | React JSX transform plugin for Vite | None | MIT (`VERIFY IN package-lock.json`) | **Dev / Build-time only** | Pre-built `dist/` assets | Build toolchain |
| **`typescript`** | `^7.0.2` | Static type checking (`tsc --noEmit`) | None | Apache-2.0 (`VERIFY IN package-lock.json`) | **Dev / Build-time only** | `N/A` | Type safety verification |
| **`tsx`** | `^4.23.15` | TypeScript execution for `src/server.ts`, `npm test`, and benchmark runners | None | MIT (`VERIFY IN package-lock.json`) | **Required** for running `src/server.ts` and test scripts | Node.js with compiled JS | Server & test runner |
| **`@types/node`, `@types/react`, `@types/react-dom`** | `^26.6.6` / `^19.3.0` | TypeScript type definitions | None | MIT (`VERIFY IN package-lock.json`) | **Dev-time only** | `N/A` | Type definitions |

---

## 4. Infrastructure, Hosting & Network Services

| Service | Purpose | Data Sent | License / Terms | Runtime Dependency | Fallback | Competition Disclosure Relevance |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Node.js Built-in HTTP Server (`node:http`)** | Serves `/api/health`, `/api/agent/plan`, and static `dist/` bundle on `127.0.0.1:8787` (`src/server.ts`) | Local HTTP JSON responses | Node.js Open Source License | **Required** for live web app | Offline HTML (`demo/govaid-atlas-competition-showcase.html`) | Core local backend |
| **Cloudflare Tunnel / DNS (`govaid.torchark.tw`)** | Optional public preview tunnel forwarding HTTPS traffic to local `127.0.0.1:8787` (`README.md`, `docs/demo-reliability-wave3.md`) | HTTP request/response payloads between browser and `127.0.0.1:8787` when accessed via public URL | Cloudflare Terms of Service (`UNKNOWN — VERIFY BEFORE SUBMISSION`) | **Optional** (not required for local `127.0.0.1:8787` demo) | Direct local execution on `http://127.0.0.1:8787` or backup MP4 / offline HTML | Must note in anonymization audit if `torchark.tw` domain identifies team infrastructure |
| **Google Fonts (`Noto Sans TC`, `Plus Jakarta Sans`, `JetBrains Mono`)** | Web font stylesheets linked in `demo/govaid-atlas-competition-showcase.html` (`fonts.googleapis.com`) | Browser HTTP GET for font CSS/WOFF2 when viewing the standalone showcase HTML online | SIL Open Font License (fonts) / Google APIs Terms | **Optional** (falls back to system sans-serif/monospace fonts offline) | System installed CJK & monospace fonts | External CDN request in showcase HTML only (not in main React app `index.html`) |

---

## 5. Official Government Policy Sources (Static Local Excerpts)

GovAid Atlas does **not** connect to any live government API, MyData portal, or household registration database. It references static local rule definitions (`src/policies/*.json` and `src/policies/childcare.ts`) derived from five public government policy sources:

| Source ID | Issuing Agency | Document Name | Public URL Referenced | Reuse / Copyright Terms | Runtime Dependency |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **R1** | 內政部國土管理署 | 三百億元中央擴大租金補貼專案計畫作業規定（115年度） | `https://thd.taichung.gov.tw/media/1305401/附件2-115-300億租金補貼作業規定.pdf` | Government Open Data / Public Administrative Regulation (`UNKNOWN — VERIFY BEFORE SUBMISSION` for specific municipal attachment hosting terms) | None at runtime (encoded locally in `src/policies/central-rent-115.json`; URL shown as citation link only) |
| **R6** | 臺北市政府都市發展局 | 115年度臺北幸福租－民間租屋租金加碼補貼 | `https://rent-allowance.udd.gov.taipei/THR/Files/115紙本臺北市住宅租金加碼補貼申請書.pdf` | Public Administrative Application Document (`UNKNOWN — VERIFY BEFORE SUBMISSION`) | None at runtime (encoded locally in `src/policies/taipei-rent-115.json`; URL shown as citation link only) |
| **R7** | 新北市政府城鄉發展局 | 115年度新北市青年租金補貼 | `https://www.shulin.ris.ca.ntpc.gov.tw/Content/Upload/file/20251001/6389492414785848483467433.pdf` | Public Administrative Announcement (`UNKNOWN — VERIFY BEFORE SUBMISSION`) | None at runtime (encoded locally in `src/policies/new-taipei-rent-115.json`; URL shown as citation link only) |
| **R8** | 衛生福利部社會及家庭署 | 育有未滿2歲兒童育兒津貼申領作業要點（115年度） | `https://twbaby.sfaa.gov.tw/` · `https://www.sfaa.gov.tw/SFAA/Pages/Detail.aspx?nodeid=415&pid=7582` | Public Administrative Policy & Official Portal (`UNKNOWN — VERIFY BEFORE SUBMISSION`) | None at runtime (encoded locally in `src/childcare.ts`; URLs shown as official citation & navigation links) |
| **R9** | 桃園市政府住宅發展處 / 內政部國土管理署 | 300億元中央擴大租金補貼（桃園市政府住宅發展處協辦受理與所得標準規定） | `https://ohd.tycg.gov.tw/` · `https://has.nlma.gov.tw/subsidyOnline/` | Public Administrative Portal & Official Regulations (`UNKNOWN — VERIFY BEFORE SUBMISSION`) | None at runtime (encoded locally in `src/policies/taoyuan-central-rent-115.json`; URLs shown as official referral links) |
