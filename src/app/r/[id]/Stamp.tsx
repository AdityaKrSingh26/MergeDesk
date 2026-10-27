import {
  FINDING_KIND_LABEL,
  IMAGE_NOT_HEAD,
  LEDGER_LABEL,
  MODEL_PARSE_FAILED,
  STAMP_PENDING,
  evidencePinsNode,
  resolveNeighborhood,
  tavilyHitsLabel,
} from "@/server/shared";
import type {
  Evidence,
  Finding,
  FindingKind,
  Run,
  TokenLine,
  VerdictStamp,
} from "@/server/shared";

const STAMP_COLOR: Record<VerdictStamp, string> = {
  SHIP: "var(--desk-forest)",
  FIX: "var(--desk-brass)",
  BLOCK: "var(--desk-wax)",
};

const KIND_COLOR: Record<FindingKind, string> = {
  secret: "var(--desk-wax)",
  invented_surface: "var(--desk-brass)",
  scope_drift: "var(--desk-brass)",
  visual_contradiction: "var(--desk-brass)",
  looks_right_logic: "var(--desk-forest)",
};

const SEVERITY_COLOR: Record<Finding["severity"], string> = {
  high: "var(--desk-wax)",
  medium: "var(--desk-brass)",
};

function evidenceKey(evidence: Evidence): string {
  if (evidence.kind === "tavily") return tavilyHitsLabel(evidence.tavilyHits ?? 0);
  return evidence.quote;
}

function fileName(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash === -1 ? path : path.slice(slash + 1);
}

function hostname(url: string): string | undefined {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return undefined;
  }
}

function splitQuoteLines(quote: string): string[] {
  return quote
    .replace(/\r\n/g, "\n")
    .replace(/ \+/g, "\n+")
    .replace(/ -/g, "\n-")
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0);
}

function scanQuoteLines(quote: string): string[] {
  const lines = splitQuoteLines(quote);
  const minus = lines.find((line) => line.trimStart().startsWith("-"));
  const plus = lines.find((line) => line.trimStart().startsWith("+"));
  if (minus && plus) return [minus, plus];
  return lines.slice(0, 2);
}

function quoteTone(line: string): string {
  const trimmed = line.trimStart();
  if (trimmed.startsWith("+")) return "text-[var(--desk-forest)]";
  if (trimmed.startsWith("-")) return "text-[var(--desk-wax)]";
  return "text-[var(--desk-muted)]";
}

function EvidenceRow({ evidence }: { evidence: Evidence }) {
  if (evidence.kind === "tavily") {
    const host = evidence.url ? hostname(evidence.url) : undefined;
    return (
      <li className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-4 gap-y-0.5 px-4 py-2">
        <p className="min-w-0 truncate font-mono text-xs">{tavilyHitsLabel(evidence.tavilyHits ?? 0)}</p>
        {host ? (
          <p className="truncate font-mono text-[11px] text-[var(--desk-muted)]">{host}</p>
        ) : null}
      </li>
    );
  }

  if (evidence.kind === "screenshot") {
    return (
      <li className="px-4 py-2">
        <p className="text-[11px] leading-4 text-[var(--desk-muted)]">{IMAGE_NOT_HEAD}</p>
        <p className="mt-0.5 font-mono text-[11px] leading-4 text-[var(--desk-muted)] line-clamp-2">
          {evidence.quote}
        </p>
      </li>
    );
  }

  const path = evidence.path;
  const line = evidence.startLine;
  const lines = scanQuoteLines(evidence.quote);

  return (
    <li className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-4 gap-y-0.5 px-4 py-2 sm:grid-cols-[minmax(8rem,16rem)_auto_minmax(0,1fr)]">
      {path ? (
        <span className="min-w-0 truncate font-mono text-xs" title={path}>
          {fileName(path)}
        </span>
      ) : (
        <span className="text-[11px] text-[var(--desk-muted)]">citation</span>
      )}
      {line !== undefined ? (
        <span className="shrink-0 font-mono text-[10px] tracking-[0.12em] text-[var(--desk-brass)]">
          L{line}
        </span>
      ) : (
        <span />
      )}
      <p className="col-span-2 min-w-0 font-mono text-[11px] leading-4 sm:col-span-1" title={evidence.quote}>
        {lines.map((item, index) => (
          <span key={`${item}-${index}`} className={`block truncate ${quoteTone(item)}`}>
            {item}
          </span>
        ))}
      </p>
    </li>
  );
}

