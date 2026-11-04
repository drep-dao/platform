import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { encryptSecret, decryptSecret } from '../common/secret-cipher';
import { DEFAULT_REVIEW_FRAMEWORK, normaliseFramework, buildFindings, pctFromFindings, type ReviewFramework, type ReviewFinding } from './framework';
import { DEFAULT_VISION_FRAMEWORK, DEFAULT_VISION_REFERENCE, DEFAULT_VISION_SOURCE_URL } from './vision';

const KEY_SECRET = 'OPENAI_API_KEY';
const MODEL_CONFIG = 'AI_MODEL';
const PROVIDER_CONFIG = 'AI_PROVIDER';
const TEMPLATE_PROMPT_CONFIG = 'AI_TEMPLATE_PROMPT';   // template → coverage findings
const FRAMEWORK_PROMPT_CONFIG = 'AI_FRAMEWORK_PROMPT'; // Triangle Forces → framework findings
const VISION_PROMPT_CONFIG = 'AI_VISION_PROMPT';       // Cardano Vision 2030 → vision findings
const FRAMEWORK_CONFIG = 'AI_REVIEW_FRAMEWORK';        // the Triangle Forces question set
const VISION_FRAMEWORK_CONFIG = 'AI_VISION_FRAMEWORK'; // the Vision 2030 question set
const VISION_REFERENCE_CONFIG = 'AI_VISION_REFERENCE'; // the consolidated Vision 2030 digest
const VISION_SOURCE_URL_CONFIG = 'AI_VISION_SOURCE_URL';
const INTERVAL_CONFIG = 'SCORE_CHECK_INTERVAL_HOURS';
const LAST_CHECK_CONFIG = 'SCORE_CHECK_LAST_AT';
const WATERMARK_CONFIG = 'SCORE_CHECK_WATERMARK';
const AUTO_CHECK_CONFIG = 'SCORE_CHECK_ENABLED';
const BASE_URL_CONFIG = 'AI_BASE_URL';
const MAX_TOKENS_CONFIG = 'AI_MAX_TOKENS';
const TEMPERATURE_CONFIG = 'AI_TEMPERATURE';
const DEFAULT_MODEL = 'gpt-4o-mini';
const DEFAULT_MAX_TOKENS = 8000; // reasoning models spend part of this on reasoning; raise for those
const DEFAULT_TEMPERATURE = 0.2; // scoring wants consistency; low temperature = more deterministic
const DEFAULT_CHECK_INTERVAL_HOURS = 24;
const OPENAI_BASE = 'https://api.openai.com/v1';

/** Placeholders each prompt may reference, replaced with live data at score time. Required ones must
 *  appear in a board-edited prompt. Three dimensions, three prompts, each with its own placeholders. */
export const TEMPLATE_PLACEHOLDERS = ['#PROPOSAL', '#TEMPLATE_RULES', '#TEMPLATE_RUBRIC', '#EXTERNAL_LINKS', '#GITHUB_LINKS'] as const;
export const FRAMEWORK_PLACEHOLDERS = ['#PROPOSAL', '#FRAMEWORK_QUESTIONS', '#EXTERNAL_LINKS', '#GITHUB_LINKS'] as const;
export const VISION_PLACEHOLDERS = ['#PROPOSAL', '#VISION_REFERENCE', '#VISION_QUESTIONS', '#EXTERNAL_LINKS', '#GITHUB_LINKS'] as const;
const TEMPLATE_REQUIRED = ['#PROPOSAL', '#TEMPLATE_RUBRIC'] as const;
const FRAMEWORK_REQUIRED = ['#PROPOSAL', '#FRAMEWORK_QUESTIONS'] as const;
const VISION_REQUIRED = ['#PROPOSAL', '#VISION_QUESTIONS'] as const;

