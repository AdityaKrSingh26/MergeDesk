import { IMAGE_NOT_HEAD } from "@/server/shared";
import { approxTokens } from "./pack";
import { SYSTEM_PROMPT, wrapUntrusted } from "./promptGuard";
import { MODELS, resolveModelId } from "./models";
import { ultraWorstCaseUsd, usdEstimate } from "./pricing";
import type { ContextPack, Finding, TokenLine } from "@/server/shared";

const SUPER_MAX_PROMPT = 16_000;
const SUPER_RETRY_MAX_TOKENS = 4096;
const TRIAGE_MAX_PROMPT = 4_000;

const SECTION_KEYS = ["issue", "patch", "repoMap", "neighbors", "tavily"] as const;
const CLIP_ORDER = ["tavily", "neighbors", "repoMap", "patch", "issue"] as const;

const SUPER_JSON_HINT =
  'Respond with a JSON object: {"startHere":[{"path":"","symbol":"","why":""}],"concerns":[{"name":"","paths":[]}],"functions":[{"name":"","path":"","job":""}],"mermaid":"graph TD; ...","findings":[],"residualNotes":[],"proposedStamp":"SHIP"}';

const TRIAGE_JSON_HINT =
  'Respond with JSON {"claims":[{"type":"package","query":"","packageName":""}]}. type is package, api, or cve.';

const SUPER_VL_HINT =
  'Does this screenshot contradict the ticket or show failing CI? Respond with JSON {"contradicts":false,"quote":"","confidence":0}';

const ULTRA_MAX_PROMPT = 8_000;
const SUPER_VL_TEXT_CHARS = 4_000;

export interface SuperJson {
  startHere: Array<{ path: string; symbol: string; why: string }>;
  concerns: Array<{ name: string; paths: string[] }>;
  functions: Array<{ name: string; path: string; job: string }>;
  mermaid: string;
  findings: unknown[];
  residualNotes: string[];
  proposedStamp?: string;
}

export interface Claim {
  type: "package" | "api" | "cve";
  query: string;
  packageName?: string;
}

export interface ChatCompletionLike {
  choices?: Array<{ message?: { content?: string | null } | null } | null>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    prompt_tokens_details?: { cached_tokens?: number };
  };
}

export interface ExtraBody {
  reasoning_budget?: number;
  chat_template_kwargs: { enable_thinking: boolean };
}

export type ChatMessageContent =
  | string
  | Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }>;

export type ChatCreateBody = {
  model: string;
  messages: Array<{ role: "system" | "user"; content: ChatMessageContent }>;
  response_format?: { type: "json_object" };
  extra_body: ExtraBody;
  max_tokens?: number;
} & ExtraBody;

export interface ChatClient {
  chat: {
    completions: {
      create: (body: ChatCreateBody) => Promise<ChatCompletionLike>;
    };
  };
}

export type ParseModelJsonResult = { ok: true; value: SuperJson } | { ok: false };

export type SuperResult =
  | { ok: true; value: SuperJson; ledger: TokenLine[] }
  | { ok: false; ledger: TokenLine[] };

export type TriageResult =
  | { ok: true; claims: Claim[]; ledger: TokenLine[] }
  | { ok: false; ledger: TokenLine[] };

export interface SuperVlJson {
  contradicts: boolean;
  quote: string;
  confidence: number;
}

export type SuperVlResult =
  | { ok: true; value: SuperVlJson; ledger: TokenLine[] }
  | { ok: false; ledger: TokenLine[] };

export function shouldCallUltra(args: {
  findings: Array<{ confidence: number; kind?: string }>;
  proposedStamp?: string;
  usdSoFar: number;
  capUsd?: number;
  modelParseFailed?: boolean;
}): { call: boolean; reason?: string } {
  const cap = args.capUsd ?? Number(process.env.MERGEDESK_SPEND_CAP_USD ?? 0.12);
  if (args.usdSoFar + ultraWorstCaseUsd() > cap) {
    return { call: false, reason: "budget_capped" };
  }
  const needs =
    args.modelParseFailed === true ||
    args.proposedStamp === "BLOCK" ||
    args.findings.some((f) => f.confidence < 0.55);
  if (!needs) return { call: false, reason: "not_needed" };
  return { call: true };
}

export function findingFromSuperVl(payload: SuperVlJson, imageUrl?: string): Finding | undefined {
  if (!payload.contradicts || payload.confidence < 0.6) return undefined;
  const quote = payload.quote.startsWith(IMAGE_NOT_HEAD)
    ? payload.quote.slice(0, 240)
    : `${IMAGE_NOT_HEAD} ${payload.quote}`.slice(0, 240);
  return {
    id: "visual-0",
    kind: "visual_contradiction",
    severity: "medium",
    confidence: payload.confidence,
    title: "Screenshot contradiction",
    body: payload.quote,
    evidence: [
      {
        kind: "screenshot",
        quote,
        ...(imageUrl ? { url: imageUrl } : {}),
      },
    ],
    model: MODELS.superVl,
    cited: true,
  };
}

