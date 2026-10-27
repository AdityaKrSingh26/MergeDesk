import { displayStamp } from "@/server/shared";
import type {
  Coverage,
  Finding,
  FindingKind,
  TokenLine,
  Verdict,
  VerdictStamp,
} from "@/server/shared";

const FINDING_KINDS: ReadonlySet<string> = new Set<FindingKind>([
  "scope_drift",
  "invented_surface",
  "looks_right_logic",
  "visual_contradiction",
  "secret",
]);

export interface GateInput {
  rawFindings: Array<Partial<Finding> & { kind?: string }>;
  coverage: Coverage;
  ledger: TokenLine[];
  residualNotes?: string[];
}

function isFindingKind(kind: string | undefined): kind is FindingKind {
  return kind !== undefined && FINDING_KINDS.has(kind);
}

export function gate(input: GateInput): Verdict {
  const findings: Finding[] = [];
  const seen = new Set<string>();

  for (let index = 0; index < input.rawFindings.length; index++) {
    const raw = input.rawFindings[index];
    if (!isFindingKind(raw.kind)) continue;
    const evidence = raw.evidence ?? [];
    if (evidence.length < 1) continue;
    if (raw.cited !== true) continue;
    if (raw.kind === "invented_surface") {
      if (input.coverage.tavily !== "ok") continue;
      if (!evidence.some((item) => item.kind === "tavily" && item.tavilyHits === 0)) continue;
    }

    const finding: Finding = {
      id: raw.id ?? `f-${index}`,
      kind: raw.kind,
      severity: raw.severity ?? "medium",
      confidence: raw.confidence ?? 0,
      title: raw.title ?? "",
      body: raw.body ?? "",
      evidence: evidence.map((item) => ({
        ...item,
        quote: item.quote.slice(0, 240),
      })),
      model: raw.model ?? "",
      cited: true,
    };
    const ev = finding.evidence[0];
    const key = `${finding.kind}|${finding.model}|${ev?.path ?? ""}|${ev?.startLine ?? ""}|${ev?.quote ?? finding.title}`;
    if (seen.has(key)) continue;
    seen.add(key);
    findings.push(finding);
  }

  let stamp: VerdictStamp = "SHIP";
  if (findings.some((f) => f.kind === "secret" && f.model === "regex")) stamp = "BLOCK";
  else if (findings.length > 0) stamp = "FIX";

  return {
    stamp,
    displayStamp: displayStamp(stamp),
    findings,
    residualNotes: stamp === "SHIP" ? [...(input.residualNotes ?? [])] : [],
    coverage: input.coverage,
    ledger: input.ledger,
    usdEstimateTotal: input.ledger.reduce((sum, line) => sum + line.usdEstimate, 0),
  };
}