/** Shared calibration — the five outcomes and how strictly to apply them, used by all three prompts. */
const CALIBRATION = `CALIBRATION (read first). Judge how ADEQUATELY the proposal answers each item, as a critical, skeptical reviewer would.
 • You are NOT verifying external facts and must NOT down-rank a proposal for lacking independent verification you could not check — that is the DReps' job.
 • BUT you MUST judge whether the proposal's OWN answer is specific, substantive and convincing on its face. A topic merely appearing, or a generic/vague/thin statement, does not satisfy an item.
When an item asks for EVIDENCE, DATA or PROOF and the proposal gives only an unsourced claim or bare figure, it has NOT provided the evidence asked for — that is "Supported with condition" (name the missing source) at best, or "Unsupported" if central.

OUTCOMES — for EACH item choose exactly one label:
 - "Supported": clearly and specifically answered/advanced with concrete, relevant detail — including a source EXTERNAL to the proposal where evidence is called for. RARE: reserve it for items beyond reproach.
 - "Supported with condition": answered/advanced, but a concrete item is missing or thin (a source, an independent baseline, a signed agreement, a dated milestone, a named accountable party). The COMMON outcome for strong-but-imperfect answers.
 - "Unsupported": addressed, but vague, generic, thin, or does not make the case. USE for claims with no support.
 - "Unanswered": not addressed at all. USE for items the proposal simply skips.
 - "Not applicable": the item genuinely CANNOT apply to this proposal's nature, category or funding mechanism (give the reason). Excluded from the score, so use it RARELY. NEVER use it for an item the proposal simply fails to address or fails to meet — e.g. "no independent audit was conducted", "no data was given", "no clawback is defined". A requirement that SHOULD apply but is unmet is "Unanswered" (if skipped) or "Unsupported" (if addressed but inadequate), and MUST count against the score — it is NOT "Not applicable".
HARD RULE ON EVIDENCE: if an item asks for evidence, data, proof, an audit, an assurance, a signed agreement, a verifiable track record or publicly accessible results, and the proposal cites no source EXTERNAL to itself for it (i.e. evidenceCited would be "no"), the outcome CANNOT be "Supported" — it is "Supported with condition" at best, or "Unsupported"/"Unanswered" when the answer is thin or absent. Do not mark an item "Supported" while also setting "evidenceCited":"no" for an evidence-seeking item.
USE THE FULL RANGE: a review with NOTHING "Unsupported"/"Unanswered", or EVERYTHING "Supported", is almost certainly too lenient — re-examine the weakest items. A confident, well-written proposal is NOT the same as a fully-evidenced one; do not reward polish, and a 100% score is almost never warranted.
Set "evidenceCited": "yes" ONLY when the proposal points to a source external to itself for THIS answer (dataset, third-party report, audit, signed agreement, repo, on-chain data); its own assertion/restated figure is "no"; "na" if no external evidence is called for.
Write every "reason" as a REPORT of what the proposal provides, never an endorsement of its truth. Judge ONLY from the material above; never invent facts.`;

const JSON_INSTR = `Return STRICT JSON only, no prose:
{"findings": [ {"id": <item id>, "outcome": "<one outcome label>", "evidenceCited": "yes|no|na", "reason": "...", "risk": "...", "condition": "...", "evidence": ["exact short quote from the proposal", "another relevant quote", "..."]} ]}
"evidence" is an ARRAY of the exact passages (verbatim, short) from the proposal that support your outcome — include every relevant passage you found (give several when they exist, up to ~5 short ones); use [] if the proposal offers nothing.`;

/** 1/3 — Template coverage: how well the proposal satisfies the Council template requirements. */
export const DEFAULT_TEMPLATE_PROMPT = `You are an expert reviewer of Cardano Treasury Withdrawal governance action proposals. Assess ONLY how well the proposal satisfies the Council TEMPLATE requirements.

TEMPLATE — the Council's requirements (full text, for context):
#TEMPLATE_RULES

TEMPLATE REQUIREMENTS CHECKLIST — assess the proposal against EXACTLY these numbered requirements (do not invent, merge or drop any):
#TEMPLATE_RUBRIC

PROPOSAL — the on-chain governance action under review:
#PROPOSAL

SUPPORTING EXTERNAL DOCUMENTS (may be empty):
#EXTERNAL_LINKS

LINKED CODE REPOSITORIES (GitHub — may be empty):
#GITHUB_LINKS

${CALIBRATION}

Assess EVERY numbered requirement (by its id). Give a short reason, the risk to the Treasury if the gap remains, and all the exact passages/evidence used.
Template coverage measures how well each requirement is actually SATISFIED, not merely whether the topic appears. Most real proposals meet several requirements only partially — mark those "Supported with condition" (naming the missing item), and "Unsupported"/"Unanswered" where the requirement is addressed thinly or not at all. A 100% coverage score means every single requirement is fully and verifiably met; that is rare, so do not default to "Supported".

${JSON_INSTR}`;