function neighborhoodNodeId(run: Run, path: string): string | undefined {
  if (!run.map) return undefined;
  return resolveNeighborhood(run.map).nodes.find((node) => node.path === path)?.id;
}

function findingMatchesPath(
  finding: Finding,
  path: string,
  nodeId: string | undefined,
): boolean {
  return finding.evidence.some((item) =>
    evidencePinsNode(item, { id: nodeId ?? "", path }),
  );
}

function partitionFindings(
  findings: Finding[],
  selectedPath: string | null,
  run: Run,
): { finding: Finding; pinned: boolean | undefined }[] {
  if (!selectedPath) {
    return findings.map((finding) => ({ finding, pinned: undefined }));
  }
  const nodeId = neighborhoodNodeId(run, selectedPath);
  const matched: Finding[] = [];
  const rest: Finding[] = [];
  for (const finding of findings) {
    if (findingMatchesPath(finding, selectedPath, nodeId)) matched.push(finding);
    else rest.push(finding);
  }
  return [
    ...matched.map((finding) => ({ finding, pinned: true })),
    ...rest.map((finding) => ({ finding, pinned: false })),
  ];
}

function FindingCard({
  finding,
  pinned,
}: {
  finding: Finding;
  pinned?: boolean;
}) {
  const accent = KIND_COLOR[finding.kind];
  const severityColor = SEVERITY_COLOR[finding.severity];
  const showBody =
    Boolean(finding.body) && !finding.evidence.some((item) => evidenceKey(item) === finding.body);
  const pinClass =
    pinned === true
      ? "outline outline-1 outline-[var(--desk-forest)]"
      : pinned === false
        ? "opacity-45"
        : "";

  return (
    <li
      className={`border border-[var(--desk-rule)] bg-[var(--desk-paper)] ${pinClass}`.trim()}
      style={{ borderLeftWidth: 3, borderLeftColor: accent }}
    >
      <div className="flex items-baseline justify-between gap-3 px-4 pt-3">
        <p
          className="text-[11px] font-semibold tracking-[0.16em] uppercase"
          style={{ color: accent }}
        >
          {FINDING_KIND_LABEL[finding.kind]}
        </p>
        <p
          className="px-1.5 py-0.5 text-[10px] font-semibold tracking-[0.14em] uppercase"
          style={{
            color: severityColor,
            background: `color-mix(in oklab, ${severityColor} 16%, transparent)`,
          }}
        >
          {finding.severity}
        </p>
      </div>
      <h3 className="px-4 mt-1.5 text-[15px] font-semibold leading-snug">{finding.title}</h3>
      {showBody ? (
        <p className="px-4 mt-1.5 text-sm leading-5 text-[var(--desk-muted)] line-clamp-2" title={finding.body}>
          {finding.body}
        </p>
      ) : null}
      <ul className="mt-3 divide-y divide-[var(--desk-rule)] border-t border-[var(--desk-rule)]">
        {finding.evidence.map((item, index) => (
          <EvidenceRow key={`${finding.id}-ev-${index}`} evidence={item} />
        ))}
      </ul>
    </li>
  );
}

function formatUsd(n: number): string {
  return `$${n.toFixed(4)}`;
}

