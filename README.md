# MergeDesk

Orient a large PR. List cited exceptions. Advisory — on your Token Factory key.

Hosted Next.js app for the Nebius x NVIDIA Global AI Hackathon (Coding & Agentic Engineering). Stamps are **advisory stamps** only. Models never merge, never write patches. Public GitHub repos only.

## What you get

- An orientation **map** first (start-here, import neighborhood, mermaid).
- A cited-exception list second. Display labels, not the SHIP/FIX/BLOCK enum:
  - **No cited exceptions**
  - **Cited exceptions**
  - **High-certainty exception**
- **Coverage chips** for snapshot, parser, graph files, hops, Tavily, vision, plus `budget_capped` / `timed_out` when they apply.
- A display-rate **Estimate** ledger (hackathon catalog rates, not the Nebius invoice).
- A Live / Fixture / Replay badge. Replay is never shown as Live.

## Token Factory and Nemotron SKUs

Runtime Chat Completions go to **Nebius Token Factory** (`https://api.tokenfactory.nebius.com/v1/`). Hugging Face / OpenRouter of the same weights do not count.

**Billing must be enabled on Token Factory.** The in-app ledger is an estimate at display rates; Token Factory billing is the source of truth.

Catalog ids (probed via `GET /v1/models` at boot; Lightning falls back to Nano if missing):

| Step | Catalog id | When |
|---|---|---|
| Triage | `nvidia/Nemotron-3_5-Lightning` | always (unless timed out) |
| Map + draft findings | `nvidia/nemotron-3-super-120b-a12b` | always (unless timed out) |
| Vision | `nvidia/Nemotron-3.5-Super-VL` | 1–3 screenshots |
| Escalate | `nvidia/Nemotron-3-Ultra-550b-a55b` | Super confidence &lt; 0.55 or Super proposed BLOCK; skipped on spend/time cap |
| Fallback triage | `nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B` | Lightning unavailable |

Routing order is application code (Token Factory has no auto-router): **Lightning → Super → Super VL (optional) → Ultra (optional)**.

Display rates (`HACKATHON_DISPLAY_RATES`, USD / 1M tokens): Lightning/Nano $0.06 in / $0.24 out; Super / Super VL $0.30 / $0.06 cached / $0.90; Ultra $1.00 / $0.12 cached / $3.00. Per-run estimated cap `$0.12`. Daily live estimated cap `$8`. Fixtures and Replay do not count as Live spend.

## Tavily

After Lightning triage, MergeDesk calls **Tavily** (max 5 basic searches, optional extract) for `invented_surface` claims. A 0-hit is **not proof of absence**. Never send source code to Tavily.

## Fixtures vs Live vs Replay

| Badge | Meaning |
|---|---|
| **Live** | Public GitHub PR URL. Token Factory (and Tavily if keyed) actually ran. |
| **Fixture** | Built-in `fixture-ship` / `fixture-fix` / `fixture-block` with `NEBIUS_API_KEY` set and Token Factory HTTP succeeding. |
| **Replay** | Prebaked result. No key, or Token Factory HTTP failed on a fixture. Never a Live badge. |

`pnpm test` mocks Token Factory and Tavily. `pnpm smoke` is manual and hits real keys.

## GitHub Action

The composite Action at `.github/actions/mergedesk` posts one comment and a check named `MergeDesk (advisory)` with `conclusion: "neutral"`. **The Action is not a merge gate.** The workflow job always exits 0. Job success means “the Action ran,” not “the stamp is SHIP.” BLOCK cannot fail the job.

## Setup

```bash
cd MergeDesk
pnpm install
cp .env.example .env.local
```

Fill `.env.local`:

```
NEBIUS_API_KEY=
NEBIUS_BASE_URL=https://api.tokenfactory.nebius.com/v1/
TAVILY_API_KEY=
GITHUB_TOKEN=                     # optional; strongly recommended on the server
MERGEDESK_SPEND_CAP_USD=0.12
MERGEDESK_DAILY_SPEND_CAP_USD=8
MERGEDESK_TARBALL_MAX_MB=80
MERGEDESK_EXTRACT_MAX_MB=200
MERGEDESK_EXTRACT_MAX_FILES=8000
MERGEDESK_EXTRACT_TIMEOUT_SEC=30
```

Enable billing on Token Factory before live runs. The UI accepts **public repos only** (`repo_private` otherwise).

```bash
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

## Scripts

| Command | What it does |
|---|---|
| `pnpm dev` | Next.js dev server |
| `pnpm test` | Vitest (no real Token Factory) |
| `pnpm build` | Production build |
| `pnpm start` | Long-running Node (`next start`) after `pnpm build` |
| `pnpm smoke` | POST `fixture-block` with `wait: true`; prints `source` and `verdict.displayStamp`; requires `status === "done"`; exits 1 if Live/Fixture is claimed with no chat/ledger Token Factory usage (Replay is the honest badge then) |

Smoke expects the app at `MERGEDESK_URL` (default `http://localhost:3000`). Start `pnpm dev` or `pnpm start` first.

## Deploy

`POST /api/runs` and `GET /api/runs/[id]/events` set `export const maxDuration = 300`. Vercel Hobby max is 300s. If a live Ultra run cannot finish on Hobby, **fixtures still work**.

**Render fallback** (long-running Node when the platform cannot honor 300s):

```bash
cd MergeDesk
pnpm install
pnpm build
pnpm start
```

Set the same env as `.env.example`. Point `MERGEDESK_URL` at the public origin so the GitHub Action can POST `{ prUrl, wait: true }`.

## License

MIT. Copyright 2026 MergeDesk.