/** 2/3 — Triangle Forces framework findings. */
export const DEFAULT_FRAMEWORK_PROMPT = `You are an expert reviewer of Cardano Treasury Withdrawal governance action proposals. Assess the proposal against the REVIEW FRAMEWORK below.

REVIEW FRAMEWORK — questions and outcome definitions:
#FRAMEWORK_QUESTIONS

PROPOSAL — the on-chain governance action under review:
#PROPOSAL

SUPPORTING EXTERNAL DOCUMENTS (may be empty):
#EXTERNAL_LINKS

LINKED CODE REPOSITORIES (GitHub — may be empty):
#GITHUB_LINKS

${CALIBRATION}

Assess EVERY framework question (by its id). Answer every part of a multi-part question (partial → "Supported with condition", name the missing part). For counterfactual / opportunity-cost questions require specific concrete reasoning; a circular answer ("without funding it may not be built") is inadequate. Scrutinise especially genuine demand / market validation, and continuity (who maintains and funds the result after Treasury funding ends). You may cite the template references you relied on in "templateRefs".

Return STRICT JSON only, no prose:
{"findings": [ {"id": <question id>, "outcome": "<one outcome label>", "evidenceCited": "yes|no|na", "reason": "...", "risk": "...", "condition": "...", "templateRefs": ["2A"], "evidence": ["exact short quote from the proposal", "another relevant quote", "..."]} ]}
"evidence" is an ARRAY of the exact passages (verbatim, short) from the proposal that support your outcome — include every relevant passage you found (give several when they exist, up to ~5 short ones); use [] if the proposal offers nothing.`;

/** 3/3 — Cardano Vision 2030 alignment. */
export const DEFAULT_VISION_PROMPT = `You are an expert reviewer of Cardano Treasury Withdrawal governance action proposals. Assess how well the proposal ALIGNS WITH the Cardano 2030 Strategy below — the source of truth for this dimension.

CARDANO 2030 STRATEGY (reference):
#VISION_REFERENCE

VISION ALIGNMENT QUESTIONS — assess the proposal against EACH (by its id):
#VISION_QUESTIONS

PROPOSAL — the on-chain governance action under review:
#PROPOSAL

SUPPORTING EXTERNAL DOCUMENTS (may be empty):
#EXTERNAL_LINKS

LINKED CODE REPOSITORIES (GitHub — may be empty):
#GITHUB_LINKS

${CALIBRATION}

Judge how well the proposal ADVANCES each priority, using the reference as the source of truth. Prefer a measurable link to a 2030 KPI over a generic aspiration; a confident claim with no mechanism or metric is "Unsupported" or "Supported with condition", not "Supported". A focused proposal will have several "Not applicable" — that is expected and MUST NOT be penalised. Give a short reason and all the exact passages/evidence used.

${JSON_INSTR}`;