function LedgerTable({ lines, total }: { lines: TokenLine[]; total: number }) {
  return (
    <table className="mt-6 w-full border-collapse text-left text-sm">
      <caption className="mb-2 caption-top text-left text-xs font-medium tracking-[0.16em] text-[var(--desk-muted)]">
        {LEDGER_LABEL}
      </caption>
      <thead>
        <tr className="border-b border-[var(--desk-rule)]">
          <th className="py-2 pr-3 font-medium">Model</th>
          <th className="py-2 pr-3 font-medium">Prompt</th>
          <th className="py-2 pr-3 font-medium">Completion</th>
          <th className="py-2 pr-3 font-medium">Cached</th>
          <th className="py-2 pr-3 font-medium">{LEDGER_LABEL}</th>
          <th className="py-2 font-medium">Notes</th>
        </tr>
      </thead>
      <tbody>
        {lines.length === 0 ? (
          <tr>
            <td className="py-2 text-[var(--desk-muted)]" colSpan={6}>
              No token lines.
            </td>
          </tr>
        ) : (
          lines.map((line, index) => (
            <tr key={`${line.model}-${index}`} className="border-b border-[var(--desk-rule)]">
              <td className="py-2 pr-3 font-mono text-xs">{line.model}</td>
              <td className="py-2 pr-3 font-mono text-xs">{line.promptTokens}</td>
              <td className="py-2 pr-3 font-mono text-xs">{line.completionTokens}</td>
              <td className="py-2 pr-3 font-mono text-xs">{line.cachedTokens}</td>
              <td className="py-2 pr-3 font-mono text-xs">{formatUsd(line.usdEstimate)}</td>
              <td className="py-2 text-xs text-[var(--desk-muted)]">
                {line.skipped ? (line.reason ?? "skipped") : ""}
              </td>
            </tr>
          ))
        )}
      </tbody>
      <tfoot>
        <tr>
          <td className="pt-2 font-medium" colSpan={4}>
            Total {LEDGER_LABEL.toLowerCase()}
          </td>
          <td className="pt-2 font-mono text-xs" colSpan={2}>
            {formatUsd(total)}
          </td>
        </tr>
      </tfoot>
    </table>
  );
}

export function Stamp({
  run,
  selectedPath,
}: {
  run: Run;
  selectedPath: string | null;
}) {
  const verdict = run.verdict;
  if (!verdict) {
    return (
      <section aria-labelledby="stamp-heading">
        <h2 id="stamp-heading" className="text-lg font-semibold">
          Stamp
        </h2>
        <p className="mt-2 text-sm text-[var(--desk-muted)]">{STAMP_PENDING}</p>
      </section>
    );
  }

  const color = STAMP_COLOR[verdict.stamp];
  const ledger = run.ledger.length > 0 ? run.ledger : verdict.ledger;

  return (
    <section aria-labelledby="stamp-heading">
      <h2 id="stamp-heading" className="sr-only">
        Stamp
      </h2>
      <p
        className="inline-block border-[3px] border-double px-4 py-3 text-lg font-semibold tracking-[0.08em]"
        style={{ color, borderColor: color }}
      >
        {verdict.displayStamp}
      </p>
      {run.modelParseFailed ? (
        <p className="mt-3 text-sm text-[var(--desk-muted)]">{MODEL_PARSE_FAILED}</p>
      ) : null}

      {selectedPath ? (
        <p className="mt-6 text-sm font-medium">
          Findings · pinned to {fileName(selectedPath)}
        </p>
      ) : null}

      {verdict.findings.length === 0 ? (
        <p className="mt-6 text-sm text-[var(--desk-muted)]">No cited exceptions in this run.</p>
      ) : (
        <ol className={`${selectedPath ? "mt-3" : "mt-6"} flex flex-col gap-3`}>
          {partitionFindings(verdict.findings, selectedPath, run).map(({ finding, pinned }) => (
            <FindingCard key={finding.id} finding={finding} pinned={pinned} />
          ))}
        </ol>
      )}

      {verdict.residualNotes.length > 0 ? (
        <ul className="mt-4 list-disc pl-5 text-sm text-[var(--desk-muted)]">
          {verdict.residualNotes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      ) : null}

      <LedgerTable lines={ledger} total={verdict.usdEstimateTotal} />
    </section>
  );
}