export function parseModelJson(text: string): ParseModelJsonResult {
  try {
    const parsed: unknown = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { ok: false };
    const rec = parsed as Record<string, unknown>;
    if (!Array.isArray(rec.startHere)) return { ok: false };
    if (!Array.isArray(rec.concerns)) return { ok: false };
    if (!Array.isArray(rec.functions)) return { ok: false };
    if (typeof rec.mermaid !== "string") return { ok: false };
    if (!Array.isArray(rec.findings)) return { ok: false };
    if (!Array.isArray(rec.residualNotes)) return { ok: false };
    return { ok: true, value: rec as SuperJson };
  } catch {
    return { ok: false };
  }
}

function parseClaims(text: string): { ok: true; claims: Claim[] } | { ok: false } {
  try {
    const parsed: unknown = JSON.parse(text);
    if (Array.isArray(parsed)) return { ok: true, claims: parsed as Claim[] };
    if (parsed && typeof parsed === "object" && Array.isArray((parsed as { claims?: unknown }).claims)) {
      return { ok: true, claims: (parsed as { claims: Claim[] }).claims };
    }
    return { ok: false };
  } catch {
    return { ok: false };
  }
}

function tokenLine(model: string, usage: ChatCompletionLike["usage"]): TokenLine {
  const promptTokens = usage?.prompt_tokens ?? 0;
  const completionTokens = usage?.completion_tokens ?? 0;
  const cachedTokens = usage?.prompt_tokens_details?.cached_tokens ?? 0;
  return {
    model,
    promptTokens,
    completionTokens,
    cachedTokens,
    usdEstimate: usdEstimate({ model, promptTokens, completionTokens, cachedTokens }),
    skipped: false,
  };
}

function userContent(pack: ContextPack, hint: string): string {
  const parts = [hint];
  for (const key of SECTION_KEYS) {
    const body = pack[key];
    if (body) parts.push(wrapUntrusted(key, body));
  }
  return parts.join("\n\n");
}

function buildMessages(pack: ContextPack, hint: string): Array<{ role: "system" | "user"; content: string }> {
  return [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: userContent(pack, hint) },
  ];
}

function measurePrompt(pack: ContextPack, hint: string): number {
  return approxTokens(buildMessages(pack, hint).map((m) => m.content).join(""));
}

function clonePack(pack: ContextPack): ContextPack {
  return {
    issue: pack.issue,
    patch: pack.patch,
    repoMap: pack.repoMap,
    neighbors: pack.neighbors,
    tavily: pack.tavily,
    truncated: pack.truncated,
    approxTokens: { ...pack.approxTokens },
  };
}

function recount(pack: ContextPack): void {
  pack.approxTokens = {
    issue: approxTokens(pack.issue),
    patch: approxTokens(pack.patch),
    repoMap: approxTokens(pack.repoMap),
    neighbors: approxTokens(pack.neighbors),
    tavily: approxTokens(pack.tavily),
  };
}

function clipPack(pack: ContextPack, maxTokens: number, hint: string): ContextPack {
  const out = clonePack(pack);
  for (let i = 0; i < 16; i++) {
    const used = measurePrompt(out, hint);
    if (used <= maxTokens) break;
    const key = CLIP_ORDER.find((k) => out[k].length > 0);
    if (!key) break;
    const overChars = (used - maxTokens) * 4;
    if (overChars >= out[key].length) out[key] = "";
    else out[key] = out[key].slice(0, out[key].length - overChars);
    out.truncated = true;
  }
  recount(out);
  return out;
}

function contentOf(resp: ChatCompletionLike): string {
  return resp.choices?.[0]?.message?.content ?? "";
}

function isUnavailable(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const rec = value as { status?: unknown; code?: unknown; message?: unknown };
  if (rec.status === 404 || rec.status === 503) return true;
  if (typeof rec.code === "string" && /unavailable|not_found/i.test(rec.code)) return true;
  if (typeof rec.message === "string" && /unavailable/i.test(rec.message)) return true;
  return false;
}

