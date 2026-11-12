# GovAid Atlas — Final Production Deployment Checklist (Gate D)

> [!IMPORTANT]
> **Production Operator Instructions:**  
> This checklist is for the human production machine operator who manages the local server host and public Cloudflare tunnel (`https://govaid.torchark.tw/`). The AI Agent is strictly prohibited from deploying to production, altering production processes, or creating git tags. Follow every step in sequence.

---

## 1. Deployment Target & Commit

- **Target Branch:** `release/napai-final-rc`
- **Target Commit:** Head commit of `release/napai-final-rc` (verify via `git rev-parse HEAD`)
- **Rollback Target Commit:** Commit `10655ff` (Gate B verified commit) or last known operational deployment commit.
- **Rollback Dist Backup Path:** `dist-backup/` (operator should back up current `dist/` before rebuilding).

---

## 2. Environment Variables Verification

Inspect the host `.env` file (`C:\Projects\govaid-atlas\.env`):

```bash
# Provider Configuration (Recommended Live Stage)
AGENT_PROVIDER=auto

# OpenAI Primary Cloud Provider
OPENAI_API_KEY=sk-...               # Must be present and valid
OPENAI_MODEL=gpt-5.4-mini            # Fast, structured Responses API
OPENAI_BASE_URL=https://api.openai.com/v1/responses

# Ollama Standby Local Provider
OLLAMA_BASE_URL=http://127.0.0.1:11434
OLLAMA_MODEL=qwen3.5:4b

# Server Binding
PORT=8787
HOST=127.0.0.1
```

- [ ] Check `OPENAI_API_KEY`: Verify string is non-empty, starts with `sk-`, and has active credit/quota.
- [ ] Check `AGENT_PROVIDER`: Set to `auto` (enables automatic 3-tier cascade: OpenAI Cloud → Local Ollama → Deterministic Fallback).
- [ ] Check `OPENAI_MODEL`: Set to `gpt-5.4-mini`.

---

## 3. Pre-Deployment Validation (On Production Machine)

Run the automated verification suite before touching running processes:

```powershell
# 1. Verify tests
npm.cmd test
# Expected: 99 / 99 PASS across 10 test suites

# 2. Verify TypeScript typecheck
npx.cmd tsc --noEmit
# Expected: 0 errors

# 3. Create backup of current dist/
if (Test-Path dist) { Copy-Item -Recurse -Force dist dist-backup }

# 4. Build fresh production bundle
npm.cmd run build
# Expected: built client bundle in ~400ms without error
```

---

## 4. Server Process Restart & Local Verification

Restart the local Node.js server binding to `127.0.0.1:8787`:

```powershell
# 1. Stop existing node server process listening on port 8787
Get-Process -Name node | Where-Object { $_.MainWindowTitle -like "*govaid*" -or (Get-NetTCPConnection -LocalPort 8787 -ErrorAction SilentlyContinue) } | Stop-Process -Force

# 2. Launch production server in background
Start-Process npm.cmd -ArgumentList "start" -WindowStyle Hidden

# 3. Verify local health check
Invoke-RestMethod http://127.0.0.1:8787/api/health
```

**Expected Local Health Response:**
```json
{
  "ok": true,
  "provider": "openai",
  "providerStatus": "AVAILABLE",
  "activeModel": "gpt-5.4-mini",
  "version": "1.0.0"
}
```

---

## 5. Public Domain & Tunnel Verification (`https://govaid.torchark.tw/`)

If Cloudflare tunnel (`cloudflared`) is active:

1. **Verify Public HTTP 200:**
   ```powershell
   (Invoke-WebRequest -Uri "https://govaid.torchark.tw/" -UseBasicParsing).StatusCode
   ```
   *Expected: `200`*

2. **Verify Public Health Endpoint:**
   ```powershell
   Invoke-RestMethod https://govaid.torchark.tw/api/health
   ```
   *Expected: `ok: true`, `providerStatus: AVAILABLE`*

3. **Verify Bundle Freshness in Browser:**
   - Open Chrome Incognito window to `https://govaid.torchark.tw/`.
   - Verify UI copy displays:
     - Multi-domain selector / intake (Housing & Childcare).
     - Rental subsidies verdict reflects: **初步條件通過（部分檢核）** (`PARTIAL_CHECK`).
     - Childcare Under-2 Allowance evaluates to **條件符合** (`PASS`) with tiered calculation.
     - Out-of-scope queries (托育補助) display **`NOT_COVERED`** with official referral links.

---

## 6. Rollback Procedure (Emergency Only)

If any critical failure occurs during deployment:

```powershell
# Step 1: Restore previous dist build
Remove-Item -Recurse -Force dist
Copy-Item -Recurse -Force dist-backup dist

# Step 2: Switch git commit back to rollback target
git checkout 10655ff

# Step 3: Restart process
Get-Process -Name node | Stop-Process -Force
Start-Process npm.cmd -ArgumentList "start" -WindowStyle Hidden

# Step 4: Verify health
Invoke-RestMethod http://127.0.0.1:8787/api/health
```
