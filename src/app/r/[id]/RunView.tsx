"use client";

import { useEffect, useState } from "react";
import { SourceBadge } from "@/components/SourceBadge";
import { DESK_STEPS, evidencePinsNode, resolveNeighborhood } from "@/server/shared";
import type { ProgressStep, Run, Walkthrough } from "@/server/shared";
import { CoverageChips } from "./CoverageChips";
import { MapPanel } from "./MapPanel";
import { ReviewPanel } from "./ReviewPanel";
import { OVERLAY_MIN_MS, RunOverlay } from "./RunOverlay";
import { Stamp } from "./Stamp";
import { WalkthroughPanel } from "./WalkthroughPanel";

const STEPS: ProgressStep[] = DESK_STEPS;

function stepState(
  status: Run["status"],
  index: number,
  current: ProgressStep | null,
): "done" | "current" | "pending" | "error" {
  if (status === "done") return "done";
  if (status === "error") {
    const currentIndex = current ? STEPS.indexOf(current) : 0;
    const failIndex = currentIndex >= 0 ? currentIndex : 0;
    if (index < failIndex) return "done";
    if (index === failIndex) return "error";
    return "pending";
  }
  if (current) {
    const currentIndex = STEPS.indexOf(current);
    if (index < currentIndex) return "done";
    if (index === currentIndex) return "current";
    return "pending";
  }
  if (status === "running") return index === 0 ? "current" : "pending";
  return "pending";
}

function markRunning(status: Run["status"]): Run["status"] {
  return status === "done" || status === "error" ? status : "running";
}

