# MergeDesk

Orient a large pull request. See the files that matter, then a short list of cited exceptions. Stamps are **advisory**. Models never merge and never write patches. Public GitHub repos only.

Built for the Nebius x NVIDIA Global AI Hackathon (Coding and Agentic Engineering). Runtime models run on **Nebius Token Factory**. Package and API claims are checked with **Tavily**.

Open the app, paste a PR URL or click a fixture, and read the desk.

## Features

- **Public PR intake.** Paste a public GitHub pull request URL. MergeDesk fetches the issue, the diff, and a snapshot of the repo at the PR head.
- **Paste a diff.** Drop in an issue plus a unified diff, with up to three screenshots (png, jpg, or webp, 4MB each).
- **Known desks.** One click for **No cited exceptions**, **Cited exceptions**, or **High-certainty exception**. These are built-in fixtures so the demo works without a live PR.
- **Progress overlay.** A full-screen blotter follows Fetch, Snapshot, Graph, Pack, Triage, Tavily, Vision, and Gate until the map is ready.
- **Run header.** PR title, repo and number, a **View on GitHub** link, and a **Live** / **Fixture** / **Replay** badge.
- **Desk steps.** Horizontal Fetch through Gate, with a brass bar while the run is still going.
- **Neighborhood canvas.** A zoomable, pannable import and reference map. Pan empty space, wheel or + / − to zoom, Fit neighborhood to reset. Nodes do not drag.
- **Click to pin.** Click a file on the canvas. Findings cited for that path come forward. The rest dim. Click empty canvas to clear.
- **Reading order.** Recommended files to open first, with symbol, why, and per-file +/− when counts exist.
- **Changed files.** A list of paths in the diff with lines added and removed.
- **Map honesty.** Caption says this is an import / reference neighborhood, not a proven execution trace. Edgeless maps say so. Regex edges are labeled as a heuristic.
- **Coverage chips.** Snapshot, parser, files kept vs cap, hops, Tavily, vision, plus `budget_capped`, `timed_out`, `pack_truncated`, and `model_parse_failed` when they apply.
- **Advisory stamp.** Display labels only: **No cited exceptions**, **Cited exceptions**, **High-certainty exception**.
- **Finding tickets.** Kind, severity, title, body, file path, scan line, and a short quote. Secret, invented surface, scope drift, looks-right logic, and screenshot findings.
- **Tavily grounding.** Invented-surface claims get a search. Zero hits is labeled as not proof of absence. Source code is never sent to Tavily.
- **Estimate ledger.** Prompt, completion, and cached tokens per **Nemotron** SKU, plus an estimated USD total at hackathon display rates.
- **Local graph, small pack.** The import graph is built on the server. Models see a ranked pack, not the whole repo.
- **Token Factory routing.** Lightning triages, Super drafts findings, Super VL reads screenshots, Ultra escalates on low confidence or a proposed high-certainty exception. Lightning falls back to Nano if missing.
- **Spend caps.** About $0.12 estimated per live run and $8 estimated per day. Fixtures and Replay do not count as Live spend.
- **Replay fallback.** If Token Factory is down or the key is missing, the UI loads a prebaked result and the badge is **Replay**.

## Setup

```bash
pnpm install
cp .env.example .env.local
```

Fill `.env.local`:

```
NEBIUS_API_KEY=
NEBIUS_BASE_URL=https://api.tokenfactory.nebius.com/v1/
TAVILY_API_KEY=
GITHUB_TOKEN=
MERGEDESK_SPEND_CAP_USD=0.12
MERGEDESK_DAILY_SPEND_CAP_USD=8
MERGEDESK_TARBALL_MAX_MB=80
MERGEDESK_EXTRACT_MAX_MB=200
MERGEDESK_EXTRACT_MAX_FILES=8000
MERGEDESK_EXTRACT_TIMEOUT_SEC=30
```

Enable billing on Token Factory before live runs.

```bash
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

`GITHUB_TOKEN` is optional and recommended on the server so GitHub rate limits stay comfortable.

## Models

Chat Completions go to **Nebius Token Factory** (`https://api.tokenfactory.nebius.com/v1/`). The same weights on Hugging Face or OpenRouter do not count for this hackathon.

The in-app ledger is an estimate. Token Factory billing is the invoice.

| Step | Catalog id | When |
|---|---|---|
| Triage | `nvidia/Nemotron-3_5-Lightning` | Always, unless the run timed out |
| Map and draft findings | `nvidia/nemotron-3-super-120b-a12b` | Always, unless the run timed out |
| Vision | `nvidia/Nemotron-3.5-Super-VL` | 1 to 3 screenshots |
| Escalate | `nvidia/Nemotron-3-Ultra-550b-a55b` | Super confidence under 0.55, or Super proposed a high-certainty exception. Skipped on spend or time cap |
| Fallback triage | `nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B` | Lightning unavailable |

Order in app code: Lightning, then Super, then Super VL if needed, then Ultra if needed.

Display rates (`HACKATHON_DISPLAY_RATES`, USD per 1M tokens): Lightning and Nano $0.06 in / $0.24 out. Super and Super VL $0.30 / $0.06 cached / $0.90. Ultra $1.00 / $0.12 cached / $3.00.

## Live, Fixture, Replay

| Badge | Meaning |
|---|---|
| **Live** | A public GitHub PR URL. Token Factory ran (and Tavily if a key is set). |
| **Fixture** | A known desk (`fixture-ship`, `fixture-fix`, `fixture-block`) with `NEBIUS_API_KEY` set and Token Factory HTTP succeeding. |
| **Replay** | A prebaked result. Used when there is no key, or Token Factory HTTP failed on a fixture. |

`pnpm test` mocks Token Factory and Tavily. `pnpm smoke` hits real keys.

## Scripts

| Command | What it does |
|---|---|
| `pnpm dev` | Next.js dev server |
| `pnpm test` | Vitest (no real Token Factory) |
| `pnpm build` | Production build |
| `pnpm start` | `next start` after `pnpm build` |
| `pnpm smoke` | POST `fixture-block` with `wait: true` and print the badge and stamp |

Smoke talks to `MERGEDESK_URL` (default `http://localhost:3000`). Start the app first.

## Deploy

`POST /api/runs` and `GET /api/runs/[id]/events` set `maxDuration = 300`. That is the Vercel Hobby limit. If a live Ultra run cannot finish there, fixtures still work.

Long-running Node (Render or similar):

```bash
pnpm install
pnpm build
pnpm start
```

Use the same env as `.env.example`.

## License

MIT. Copyright 2026 MergeDesk.