/** A typed AI failure the controller maps to a clear, user-facing message. */
export class AiError extends Error {
  constructor(
    readonly code: 'no_key' | 'bad_key' | 'insufficient_quota' | 'rate_limited' | 'timeout' | 'bad_response' | 'model_not_found' | 'error',
    message: string,
  ) {
    super(message);
  }
}

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  constructor(private readonly prisma: PrismaService) {}

  // ── config (board-managed) ─────────────────────────────────────────────────
  private async apiKey(): Promise<string> {
    const row = await this.prisma.platformSecret.findUnique({ where: { key: KEY_SECRET } }).catch(() => null);
    return decryptSecret(row?.value)?.trim() || process.env.OPENAI_API_KEY?.trim() || '';
  }

  async model(): Promise<string> {
    const row = await this.prisma.platformConfig.findUnique({ where: { key: MODEL_CONFIG } }).catch(() => null);
    return typeof row?.value === 'string' && row.value.trim() ? row.value.trim() : DEFAULT_MODEL;
  }

  /** The three board-editable scoring prompts (each falls back to its default). */
  private async promptFor(key: string, dflt: string): Promise<string> {
    const row = await this.prisma.platformConfig.findUnique({ where: { key } }).catch(() => null);
    return typeof row?.value === 'string' && row.value.trim() ? row.value : dflt;
  }
  private async setPrompt(key: string, prompt: string, required: readonly string[], userId: string | null): Promise<void> {
    const p = (prompt ?? '').trim();
    for (const ph of required) if (!p.includes(ph)) throw new AiError('error', `The prompt must include the ${ph} placeholder.`);
    await this.prisma.platformConfig.upsert({ where: { key }, update: { value: p, updatedBy: userId }, create: { key, value: p, updatedBy: userId } });
  }
  async templatePrompt(): Promise<string> { return this.promptFor(TEMPLATE_PROMPT_CONFIG, DEFAULT_TEMPLATE_PROMPT); }
  async frameworkPrompt(): Promise<string> { return this.promptFor(FRAMEWORK_PROMPT_CONFIG, DEFAULT_FRAMEWORK_PROMPT); }
  async visionPrompt(): Promise<string> { return this.promptFor(VISION_PROMPT_CONFIG, DEFAULT_VISION_PROMPT); }
  async setTemplatePrompt(p: string, u: string | null): Promise<void> { return this.setPrompt(TEMPLATE_PROMPT_CONFIG, p, TEMPLATE_REQUIRED, u); }
  async setFrameworkPrompt(p: string, u: string | null): Promise<void> { return this.setPrompt(FRAMEWORK_PROMPT_CONFIG, p, FRAMEWORK_REQUIRED, u); }
  async setVisionPrompt(p: string, u: string | null): Promise<void> { return this.setPrompt(VISION_PROMPT_CONFIG, p, VISION_REQUIRED, u); }

  /** The board-editable Vision 2030 question set, reference digest, and source URL. */
  async visionFramework(): Promise<ReviewFramework> {
    const row = await this.prisma.platformConfig.findUnique({ where: { key: VISION_FRAMEWORK_CONFIG } }).catch(() => null);
    if (row && typeof row.value === 'object' && row.value) {
      try { return normaliseFramework(row.value); } catch { /* fall back */ }
    }
    return DEFAULT_VISION_FRAMEWORK;
  }
  async setVisionFramework(input: unknown, userId: string | null): Promise<void> {
    let fw: ReviewFramework;
    try { fw = normaliseFramework(input); } catch (e) { throw new AiError('error', e instanceof Error ? e.message : 'invalid vision question set'); }
    await this.prisma.platformConfig.upsert({ where: { key: VISION_FRAMEWORK_CONFIG }, update: { value: fw as unknown as object, updatedBy: userId }, create: { key: VISION_FRAMEWORK_CONFIG, value: fw as unknown as object, updatedBy: userId } });
  }
  async visionReference(): Promise<string> {
    const row = await this.prisma.platformConfig.findUnique({ where: { key: VISION_REFERENCE_CONFIG } }).catch(() => null);
    return typeof row?.value === 'string' && row.value.trim() ? row.value : DEFAULT_VISION_REFERENCE;
  }
  async setVisionReference(text: string, userId: string | null): Promise<void> {
    const t = (text ?? '').trim();
    await this.prisma.platformConfig.upsert({ where: { key: VISION_REFERENCE_CONFIG }, update: { value: t, updatedBy: userId }, create: { key: VISION_REFERENCE_CONFIG, value: t, updatedBy: userId } });
  }
  async visionSourceUrl(): Promise<string> {
    const row = await this.prisma.platformConfig.findUnique({ where: { key: VISION_SOURCE_URL_CONFIG } }).catch(() => null);
    return typeof row?.value === 'string' && row.value.trim() ? row.value : DEFAULT_VISION_SOURCE_URL;
  }
  async setVisionSourceUrl(url: string, userId: string | null): Promise<void> {
    const v = (url ?? '').trim();
    await this.prisma.platformConfig.upsert({ where: { key: VISION_SOURCE_URL_CONFIG }, update: { value: v, updatedBy: userId }, create: { key: VISION_SOURCE_URL_CONFIG, value: v, updatedBy: userId } });
  }

  /** The board-editable review framework (falls back to the Triangle Forces default). */
  async reviewFramework(): Promise<ReviewFramework> {
    const row = await this.prisma.platformConfig.findUnique({ where: { key: FRAMEWORK_CONFIG } }).catch(() => null);
    if (row && typeof row.value === 'object' && row.value) {
      try { return normaliseFramework(row.value); } catch { /* stored shape unusable — fall back */ }
    }
    return DEFAULT_REVIEW_FRAMEWORK;
  }

  async setReviewFramework(input: unknown, userId: string | null): Promise<void> {
    let fw: ReviewFramework;
    try { fw = normaliseFramework(input); } catch (e) { throw new AiError('error', e instanceof Error ? e.message : 'invalid framework'); }
    await this.prisma.platformConfig.upsert({
      where: { key: FRAMEWORK_CONFIG },
      update: { value: fw as unknown as object, updatedBy: userId },
      create: { key: FRAMEWORK_CONFIG, value: fw as unknown as object, updatedBy: userId },
    });
  }

  // ── auto-check schedule (how often to look for new Treasury Withdrawals) ────────
  /** Whether the background job may auto-score new Treasury Withdrawals. OFF by default — the board
   *  turns it on explicitly; "Run check now" works regardless. */
  async autoCheckEnabled(): Promise<boolean> {
    const row = await this.prisma.platformConfig.findUnique({ where: { key: AUTO_CHECK_CONFIG } }).catch(() => null);
    return row?.value === true || row?.value === 'true';
  }

  async setAutoCheckEnabled(on: boolean, userId: string | null): Promise<void> {
    await this.prisma.platformConfig.upsert({
      where: { key: AUTO_CHECK_CONFIG },
      update: { value: !!on, updatedBy: userId },
      create: { key: AUTO_CHECK_CONFIG, value: !!on, updatedBy: userId },
    });
  }

  async checkIntervalHours(): Promise<number> {
    const row = await this.prisma.platformConfig.findUnique({ where: { key: INTERVAL_CONFIG } }).catch(() => null);
    const n = typeof row?.value === 'number' ? row.value : typeof row?.value === 'string' ? Number(row.value) : NaN;
    return Number.isFinite(n) && n > 0 ? n : DEFAULT_CHECK_INTERVAL_HOURS;
  }

  async setCheckIntervalHours(hours: number, userId: string | null): Promise<void> {
    const h = Math.max(1, Math.min(24 * 30, Math.round(hours)));
    await this.prisma.platformConfig.upsert({
      where: { key: INTERVAL_CONFIG },
      update: { value: h, updatedBy: userId },
      create: { key: INTERVAL_CONFIG, value: h, updatedBy: userId },
    });
  }

  async lastCheckAt(): Promise<Date | null> {
    const row = await this.prisma.platformConfig.findUnique({ where: { key: LAST_CHECK_CONFIG } }).catch(() => null);
    const v = typeof row?.value === 'string' ? new Date(row.value) : null;
    return v && !Number.isNaN(v.getTime()) ? v : null;
  }

  async setLastCheckAt(at: Date, userId: string | null = null): Promise<void> {
    await this.prisma.platformConfig.upsert({
      where: { key: LAST_CHECK_CONFIG },
      update: { value: at.toISOString(), updatedBy: userId },
      create: { key: LAST_CHECK_CONFIG, value: at.toISOString(), updatedBy: userId },
    });
  }

  /** Baseline block_time: auto-scoring only touches Treasury Withdrawals NEWER than this, so it never
   *  scores retroactively. null = not set yet (first run records the current newest and scores nothing). */
  async scoreWatermark(): Promise<number | null> {
    const row = await this.prisma.platformConfig.findUnique({ where: { key: WATERMARK_CONFIG } }).catch(() => null);
    const n = typeof row?.value === 'number' ? row.value : typeof row?.value === 'string' ? Number(row.value) : NaN;
    return Number.isFinite(n) ? n : null;
  }

  async setScoreWatermark(blockTime: number, userId: string | null = null): Promise<void> {
    await this.prisma.platformConfig.upsert({
      where: { key: WATERMARK_CONFIG },
      update: { value: blockTime, updatedBy: userId },
      create: { key: WATERMARK_CONFIG, value: blockTime, updatedBy: userId },
    });
  }

  /** Masked view for the config UI — never returns the raw key. */
  async getConfig(): Promise<{
    provider: string; configured: boolean; hint: string | null; model: string;
    templatePrompt: string; defaultTemplatePrompt: string; templatePlaceholders: string[];
    frameworkPrompt: string; defaultFrameworkPrompt: string; frameworkPlaceholders: string[];
    visionPrompt: string; defaultVisionPrompt: string; visionPlaceholders: string[];
    framework: ReviewFramework; defaultFramework: ReviewFramework;
    vision: ReviewFramework; defaultVision: ReviewFramework;
    visionReference: string; defaultVisionReference: string; visionSourceUrl: string;
    checkIntervalHours: number; lastCheckAt: string | null; autoCheckEnabled: boolean; baseUrl: string; maxTokens: number; temperature: number;
  }> {
    const key = await this.apiKey();
    const providerRow = await this.prisma.platformConfig.findUnique({ where: { key: PROVIDER_CONFIG } }).catch(() => null);
    const lastAt = await this.lastCheckAt();
    return {
      provider: typeof providerRow?.value === 'string' && providerRow.value ? providerRow.value : 'openai',
      configured: !!key,
      hint: key ? `${key.slice(0, 3)}…${key.slice(-4)}` : null,
      model: await this.model(),
      baseUrl: await this.baseUrl(),
      maxTokens: await this.maxTokens(),
      temperature: await this.temperature(),
      templatePrompt: await this.templatePrompt(),
      defaultTemplatePrompt: DEFAULT_TEMPLATE_PROMPT,
      templatePlaceholders: [...TEMPLATE_PLACEHOLDERS],
      frameworkPrompt: await this.frameworkPrompt(),
      defaultFrameworkPrompt: DEFAULT_FRAMEWORK_PROMPT,
      frameworkPlaceholders: [...FRAMEWORK_PLACEHOLDERS],
      visionPrompt: await this.visionPrompt(),
      defaultVisionPrompt: DEFAULT_VISION_PROMPT,
      visionPlaceholders: [...VISION_PLACEHOLDERS],
      framework: await this.reviewFramework(),
      defaultFramework: DEFAULT_REVIEW_FRAMEWORK,
      vision: await this.visionFramework(),
      defaultVision: DEFAULT_VISION_FRAMEWORK,
      visionReference: await this.visionReference(),
      defaultVisionReference: DEFAULT_VISION_REFERENCE,
      visionSourceUrl: await this.visionSourceUrl(),
      checkIntervalHours: await this.checkIntervalHours(),
      lastCheckAt: lastAt ? lastAt.toISOString() : null,
      autoCheckEnabled: await this.autoCheckEnabled(),
    };
  }

  /** Set (or, with empty, clear) the API key. */
  async setKey(value: string, userId: string | null): Promise<void> {
    const v = (value ?? '').trim();
    if (!v) {
      await this.prisma.platformSecret.deleteMany({ where: { key: KEY_SECRET } });
      return;
    }
    await this.prisma.platformSecret.upsert({
      where: { key: KEY_SECRET },
      update: { value: encryptSecret(v), updatedBy: userId },
      create: { key: KEY_SECRET, value: encryptSecret(v), updatedBy: userId },
    });
  }

  async setModel(model: string, userId: string | null): Promise<void> {
    const m = (model ?? '').trim() || DEFAULT_MODEL;
    await this.prisma.platformConfig.upsert({
      where: { key: MODEL_CONFIG },
      update: { value: m, updatedBy: userId },
      create: { key: MODEL_CONFIG, value: m, updatedBy: userId },
    });
  }

  /** Chat-completions base URL — OpenAI by default, but can point at OpenRouter, Grok, a local
   *  Ollama/LM Studio, or any OpenAI-compatible endpoint. Trailing slash trimmed. */
  async baseUrl(): Promise<string> {
    const row = await this.prisma.platformConfig.findUnique({ where: { key: BASE_URL_CONFIG } }).catch(() => null);
    const v = typeof row?.value === 'string' ? row.value.trim().replace(/\/+$/, '') : '';
    return /^https?:\/\//i.test(v) ? v : OPENAI_BASE;
  }

  async setBaseUrl(url: string, userId: string | null): Promise<void> {
    const v = (url ?? '').trim().replace(/\/+$/, '');
    if (v && !/^https?:\/\//i.test(v)) throw new AiError('error', 'The API base URL must start with http:// or https://');
    if (!v) { await this.prisma.platformConfig.deleteMany({ where: { key: BASE_URL_CONFIG } }); return; } // empty resets to OpenAI
    await this.prisma.platformConfig.upsert({
      where: { key: BASE_URL_CONFIG },
      update: { value: v, updatedBy: userId },
      create: { key: BASE_URL_CONFIG, value: v, updatedBy: userId },
    });
  }

  /** Output token budget per scoring call. Reasoning models (gpt-5/o1) spend part of it on hidden
   *  reasoning, so raise it for those (the other-project equivalent uses 25000). */
  async maxTokens(): Promise<number> {
    const row = await this.prisma.platformConfig.findUnique({ where: { key: MAX_TOKENS_CONFIG } }).catch(() => null);
    const n = typeof row?.value === 'number' ? row.value : typeof row?.value === 'string' ? Number(row.value) : NaN;
    return Number.isFinite(n) && n > 0 ? n : DEFAULT_MAX_TOKENS;
  }

  async setMaxTokens(n: number, userId: string | null): Promise<void> {
    const v = Math.max(256, Math.min(200000, Math.round(n)));
    await this.prisma.platformConfig.upsert({
      where: { key: MAX_TOKENS_CONFIG },
      update: { value: v, updatedBy: userId },
      create: { key: MAX_TOKENS_CONFIG, value: v, updatedBy: userId },
    });
  }

  /** Sampling temperature (0–2). Low = consistent/deterministic (best for scoring); high = varied.
   *  Note: some reasoning models (gpt-5/o1) ignore it and only accept the default. */
  async temperature(): Promise<number> {
    const row = await this.prisma.platformConfig.findUnique({ where: { key: TEMPERATURE_CONFIG } }).catch(() => null);
    const n = typeof row?.value === 'number' ? row.value : typeof row?.value === 'string' ? Number(row.value) : NaN;
    return Number.isFinite(n) && n >= 0 && n <= 2 ? n : DEFAULT_TEMPERATURE;
  }

  async setTemperature(n: number, userId: string | null): Promise<void> {
    const v = Math.max(0, Math.min(2, n));
    await this.prisma.platformConfig.upsert({
      where: { key: TEMPERATURE_CONFIG },
      update: { value: v, updatedBy: userId },
      create: { key: TEMPERATURE_CONFIG, value: v, updatedBy: userId },
    });
  }

  // ── chat-completions calls (OpenAI-compatible) ───────────────────────────────
  private async chat(key: string, model: string, messages: { role: string; content: string }[], maxTokens: number, jsonMode: boolean): Promise<Record<string, unknown>> {
    const url = `${await this.baseUrl()}/chat/completions`;
    const temp = await this.temperature();
    const send = (modern: boolean): Promise<Response> => {
      // Newer models (gpt-5/o1…) reject `max_tokens` + a custom `temperature`; on retry use the
      // modern param and drop temperature so those models work too.
      const body: Record<string, unknown> = { model, messages, ...(jsonMode ? { response_format: { type: 'json_object' } } : {}) };
      if (modern) body.max_completion_tokens = maxTokens;
      else { body.max_tokens = maxTokens; body.temperature = temp; }
      return fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(90_000),
      });
    };

    let res: Response;
    try {
      res = await send(false);
      // Retry with the modern params when the provider rejects max_tokens / temperature.
      if (res.status === 400) {
        const peek = (await res.clone().text().catch(() => '')).toLowerCase();
        if (peek.includes('max_completion_tokens') || (peek.includes('unsupported') && (peek.includes('max_tokens') || peek.includes('temperature')))) {
          res = await send(true);
        }
      }
    } catch (e) {
      if (e instanceof Error && e.name === 'TimeoutError') throw new AiError('timeout', 'The AI request timed out — try again.');
      throw new AiError('error', `Could not reach the AI provider: ${e instanceof Error ? e.message : e}`);
    }
    if (res.ok) return (await res.json()) as Record<string, unknown>;
    // Map provider errors to clear causes.
    const bodyText = await res.text().catch(() => '');
    let err: { type?: string; code?: string; message?: string } = {};
    try { err = (JSON.parse(bodyText) as { error?: typeof err }).error ?? {}; } catch { /* non-JSON */ }
    const detail = err.message || bodyText.slice(0, 200) || res.statusText;
    if (res.status === 401) throw new AiError('bad_key', 'The API key was rejected (invalid or revoked). Check the key in the configuration.');
    if (res.status === 429 && (err.type === 'insufficient_quota' || err.code === 'insufficient_quota')) {
      throw new AiError('insufficient_quota', 'The AI account has no remaining credit/quota. Top up the provider account, then try again.');
    }
    if (res.status === 429) throw new AiError('rate_limited', 'The AI provider is rate-limiting right now — wait a moment and try again.');
    if (res.status === 404 && /model/i.test(detail)) throw new AiError('model_not_found', `The configured model is not available: ${detail}`);
    throw new AiError('error', `AI provider error (${res.status}): ${detail}`);
  }

  /** Validate the configured key with a minimal call — surfaces a bad key AND no-credit. */
  async testConnection(): Promise<{ ok: true; model: string }> {
    const key = await this.apiKey();
    if (!key) throw new AiError('no_key', 'No API key is configured.');
    const model = await this.model();
    try {
      await this.chat(key, model, [{ role: 'user', content: 'Reply with OK.' }], 32, false);
    } catch (e) {
      // A reasoning model (gpt-5/o1) can spend the tiny test budget on hidden reasoning and report
      // the output was cut off — that still proves the key, model and endpoint work, so pass the test.
      if (e instanceof AiError && /could not finish|output limit|reached|max_tokens|length/i.test(e.message)) return { ok: true, model };
      throw e;
    }
    return { ok: true, model };
  }

  /** Compile a template's free text into a FIXED numbered requirement checklist (rubric), once, so every
   *  proposal is scored against the same items. Returns [{id, item}]; throws AiError if no key / unreadable. */
  async compileRubric(templateText: string): Promise<{ id: number; code: string; item: string }[]> {
    const key = await this.apiKey();
    if (!key) throw new AiError('no_key', 'No API key is configured.');
    const model = await this.model();
    const prompt = `Extract the distinct, independently assessable requirements a Cardano Treasury Withdrawal proposal must satisfy from this TEMPLATE. Merge trivial sub-points into their parent; keep only real, top-level requirements. Return 10–25 items.

For EACH requirement also capture its "code" — the template's OWN section/requirement label such as "1A", "1B", "5A", "2.3" — exactly as the template writes it, so reviewers can match the finding to the template. If a requirement has no code in the template, use an empty string.

TEMPLATE:
${templateText}

Return STRICT JSON only: {"rubric": [{"code": "1A", "item": "<short requirement>"}]}`;
    const resp = await this.chat(key, model, [{ role: 'user', content: prompt }], await this.maxTokens(), true);
    const raw = this.firstMessage(resp);
    let parsed: { rubric?: unknown };
    try { parsed = JSON.parse(raw) as typeof parsed; } catch { parsed = {}; }
    const rows = Array.isArray(parsed.rubric) ? parsed.rubric : [];
    const out = rows
      .map((r) => ({ code: String((r as { code?: unknown })?.code ?? '').trim(), item: String((r as { item?: unknown })?.item ?? '').trim() }))
      .filter((r) => r.item)
      .slice(0, 30);
    if (!out.length) throw new AiError('bad_response', 'The AI did not return a template checklist that could be read.');
    return out.map((r, i) => ({ id: i + 1, code: r.code, item: r.item })); // numeric id for mapping + the template's code
  }

  /** Draft extra template-coverage requirement questions for a larger ask size, from the template text.
   *  A seed the board reviews + edits — NOT auto-applied. `existing` are already-configured questions to
   *  avoid repeating (e.g. Middle questions when generating Large). */
  async generateTierQuestions(templateText: string, tier: 'middle' | 'large', count: number, existing: string[] = []): Promise<string[]> {
    const key = await this.apiKey();
    if (!key) throw new AiError('no_key', 'No API key is configured.');
    const model = await this.model();
    const sizeWord = tier === 'large' ? 'a VERY LARGE' : 'a LARGE';
    const prompt = `A Cardano Treasury Withdrawal proposal requesting ${sizeWord} amount deserves stricter scrutiny than a small one. From this TEMPLATE, write ${count} ADDITIONAL, independently assessable requirement questions a reviewer should demand ONLY for ${tier}-size asks — on top of the base requirements. Focus on what bigger asks most need: independent assurance/audit, milestone gating + clawback, deeper risk analysis, team track record, treasury-exposure justification vs alternatives, continuity after funding.
Each question must DEMAND SPECIFIC, VERIFIABLE EVIDENCE a thin or generic answer cannot satisfy — name what must be present (a named auditor, a dated commitment, exact amounts, an EXTERNAL source, signed agreements, measurable criteria). Do NOT phrase them as "Has the proposal included…" or other yes/no checks a mere mention would pass; ask what specific, sourced commitment the proposal makes and how it can be independently checked. Each is a single, clear question.

Do NOT repeat any of these already-configured questions:
${existing.length ? existing.map((q) => `- ${q}`).join('\n') : '(none)'}

TEMPLATE:
${templateText}

Return STRICT JSON only: {"questions": ["<question>", ...]}`;
    const resp = await this.chat(key, model, [{ role: 'user', content: prompt }], await this.maxTokens(), true);
    const raw = this.firstMessage(resp);
    let parsed: { questions?: unknown };
    try { parsed = JSON.parse(raw) as typeof parsed; } catch { parsed = {}; }
    const rows = Array.isArray(parsed.questions) ? parsed.questions : [];
    const out = rows.map((q) => String(q ?? '').trim()).filter(Boolean).slice(0, count);
    if (!out.length) throw new AiError('bad_response', 'The AI did not return any questions that could be read.');
    return out;
  }

  /** Run a fully-rendered prompt against a question set (template rubric / framework / vision): returns
   *  one finding per question, the weighted % (Supported=1, with-condition=0.5, over non-NA), and the raw
   *  response so the board can inspect it. Shared by all three scoring dimensions. */
  async scoreAgainst(prompt: string, questionSet: ReviewFramework): Promise<{ pct: number; findings: ReviewFinding[]; raw: string; model: string }> {
    const key = await this.apiKey();
    if (!key) throw new AiError('no_key', 'No API key is configured.');
    const model = await this.model();
    const resp = await this.chat(key, model, [{ role: 'user', content: prompt }], await this.maxTokens(), true);
    const raw = this.firstMessage(resp);
    let parsed: { findings?: unknown };
    try { parsed = JSON.parse(raw) as typeof parsed; } catch { parsed = {}; }
    const findings = buildFindings(questionSet, parsed.findings);
    return { pct: pctFromFindings(findings), findings, raw, model };
  }

  private firstMessage(resp: Record<string, unknown>): string {
    const choices = resp.choices as { message?: { content?: string } }[] | undefined;
    return choices?.[0]?.message?.content ?? '';
  }
}