export async function runSuper(args: { pack: ContextPack; client: ChatClient }): Promise<SuperResult> {
  const clipped = clipPack(args.pack, SUPER_MAX_PROMPT, SUPER_JSON_HINT);
  const messages = buildMessages(clipped, SUPER_JSON_HINT);
  const ledger: TokenLine[] = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    const retry = attempt > 0;
    const extra_body: ExtraBody = retry
      ? { chat_template_kwargs: { enable_thinking: false } }
      : {
          reasoning_budget: 1024,
          chat_template_kwargs: { enable_thinking: true },
        };
    const resp = await args.client.chat.completions.create({
      model: MODELS.super,
      messages,
      response_format: { type: "json_object" },
      extra_body,
      ...extra_body,
      ...(retry ? { max_tokens: SUPER_RETRY_MAX_TOKENS } : {}),
    });
    ledger.push(tokenLine(MODELS.super, resp.usage));
    const parsed = parseModelJson(contentOf(resp));
    if (parsed.ok) return { ok: true, value: parsed.value, ledger };
  }
  return { ok: false, ledger };
}

export async function runTriage(args: {
  pack: ContextPack;
  client: ChatClient;
  liveList?: Array<{ id: string }>;
}): Promise<TriageResult> {
  const clipped = clipPack(args.pack, TRIAGE_MAX_PROMPT, TRIAGE_JSON_HINT);
  const messages = buildMessages(clipped, TRIAGE_JSON_HINT);
  const extra_body: ExtraBody = {
    chat_template_kwargs: { enable_thinking: false },
  };
  let model = resolveModelId(MODELS.lightning, args.liveList ?? []);
  const call = (id: string) =>
    args.client.chat.completions.create({
      model: id,
      messages,
      extra_body,
      ...extra_body,
    });
  let resp: ChatCompletionLike;
  try {
    resp = await call(model);
    if (model !== MODELS.nano && isUnavailable(resp)) {
      model = MODELS.nano;
      resp = await call(model);
    }
  } catch (err) {
    if (model === MODELS.nano || !isUnavailable(err)) throw err;
    model = MODELS.nano;
    resp = await call(model);
  }
  const ledger = [tokenLine(model, resp.usage)];
  const parsed = parseClaims(contentOf(resp));
  if (!parsed.ok) return { ok: false, ledger };
  return { ok: true, claims: parsed.claims, ledger };
}

function parseSuperVl(text: string): SuperVlJson | undefined {
  try {
    const parsed: unknown = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
    const rec = parsed as Record<string, unknown>;
    if (typeof rec.contradicts !== "boolean") return undefined;
    if (typeof rec.quote !== "string") return undefined;
    if (typeof rec.confidence !== "number") return undefined;
    return { contradicts: rec.contradicts, quote: rec.quote, confidence: rec.confidence };
  } catch {
    return undefined;
  }
}

export async function runSuperVl(args: {
  issue: string;
  imageUrls: string[];
  client: ChatClient;
}): Promise<SuperVlResult> {
  const extra_body: ExtraBody = {
    chat_template_kwargs: { enable_thinking: false },
  };
  const text = `${SUPER_VL_HINT}\n\n${wrapUntrusted("issue", args.issue.slice(0, SUPER_VL_TEXT_CHARS))}`;
  const content: ChatMessageContent = [
    { type: "text", text },
    ...args.imageUrls.map((url) => ({ type: "image_url" as const, image_url: { url } })),
  ];
  const resp = await args.client.chat.completions.create({
    model: MODELS.superVl,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content },
    ],
    response_format: { type: "json_object" },
    extra_body,
    ...extra_body,
  });
  const ledger = [tokenLine(MODELS.superVl, resp.usage)];
  const parsed = parseSuperVl(contentOf(resp));
  if (!parsed) return { ok: false, ledger };
  return { ok: true, value: parsed, ledger };
}

export async function runUltra(args: { pack: ContextPack; client: ChatClient }): Promise<SuperResult> {
  const clipped = clipPack(args.pack, ULTRA_MAX_PROMPT, SUPER_JSON_HINT);
  const messages = buildMessages(clipped, SUPER_JSON_HINT);
  const ledger: TokenLine[] = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    const retry = attempt > 0;
    const extra_body: ExtraBody = retry
      ? { chat_template_kwargs: { enable_thinking: false } }
      : {
          reasoning_budget: 2048,
          chat_template_kwargs: { enable_thinking: true },
        };
    const resp = await args.client.chat.completions.create({
      model: MODELS.ultra,
      messages,
      response_format: { type: "json_object" },
      extra_body,
      ...extra_body,
      ...(retry ? { max_tokens: SUPER_RETRY_MAX_TOKENS } : {}),
    });
    ledger.push(tokenLine(MODELS.ultra, resp.usage));
    const parsed = parseModelJson(contentOf(resp));
    if (parsed.ok) return { ok: true, value: parsed.value, ledger };
  }
  return { ok: false, ledger };
}
