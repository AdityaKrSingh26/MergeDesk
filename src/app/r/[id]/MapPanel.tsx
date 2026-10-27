"use client";

import {
  GRAPH_CAPTION,
  GRAPH_NO_EDGES,
  MULTIPLE_JOBS_NOTE,
  REGEX_PARSER_CAPTION,
  resolveNeighborhood,
} from "@/server/shared";
import type { ChangedFile, OrientationMap, Run } from "@/server/shared";
import { NeighborhoodCanvas } from "./NeighborhoodCanvas";

function fileDelta(file: ChangedFile): string {
  return `+${file.linesAdded} −${file.linesRemoved}`;
}

function selectedRowClass(selected: boolean): string {
  return selected ? "outline outline-1 outline-[var(--desk-forest)]" : "";
}

export function MapPanel({
  run,
  selectedPath,
  onSelectPath,
  findingPaths,
  startHerePaths,
}: {
  run: Run;
  selectedPath: string | null;
  onSelectPath: (path: string | null) => void;
  findingPaths: Set<string>;
  startHerePaths: string[];
}) {
  if (!run.map) {
    return (
      <section aria-labelledby="map-heading">
        <h2 id="map-heading" className="text-lg font-semibold">
          Orientation map
        </h2>
        <p className="mt-2 text-sm text-[var(--desk-muted)]">Map pending.</p>
      </section>
    );
  }

  const map = run.map;
  const languages = Object.entries(map.size.languages)
    .map(([lang, count]) => `${lang} ${count}`)
    .join(" · ");
  const startHere = map.startHere.filter((item) => item.path.trim().length > 0);
  const changedByPath = new Map((map.changedFiles ?? []).map((file) => [file.path, file]));
  const changedFiles = (map.changedFiles ?? []).filter((file) => file.path.trim().length > 0);
  const edgeless = resolveNeighborhood(map).edges.length === 0;

  return (
    <section aria-labelledby="map-heading" className="flex flex-col gap-5">
      <div>
        <h2 id="map-heading" className="text-lg font-semibold">
          Orientation map
        </h2>
      </div>

      <NeighborhoodCanvas
        key={run.id}
        runId={run.id}
        map={map}
        selectedPath={selectedPath}
        onSelectPath={onSelectPath}
        findingPaths={findingPaths}
        startHerePaths={startHerePaths}
      />
      <p className="text-sm text-[var(--desk-muted)]">{map.mermaidCaption || GRAPH_CAPTION}</p>
      {edgeless ? <p className="text-sm text-[var(--desk-muted)]">{GRAPH_NO_EDGES}</p> : null}
      {run.coverage.parser === "regex" ? (
        <p className="text-sm text-[var(--desk-muted)]">{REGEX_PARSER_CAPTION}</p>
      ) : null}

      <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-xs text-[var(--desk-muted)]">Added</dt>
          <dd className="font-mono">+{map.size.linesAdded}</dd>
        </div>
        <div>
          <dt className="text-xs text-[var(--desk-muted)]">Removed</dt>
          <dd className="font-mono">−{map.size.linesRemoved}</dd>
        </div>
        <div>
          <dt className="text-xs text-[var(--desk-muted)]">Files</dt>
          <dd className="font-mono">{map.size.fileCount}</dd>
        </div>
        <div>
          <dt className="text-xs text-[var(--desk-muted)]">Concerns</dt>
          <dd className="font-mono">{map.size.concernCount}</dd>
        </div>
      </dl>
      {languages ? <p className="font-mono text-xs text-[var(--desk-muted)]">{languages}</p> : null}

      {startHere.length > 0 ? (
        <div>
          <h3 className="text-sm font-semibold">Recommended reading order</h3>
          <ol aria-label="Recommended reading order" className="mt-2 flex flex-col gap-2">
            {startHere.map((item, index) => {
              const diff = changedByPath.get(item.path);
              return (
                <li
                  key={`${item.path}:${item.symbol}:${index}`}
                  className={`flex flex-wrap items-baseline gap-x-2 gap-y-0.5 px-2 py-1 text-sm leading-6 ${selectedRowClass(selectedPath === item.path)}`}
                >
                  <span className="font-mono text-xs text-[var(--desk-muted)]">{index + 1}</span>
                  <span className="font-mono text-xs">{item.path}</span>
                  <span className="font-medium">{item.symbol}</span>
                  <span className="text-[var(--desk-muted)]">{item.why}</span>
                  {diff ? (
                    <span className="ml-auto font-mono text-xs">{fileDelta(diff)}</span>
                  ) : null}
                </li>
              );
            })}
          </ol>
        </div>
      ) : null}

      {map.changedFiles && changedFiles.length > 0 ? (
        <div>
          <h3 className="text-sm font-semibold">Changed files</h3>
          <ul aria-label="Changed files" className="mt-2 flex flex-col gap-1">
            {changedFiles.map((file) => (
              <li
                key={file.path}
                className={`flex items-baseline justify-between gap-3 px-2 py-1 font-mono text-xs ${selectedRowClass(selectedPath === file.path)}`}
              >
                <span>{file.path}</span>
                <span>{fileDelta(file)}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {map.concerns.length > 0 ? (
        <ul className="flex flex-col gap-1 text-sm">
          {map.concerns.map((concern) => (
            <li key={concern.name}>
              <span className="font-medium">{concern.name}</span>
              <span className="ml-2 font-mono text-xs text-[var(--desk-muted)]">
                {concern.paths.join(", ")}
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      {map.functions.length > 0 ? (
        <ul className="flex flex-col gap-1 text-sm">
          {map.functions.map((fn) => (
            <li key={`${fn.path}:${fn.name}`}>
              <span className="font-medium">{fn.name}</span>
              <span className="mx-2 font-mono text-xs">{fn.path}</span>
              <span className="text-[var(--desk-muted)]">{fn.job}</span>
            </li>
          ))}
        </ul>
      ) : null}

      <BlastRadius blast={map.blastRadius} />
      {map.multipleJobs ? (
        <p className="text-sm font-medium text-[var(--desk-wax)]">{MULTIPLE_JOBS_NOTE}</p>
      ) : null}
    </section>
  );
}

function BlastRadius({ blast }: { blast: OrientationMap["blastRadius"] }) {
  const groups: Array<[string, string[]]> = [
    ["Neighbors not in diff", blast.neighborsNotInDiff],
    ["Tests added", blast.testsAdded],
    ["Tests missing", blast.testsMissing],
    ["Env keys", blast.envKeys],
  ];
  const visible = groups.filter(([, items]) => items.length > 0);
  if (visible.length === 0) return null;
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {visible.map(([label, items]) => (
        <div key={label}>
          <p className="text-xs font-medium tracking-[0.14em] text-[var(--desk-muted)] uppercase">
            {label}
          </p>
          <ul className="mt-1 font-mono text-xs">
            {items.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