export function RunView({ run }: { run: Run }) {
  const [live, setLive] = useState(run);
  const [runProp, setRunProp] = useState(run);
  const [details, setDetails] = useState<Partial<Record<ProgressStep, string>>>({});
  const [current, setCurrent] = useState<ProgressStep | null>(null);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const overlayNeeded = run.status !== "done" && !run.map;
  const [overlayRunId, setOverlayRunId] = useState(run.id);
  const [shownOverlay, setShownOverlay] = useState(overlayNeeded);
  const [minElapsed, setMinElapsed] = useState(!overlayNeeded);

  useEffect(() => {
    if (run.status === "done" || run.status === "error") return;
    const source = new EventSource(`/api/runs/${run.id}/events`);
    const on = (name: string, fn: (data: unknown) => void) => {
      source.addEventListener(name, (ev) => {
        const raw = (ev as MessageEvent).data;
        if (typeof raw !== "string") return;
        try {
          fn(JSON.parse(raw) as unknown);
        } catch {
          /* ignore malformed payloads */
        }
      });
    };
    on("step", (data) => {
      const rec = data as { name?: ProgressStep; detail?: string; headline?: Run["headline"] };
      if (!rec.name || !STEPS.includes(rec.name)) return;
      const name = rec.name;
      setDetails((prev) => ({ ...prev, [name]: rec.detail ?? "" }));
      setCurrent(name);
      setLive((prev) => ({
        ...prev,
        status: markRunning(prev.status),
        headline: rec.headline ?? prev.headline,
      }));
    });
    on("map", (data) => {
      const rec = data as { headline?: Run["headline"] };
      setLive((prev) => ({
        ...prev,
        map: data as Run["map"],
        status: markRunning(prev.status),
        headline: rec.headline ?? prev.headline,
      }));
      void fetch(`/api/runs/${run.id}`)
        .then((res) => (res.ok ? res.json() : null))
        .then((full: unknown) => {
          if (!full || typeof full !== "object") return;
          const next = full as Run;
          if (next.id !== run.id || !next.headline) return;
          setLive((prev) => ({ ...prev, headline: next.headline }));
        })
        .catch(() => undefined);
    });
    on("coverage", (data) => {
      setLive((prev) => ({ ...prev, coverage: data as Run["coverage"] }));
    });
    on("verdict", (data) => {
      const verdict = data as NonNullable<Run["verdict"]>;
      setLive((prev) => ({
        ...prev,
        verdict,
        ledger: verdict.ledger ?? prev.ledger,
        coverage: verdict.coverage ?? prev.coverage,
      }));
    });
    on("walkthrough", (data) => {
      setLive((prev) => ({
        ...prev,
        walkthrough: data as Walkthrough,
      }));
    });
    on("done", (data) => {
      const rec = data as { modelParseFailed?: boolean };
      setLive((prev) => ({
        ...prev,
        status: "done",
        modelParseFailed: rec.modelParseFailed === true,
      }));
      source.close();
    });
    on("error", (data) => {
      const error = data as { code?: string; message?: string };
      setLive((prev) => ({
        ...prev,
        status: "error",
        error: { code: error.code ?? "run_failed", message: error.message ?? "run failed" },
      }));
      source.close();
    });
    return () => source.close();
  }, [run.id, run.status]);

  useEffect(() => {
    if (live.status !== "done" || live.map) return;
    let cancelled = false;
    void fetch(`/api/runs/${run.id}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((full: unknown) => {
        if (cancelled || !full || typeof full !== "object") return;
        const next = full as Run;
        if (next.id !== run.id) return;
        setLive(next);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [live.status, live.map, run.id]);

  // 400ms floor is per run id so a fast map event cannot flash Layout A.
  useEffect(() => {
    if (run.status === "done" || run.map) return;
    const timer = window.setTimeout(() => setMinElapsed(true), OVERLAY_MIN_MS);
    return () => window.clearTimeout(timer);
  }, [run.id]); // eslint-disable-line react-hooks/exhaustive-deps -- map/status must not reset the floor

  if (run !== runProp) {
    setRunProp(run);
    setLive(run);
  }
  if (run.id !== overlayRunId) {
    setOverlayRunId(run.id);
    setShownOverlay(overlayNeeded);
    setMinElapsed(!overlayNeeded);
    setSelectedPath(null);
  }

  const showOverlay = live.status !== "done" && !live.map;
  if (showOverlay && !shownOverlay) setShownOverlay(true);
  const keepOverlay =
    showOverlay || (shownOverlay && !minElapsed && live.status !== "done");

  if (keepOverlay) {
    const step = current ?? "Fetch";
    return (
      <RunOverlay
        step={step}
        detail={details[step] ?? ""}
        index={STEPS.indexOf(step) + 1}
        total={STEPS.length}
        error={live.error?.message}
      />
    );
  }

  const stepIndex = STEPS.indexOf(current ?? "Fetch") + 1;
  const findingPaths = new Set<string>();
  if (live.map) {
    for (const node of resolveNeighborhood(live.map).nodes) {
      const hit = (live.verdict?.findings ?? []).some((finding) =>
        finding.evidence.some((item) => evidencePinsNode(item, node)),
      );
      if (hit) findingPaths.add(node.path);
    }
  }
  const startHerePaths = (live.map?.startHere ?? [])
    .map((item) => item.path)
    .filter((path) => path.trim().length > 0);

  return (
    <main className="mx-auto flex w-full max-w-[1440px] flex-1 flex-col gap-4 px-4 py-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">{live.headline?.title ?? "MergeDesk"}</h1>
          <p className="text-sm text-[var(--desk-muted)]">{live.headline?.subtitle}</p>
        </div>
        <div className="flex items-center gap-3">
          <SourceBadge source={live.source} />
          {live.headline?.githubUrl ? (
            <a href={live.headline.githubUrl} className="text-sm text-[var(--desk-brass)]">
              View on GitHub
            </a>
          ) : null}
        </div>
      </header>
      <ol aria-label="Desk steps" className="flex flex-wrap gap-3 text-sm">
        {STEPS.map((step, index) => {
          const state = stepState(live.status, index, current);
          const detail = details[step];
          return (
            <li key={step} className="flex items-center gap-2 text-sm">
              <span
                aria-hidden="true"
                className={
                  state === "done"
                    ? "h-2 w-2 bg-[var(--desk-forest)]"
                    : state === "current"
                      ? "h-2 w-2 bg-[var(--desk-brass)]"
                      : state === "error"
                        ? "h-2 w-2 bg-[var(--desk-wax)]"
                        : "h-2 w-2 border border-[var(--desk-rule)]"
                }
              />
              <span className={state === "pending" ? "text-[var(--desk-muted)]" : undefined}>
                {step}
              </span>
              {detail ? (
                <span className="font-mono text-xs text-[var(--desk-muted)]">{detail}</span>
              ) : null}
            </li>
          );
        })}
      </ol>
      {live.status === "running" ? (
        <div aria-hidden="true" className="h-[3px] bg-[var(--desk-rule)]">
          <div className="h-[3px] bg-[var(--desk-brass)]" style={{ width: `${(stepIndex / STEPS.length) * 100}%` }} />
        </div>
      ) : null}
      {live.error && live.map ? (
        <p role="alert" className="text-sm text-[var(--desk-wax)]">
          {live.error.message}
        </p>
      ) : null}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1.7fr)_minmax(280px,0.9fr)]">
        <div className="flex flex-col gap-6">
          <MapPanel
            run={live}
            selectedPath={selectedPath}
            onSelectPath={setSelectedPath}
            findingPaths={findingPaths}
            startHerePaths={startHerePaths}
          />
          <WalkthroughPanel run={live} onSelectPath={setSelectedPath} />
          <ReviewPanel run={live} onSelectPath={setSelectedPath} />
        </div>
        <div className="flex flex-col gap-6">
          <CoverageChips coverage={live.coverage} modelParseFailed={live.modelParseFailed} />
          <Stamp run={live} selectedPath={selectedPath} />
        </div>
      </div>
    </main>
  );
}
