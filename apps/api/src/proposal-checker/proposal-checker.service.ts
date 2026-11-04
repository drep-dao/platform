import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@drep-dao/db';
import { PrismaService } from '../prisma/prisma.service';
import { CardanoQueryService, type GovAction, type GovActionMeta } from '../cardano/cardano-query.service';
import { AiService, AiError } from './ai.service';
import { renderFramework, pctFromFindings, type ReviewFramework } from './framework';
import { extractText, parseDataUrl, MAX_EXTRACTED_CHARS } from './text-extract';
import { verifyCip30Signature } from '../auth/cip30';

/** Original file kept for download is capped so a row can't blow up (base64 ≈ 1.33×). */
const MAX_ORIGINAL_BYTES = 6 * 1024 * 1024;
const MAX_FETCH_BYTES = 30 * 1024 * 1024; // proposal reference PDFs can be large (image-heavy)
/** Per external document fed to the AI at score time (keeps the prompt bounded). */
const MAX_EXTRA_LINK_CHARS = 15_000;

// ── Public paid proposal-scan — config keys (platform_config) + defaults ────────
const PUBLIC_SCAN_ENABLED = 'PUBLIC_SCAN_ENABLED';
const PUBLIC_SCAN_FEE_ADA = 'PUBLIC_SCAN_FEE_ADA';
const PUBLIC_SCAN_ADDRESS = 'PUBLIC_SCAN_ADDRESS';
const DEFAULT_SCAN_FEE_ADA = 300;
// Mainnet Treasury script address the scan fee is paid to (set by Jaromír); used as the default when
// no address is stored and the deployment is on Mainnet. Preprod defaults to the active board multisig.
const MAINNET_SCAN_ADDRESS = 'addr1wxaw44fvmc9s3nu66gar4640va5pmv3u4l9g4lsqkscfejss0azpl';

// ── Ask-size tiers (template coverage only) ─────────────────────────────────────
// Larger Treasury withdrawals are scored against extra template requirements — NOT a worse score,
// a longer checklist. Cumulative: Large = base + Middle-extra + Large-extra. Boundaries inclusive:
// amount ≤ smallMax → Small (base only); smallMax < amount ≤ middleMax → Middle; else Large.
const TEMPLATE_TIERS = 'TEMPLATE_TIERS';
export type AskTier = 'small' | 'middle' | 'large';
export interface TierConfig {
  enabled: boolean;
  smallMax: number;  // ADA — top of Small (inclusive)
  middleMax: number; // ADA — top of Middle (inclusive); above this is Large
  names: { small: string; middle: string; large: string };
  middleQuestions: string[];
  largeQuestions: string[];
}
const DEFAULT_TIERS: TierConfig = {
  enabled: false, smallMax: 3_000_000, middleMax: 10_000_000,
  names: { small: 'Small', middle: 'Middle', large: 'Large' },
  middleQuestions: [], largeQuestions: [],
};

/** Lovelace → ADA with 2-decimal precision (for display of fee payments). */
const lovelaceToAda = (l: bigint): number => Math.round(Number(l) / 10_000) / 100;
/** A fee-payment ledger row as read from the DB (subset the scan view + verifier need). */
type ScanPaymentRow = { id: string; txHash: string; lovelace: bigint | null; sender: string | null; seenAt: Date | null };

/** Parse a GitHub repository URL → { owner, repo }, or null if it isn't one. */
function parseGithubRepo(raw: string): { owner: string; repo: string } | null {
  try {
    const u = new URL(raw);
    if (u.hostname.toLowerCase().replace(/^www\./, '') !== 'github.com') return null;
    const parts = u.pathname.split('/').filter(Boolean);
    if (parts.length < 2) return null;
    return { owner: parts[0], repo: parts[1].replace(/\.git$/, '') };
  } catch {
    return null;
  }
}

/** Rewrite a "human" document URL (Google Docs/Sheets/Slides, Drive file) to a direct
 *  export/download URL, so fetch gets the document text instead of a JavaScript app shell.
 *  Returns the original URL unchanged for everything else. */
function toFetchableUrl(raw: string): { url: string; googleExport: boolean } {
  try {
    const u = new URL(raw);
    const host = u.hostname.toLowerCase();
    // IPFS → a reliable gateway. ipfs:// isn't fetchable; ipfs.io/dweb.link frequently 429.
    if (u.protocol === 'ipfs:') {
      const cid = raw.replace(/^ipfs:\/\//i, '').replace(/^ipfs\//, '');
      return { url: `https://gateway.pinata.cloud/ipfs/${cid}`, googleExport: false };
    }
    const ipfsPath = /\/ipfs\/([^?#]+)/.exec(u.pathname);
    if (ipfsPath && /(^|\.)(ipfs\.io|dweb\.link|cloudflare-ipfs\.com)$/i.test(host)) {
      return { url: `https://gateway.pinata.cloud/ipfs/${ipfsPath[1]}`, googleExport: false };
    }
    if (host === 'docs.google.com') {
      const m = /^\/(document|spreadsheets|presentation)\/d\/([a-zA-Z0-9_-]+)/.exec(u.pathname);
      if (m) {
        const [, kind, id] = m;
        // Docs export as markdown (keeps headings/tables/bold); sheets as CSV; slides as plain text.
        const format = kind === 'spreadsheets' ? 'csv' : kind === 'document' ? 'markdown' : 'txt';
        return { url: `https://docs.google.com/${kind}/d/${id}/export?format=${format}`, googleExport: true };
      }
    }
    if (host === 'drive.google.com') {
      const m = /\/file\/d\/([a-zA-Z0-9_-]+)/.exec(u.pathname) ?? /[?&]id=([a-zA-Z0-9_-]+)/.exec(u.search);
      if (m) return { url: `https://drive.google.com/uc?export=download&id=${m[1]}`, googleExport: true };
    }
  } catch {
    /* fall through to raw */
  }
  return { url: raw, googleExport: false };
}

@Injectable()
export class ProposalCheckerService {
  // Resolved CIP-108 metadata by proposalId — anchors are immutable, so cache a SUCCESSFUL read for
  // the process lifetime (shared by title resolution + scoring, so a flaky anchor isn't re-fetched).
  private readonly metaCache = new Map<string, GovActionMeta>();
  // Short-lived gov-action list cache so parallel scores share one Koios read (Koios 429s/times out
  // under concurrent load, which showed up as "no actions found" / "governance action not found").
  private govList: { at: number; list: GovAction[] } | null = null;
  private govListRefreshing = false;
  // Fetched link/reference text, so a re-score doesn't re-download big proposal PDFs (1h TTL).
  private readonly linkCache = new Map<string, { at: number; val: { text: string; note?: string; mime: string } }>();
  constructor(
    private readonly prisma: PrismaService,
    private readonly cardano: CardanoQueryService,
    private readonly ai: AiService,
  ) {}

  // ── templates ───────────────────────────────────────────────────────────────
  /** Public list — never ships the (large) original file data; just enough to show + pick. */
  async listTemplates(includeInactive = false) {
    const rows = await this.prisma.proposalCheckTemplate.findMany({
      where: includeInactive ? {} : { active: true },
      orderBy: { createdAt: 'desc' },
      select: { id: true, title: true, source: true, sourceUrl: true, fileName: true, mimeType: true, active: true, createdAt: true },
    });
    return rows;
  }

  /** Full template incl. the extracted text (for display). The original file is a separate download. */
  async getTemplate(id: string) {
    const t = await this.prisma.proposalCheckTemplate.findUnique({
      where: { id },
      select: { id: true, title: true, source: true, sourceUrl: true, fileName: true, mimeType: true, extractedText: true, active: true, createdAt: true, fileDataUrl: true },
    });
    if (!t) throw new NotFoundException('template not found');
    const { fileDataUrl, ...rest } = t;
    return { ...rest, hasOriginal: !!fileDataUrl };
  }

  /** The original uploaded file as a data URL (for download), or null. */
  async getTemplateOriginal(id: string): Promise<{ fileName: string | null; mimeType: string | null; dataUrl: string } | null> {
    const t = await this.prisma.proposalCheckTemplate.findUnique({ where: { id }, select: { fileName: true, mimeType: true, fileDataUrl: true } });
    if (!t?.fileDataUrl) return null;
    return { fileName: t.fileName, mimeType: t.mimeType, dataUrl: t.fileDataUrl };
  }

  async createFromUpload(dto: { title: string; dataUrl: string; fileName?: string }, userId: string | null) {
    const parsed = parseDataUrl(dto.dataUrl);
    if (!parsed) throw new BadRequestException('invalid file data');
    if (parsed.buffer.length > MAX_ORIGINAL_BYTES) throw new BadRequestException(`file too large (max ${Math.round(MAX_ORIGINAL_BYTES / 1024 / 1024)} MB)`);
    const { text, note } = await extractText(parsed.buffer, parsed.mime, dto.fileName).catch((e) => {
      throw new BadRequestException(e instanceof Error ? e.message : 'could not read the file');
    });
    return this.prisma.proposalCheckTemplate.create({
      data: {
        title: (dto.title || dto.fileName || 'Template').trim().slice(0, 300),
        source: 'UPLOAD',
        fileName: dto.fileName?.slice(0, 300) ?? null,
        mimeType: parsed.mime,
        fileDataUrl: dto.dataUrl,
        extractedText: text + (note ? `\n\n[${note}]` : ''),
        createdBy: userId,
      },
      select: { id: true, title: true },
    });
  }

  /** Fetch a URL (rewriting Google/Drive links to their export endpoint) and extract its text.
   *  Throws Error with a user-facing message on any failure. Shared by template links + judge links. */
  private async fetchDocText(rawUrl: string): Promise<{ text: string; note?: string; mime: string }> {
    const url = (rawUrl || '').trim();
    // toFetchableUrl first so ipfs:// is rewritten to an https gateway before the scheme check.
    const { url: fetchUrl, googleExport } = toFetchableUrl(url);
    if (!/^https?:\/\//i.test(fetchUrl)) throw new Error('enter a valid http(s) link');
    const cached = this.linkCache.get(fetchUrl);
    if (cached && Date.now() - cached.at < 60 * 60_000) return cached.val; // 1h — avoids re-downloading big reference PDFs on re-score
    const res = await fetch(fetchUrl, { signal: AbortSignal.timeout(20_000), redirect: 'follow' }).catch((e) => {
      throw new Error(e instanceof Error ? e.message : String(e));
    });
    if (!res.ok) throw new Error(`the link returned ${res.status}`);
    const mime = res.headers.get('content-type')?.split(';')[0]?.trim() || 'text/html';
    // A Google export that comes back as an HTML page is a sign-in / permission wall, not the doc.
    if (googleExport && mime.includes('html')) {
      throw new Error(
        'this Google document is not publicly readable — in the document, Share → General access → "Anyone with the link" (Viewer), then paste the link again',
      );
    }
    const ab = await res.arrayBuffer();
    if (ab.byteLength > MAX_FETCH_BYTES) throw new Error('the linked document is too large');
    const { text, note } = await extractText(Buffer.from(ab), mime, url);
    const val = { text, note, mime };
    if (this.linkCache.size > 100) this.linkCache.clear();
    this.linkCache.set(fetchUrl, { at: Date.now(), val });
    return val;
  }

  async createFromLink(dto: { title?: string; url: string }, userId: string | null) {
    const url = (dto.url || '').trim();
    if (!/^https?:\/\//i.test(url)) throw new BadRequestException('enter a valid http(s) link');
    const { text, note, mime } = await this.fetchDocText(url).catch((e) => {
      throw new BadRequestException(`could not fetch the link: ${e instanceof Error ? e.message : e}`);
    });
    return this.prisma.proposalCheckTemplate.create({
      data: {
        title: (dto.title || text.slice(0, 60) || url).trim().slice(0, 300),
        source: 'LINK',
        sourceUrl: url,
        mimeType: mime,
        extractedText: text + (note ? `\n\n[${note}]` : ''),
        createdBy: userId,
      },
      select: { id: true, title: true },
    });
  }

  /** Use an existing internal Rule Document as a template — snapshots its markdown as the requirements. */
  async createFromRuleDoc(ruleDocId: string, title: string | undefined, userId: string | null) {
    const doc = await this.prisma.ruleDocument.findUnique({ where: { id: ruleDocId }, select: { id: true, title: true, contentMd: true } });
    if (!doc) throw new NotFoundException('rule document not found');
    const text = (doc.contentMd || '').trim();
    if (!text) throw new BadRequestException('this rule document has no content');
    return this.prisma.proposalCheckTemplate.create({
      data: {
        title: (title || doc.title || 'Rule document').trim().slice(0, 300),
        source: 'RULE_DOC',
        sourceUrl: `ruledoc:${doc.id}`,
        mimeType: 'text/markdown',
        extractedText: text.slice(0, MAX_EXTRACTED_CHARS),
        createdBy: userId,
      },
      select: { id: true, title: true },
    });
  }

  async setTemplateActive(id: string, active: boolean) {
    await this.prisma.proposalCheckTemplate.update({ where: { id }, data: { active } }).catch(() => {
      throw new NotFoundException('template not found');
    });
    return { id, active };
  }

  async deleteTemplate(id: string) {
    await this.prisma.proposalCheckTemplate.delete({ where: { id } }).catch(() => {
      throw new NotFoundException('template not found');
    });
    return { id, deleted: true };
  }

  // ── governance actions (on-chain) ─────────────────────────────────────────────
  /** The full gov-action list, cached briefly and retried once on an empty (transient Koios) read, so
   *  concurrent scoring doesn't hammer Koios and a momentary failure doesn't look like "no actions". */
  /** The Koios gov-action list is SLOW on a cold fetch (10–15s). Serve it stale-while-revalidate so a
   *  user never waits on it: return the last good list immediately and refresh in the background. Only
   *  the very first visitor (nothing cached yet, e.g. just after a restart) waits — and that wait is
   *  bounded. Callers that need it only for ordering/status still render fine with a slightly stale list. */
  private refreshGovList(): void {
    if (this.govListRefreshing) return;
    this.govListRefreshing = true;
    void (async () => {
      try {
        let list = await this.cardano.listGovActions(200);
        if (!list.length) { await new Promise((r) => setTimeout(r, 800)); list = await this.cardano.listGovActions(200); }
        if (list.length) this.govList = { at: Date.now(), list };
      } catch { /* keep the last good list */ }
      finally { this.govListRefreshing = false; }
    })();
  }
  private async actionsList(): Promise<GovAction[]> {
    const cached = this.govList;
    if (cached && Date.now() - cached.at < 60_000 && cached.list.length) return cached.list; // fresh
    this.refreshGovList(); // stale or empty → refresh in the background (non-blocking)
    if (cached?.list.length) return cached.list; // stale but usable — serve immediately
    // Cold start with nothing cached: wait briefly (bounded) so the first visitor isn't left empty.
    const deadline = Date.now() + 8_000;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 150));
      if (this.govList?.list.length) return this.govList.list;
    }
    return this.govList?.list ?? [];
  }

  /** List recent Treasury Withdrawal governance actions, newest first (other types excluded —
   *  the proposal checker only scores Treasury Withdrawals). No metadata fetch (kept fast). */
  async listGovActions(_limit = 60): Promise<GovAction[]> {
    return (await this.actionsList()).filter((a) => a.type === 'TreasuryWithdrawals');
  }

  /** One governance action + its resolved CIP-108 metadata (title/abstract/motivation/rationale). */
  async getGovAction(proposalId: string): Promise<{ action: GovAction; meta: GovActionMeta }> {
    const action = (await this.actionsList()).find((a) => a.proposalId === proposalId);
    if (!action) throw new NotFoundException('governance action not found');
    return { action, meta: await this.resolveMeta(proposalId, action.metaUrl) };
  }

  /** Resolve metadata for a proposal, reusing a previously-successful read (anchors are immutable).
   *  Only a successful read is cached, so a transient anchor failure is retried next time. */
  private async resolveMeta(proposalId: string, metaUrl: string | null): Promise<GovActionMeta> {
    const cached = this.metaCache.get(proposalId);
    if (cached) return cached;
    // Persistent cache first — anchors are immutable, so a stored copy is always valid and avoids an
    // IPFS fetch (which the shared gateways frequently 429 from the server's IP).
    try {
      const row = await this.prisma.govActionMeta.findUnique({ where: { proposalId } });
      if (row?.json) { const m = row.json as unknown as GovActionMeta; this.metaCache.set(proposalId, m); return m; }
    } catch { /* table/driver hiccup — fall through to a live fetch */ }
    const meta = await this.cardano.govActionMetadata(metaUrl);
    if (meta.available) {
      this.metaCache.set(proposalId, meta);
      try {
        await this.prisma.govActionMeta.upsert({
          where: { proposalId },
          update: { json: meta as unknown as Prisma.InputJsonValue, metaUrl, fetchedAt: new Date() },
          create: { proposalId, metaUrl, json: meta as unknown as Prisma.InputJsonValue },
        });
      } catch { /* best-effort persist */ }
    }
    return meta;
  }

  /** Resolve the CIP-108 title (+ on-chain status) for a batch of gov-action ids, so the Scores list
   *  can show which withdrawal is which. One list fetch, concurrency-limited anchor reads, cached. */
  async govActionTitles(ids: string[]): Promise<Record<string, { title: string | null; status: string }>> {
    const all = await this.actionsList();
    const byId = new Map(all.map((a) => [a.proposalId, a]));
    const want = [...new Set(ids)].slice(0, 80); // bound anchor fetches per call
    const out: Record<string, { title: string | null; status: string }> = {};
    const CONC = 8;
    for (let i = 0; i < want.length; i += CONC) {
      await Promise.all(
        want.slice(i, i + CONC).map(async (id) => {
          const a = byId.get(id);
          if (!a) { out[id] = { title: null, status: 'unknown' }; return; }
          let title: string | null = null;
          try { title = (await this.resolveMeta(id, a.metaUrl)).title ?? null; } catch { title = null; }
          out[id] = { title, status: a.status };
        }),
      );
    }
    return out;
  }

  // ── AI config ─────────────────────────────────────────────────────────────────
  getAiConfig() {
    return this.ai.getConfig();
  }
  async updateAiConfig(dto: { apiKey?: string; model?: string; baseUrl?: string; maxTokens?: number; temperature?: number; templatePrompt?: string; frameworkPrompt?: string; visionPrompt?: string; reviewFramework?: unknown; visionFramework?: unknown; visionReference?: string; visionSourceUrl?: string; checkIntervalHours?: number; autoCheckEnabled?: boolean }, userId: string | null) {
    if (dto.apiKey !== undefined) await this.ai.setKey(dto.apiKey, userId);
    if (dto.model !== undefined) await this.ai.setModel(dto.model, userId);
    if (dto.baseUrl !== undefined) await this.ai.setBaseUrl(dto.baseUrl, userId);
    if (dto.maxTokens !== undefined) await this.ai.setMaxTokens(dto.maxTokens, userId);
    if (dto.temperature !== undefined) await this.ai.setTemperature(dto.temperature, userId);
    if (dto.templatePrompt !== undefined) await this.ai.setTemplatePrompt(dto.templatePrompt, userId);
    if (dto.frameworkPrompt !== undefined) await this.ai.setFrameworkPrompt(dto.frameworkPrompt, userId);
    if (dto.visionPrompt !== undefined) await this.ai.setVisionPrompt(dto.visionPrompt, userId);
    if (dto.reviewFramework !== undefined) await this.ai.setReviewFramework(dto.reviewFramework, userId);
    if (dto.visionFramework !== undefined) await this.ai.setVisionFramework(dto.visionFramework, userId);
    if (dto.visionReference !== undefined) await this.ai.setVisionReference(dto.visionReference, userId);
    if (dto.visionSourceUrl !== undefined) await this.ai.setVisionSourceUrl(dto.visionSourceUrl, userId);
    if (dto.checkIntervalHours !== undefined) await this.ai.setCheckIntervalHours(dto.checkIntervalHours, userId);
    if (dto.autoCheckEnabled !== undefined) await this.ai.setAutoCheckEnabled(dto.autoCheckEnabled, userId);
    return this.ai.getConfig();
  }
  testAi() {
    return this.ai.testConnection();
  }

  /** Public read of the review framework (questions + outcomes) so anyone can see what's assessed. */
  reviewFramework(): Promise<ReviewFramework> {
    return this.ai.reviewFramework();
  }

  /** Public read of the Cardano Vision 2030 question set + reference digest + source URL. */
  async visionConfig(): Promise<{ framework: ReviewFramework; reference: string; sourceUrl: string }> {
    const [framework, reference, sourceUrl] = await Promise.all([this.ai.visionFramework(), this.ai.visionReference(), this.ai.visionSourceUrl()]);
    return { framework, reference, sourceUrl };
  }

  // ── Public paid proposal-scan — settings ──────────────────────────────────────
  private async pcGet<T>(key: string, dflt: T): Promise<T> {
    const row = await this.prisma.platformConfig.findUnique({ where: { key } }).catch(() => null);
    return row && row.value !== null && row.value !== undefined ? (row.value as unknown as T) : dflt;
  }
  private async pcSet(key: string, value: unknown, userId: string | null) {
    await this.prisma.platformConfig.upsert({ where: { key }, update: { value: value as Prisma.InputJsonValue, updatedBy: userId }, create: { key, value: value as Prisma.InputJsonValue, updatedBy: userId } });
  }
  /** The address the scan fee is paid to: the board's stored override, else the network default
   *  (mainnet = the fixed Treasury script address; preprod = the active board multisig address). */
  private async resolveScanAddress(stored: string, network: string): Promise<string> {
    if (stored && stored.trim()) return stored.trim();
    if (network === 'Mainnet') return MAINNET_SCAN_ADDRESS;
    const active = await this.prisma.multisigConfig.findFirst({ where: { replacedAt: null }, orderBy: { assembledAt: 'desc' }, select: { bech32Address: true } }).catch(() => null);
    return active?.bech32Address ?? '';
  }
  /** Board-only: the public-scan settings + the resolved receiving address + the network. */
  async publicScanConfig(): Promise<{ enabled: boolean; feeAda: number; address: string; resolvedAddress: string; network: string }> {
    const [enabled, feeAda, address] = await Promise.all([
      this.pcGet<boolean>(PUBLIC_SCAN_ENABLED, false),
      this.pcGet<number>(PUBLIC_SCAN_FEE_ADA, DEFAULT_SCAN_FEE_ADA),
      this.pcGet<string>(PUBLIC_SCAN_ADDRESS, ''),
    ]);
    const network = (process.env.CARDANO_NETWORK ?? 'Preprod').trim();
    const resolvedAddress = await this.resolveScanAddress(String(address || ''), network);
    return { enabled: !!enabled, feeAda: Number(feeAda) || DEFAULT_SCAN_FEE_ADA, address: String(address || ''), resolvedAddress, network };
  }
  async setPublicScanConfig(dto: { enabled?: boolean; feeAda?: number; address?: string }, userId: string | null) {
    if (dto.enabled !== undefined) await this.pcSet(PUBLIC_SCAN_ENABLED, !!dto.enabled, userId);
    if (dto.feeAda !== undefined) await this.pcSet(PUBLIC_SCAN_FEE_ADA, Math.max(1, Math.round(Number(dto.feeAda) || DEFAULT_SCAN_FEE_ADA)), userId);
    if (dto.address !== undefined) await this.pcSet(PUBLIC_SCAN_ADDRESS, (dto.address || '').trim(), userId);
    return this.publicScanConfig();
  }

  // ── Ask-size tiers (template coverage) ─────────────────────────────────────────
  /** Board read of the tier config, defaults filled in. */
  async templateTiersConfig(): Promise<TierConfig> {
    const c = await this.pcGet<Partial<TierConfig>>(TEMPLATE_TIERS, {});
    return {
      enabled: !!c?.enabled,
      smallMax: Number.isFinite(Number(c?.smallMax)) ? Number(c!.smallMax) : DEFAULT_TIERS.smallMax,
      middleMax: Number.isFinite(Number(c?.middleMax)) ? Number(c!.middleMax) : DEFAULT_TIERS.middleMax,
      names: { ...DEFAULT_TIERS.names, ...(c?.names ?? {}) },
      middleQuestions: Array.isArray(c?.middleQuestions) ? c!.middleQuestions!.map((q) => String(q)).filter(Boolean) : [],
      largeQuestions: Array.isArray(c?.largeQuestions) ? c!.largeQuestions!.map((q) => String(q)).filter(Boolean) : [],
    };
  }
  async setTemplateTiersConfig(dto: { enabled?: boolean; smallMax?: number; middleMax?: number; names?: { small?: string; middle?: string; large?: string }; middleQuestions?: string[]; largeQuestions?: string[] }, userId: string | null): Promise<TierConfig> {
    const cur = await this.templateTiersConfig();
    const clean = (arr: unknown): string[] | undefined => Array.isArray(arr) ? arr.map((q) => String(q ?? '').trim()).filter(Boolean).slice(0, 20) : undefined;
    const next: TierConfig = {
      enabled: dto.enabled !== undefined ? !!dto.enabled : cur.enabled,
      smallMax: dto.smallMax !== undefined ? Math.max(0, Math.round(Number(dto.smallMax) || 0)) : cur.smallMax,
      middleMax: dto.middleMax !== undefined ? Math.max(0, Math.round(Number(dto.middleMax) || 0)) : cur.middleMax,
      names: {
        small: (dto.names?.small ?? cur.names.small).trim() || 'Small',
        middle: (dto.names?.middle ?? cur.names.middle).trim() || 'Middle',
        large: (dto.names?.large ?? cur.names.large).trim() || 'Large',
      },
      middleQuestions: clean(dto.middleQuestions) ?? cur.middleQuestions,
      largeQuestions: clean(dto.largeQuestions) ?? cur.largeQuestions,
    };
    // Keep the boundaries sane: middleMax must not sit below smallMax.
    if (next.middleMax < next.smallMax) next.middleMax = next.smallMax;
    await this.pcSet(TEMPLATE_TIERS, next, userId);
    return next;
  }
  /** Draft extra questions for a tier from the active template; seed the board edits (not applied). */
  async generateTierQuestions(tier: 'middle' | 'large', count: number): Promise<string[]> {
    const template = await this.prisma.proposalCheckTemplate.findFirst({ where: { active: true }, orderBy: { createdAt: 'desc' }, select: { extractedText: true } });
    if (!template?.extractedText) throw new BadRequestException('No active template is configured.');
    const cur = await this.templateTiersConfig();
    const existing = [...cur.middleQuestions, ...(tier === 'large' ? cur.largeQuestions : [])];
    return this.ai.generateTierQuestions(template.extractedText, tier, Math.min(10, Math.max(1, count || 3)), existing);
  }
  /** Which tier an amount falls into (inclusive boundaries). No/invalid amount → Small (base only). */
  private tierFor(amountAda: number | Prisma.Decimal | null | undefined, cfg: TierConfig): AskTier {
    const a = Number(amountAda);
    if (!Number.isFinite(a)) return 'small';
    if (a <= cfg.smallMax) return 'small';
    if (a <= cfg.middleMax) return 'middle';
    return 'large';
  }

  // ── Public paid proposal-scan — the public flow ───────────────────────────────
  /** Public read for the landing box: whether the tool is on, the fee, where to pay, and the ask-size
   *  tiers (so the form can tell the user their requested amount is a decisive scoring factor). */
  async publicScanPublicConfig(): Promise<{ enabled: boolean; feeAda: number; address: string; network: string; tiers: { enabled: boolean; smallMax: number; middleMax: number; names: TierConfig['names'] } }> {
    const [c, tiers] = await Promise.all([this.publicScanConfig(), this.templateTiersConfig()]);
    return {
      enabled: c.enabled && !!c.resolvedAddress, feeAda: c.feeAda, address: c.resolvedAddress, network: c.network,
      tiers: { enabled: tiers.enabled, smallMax: tiers.smallMax, middleMax: tiers.middleMax, names: tiers.names },
    };
  }

  /** The #PROPOSAL text from pasted CIP-108 fields (mirrors govActionToText, minus the gov id/type lines). */
  private pastedProposalToText(p: { title: string; abstract: string; motivation: string; rationale: string; amountAda?: number | Prisma.Decimal | null }): string {
    const parts: string[] = [];
    if (p.title?.trim()) parts.push(`Title: ${p.title.trim()}`);
    if (p.amountAda != null) parts.push(`Requested amount: ${Number(p.amountAda).toLocaleString('en-US')} ₳`);
    if (p.abstract?.trim()) parts.push(`Abstract:\n${p.abstract.trim()}`);
    if (p.motivation?.trim()) parts.push(`Motivation:\n${p.motivation.trim()}`);
    if (p.rationale?.trim()) parts.push(`Rationale:\n${p.rationale.trim()}`);
    return parts.join('\n\n');
  }

  /** A view of a scan row. Public (board=false) hides the prompt/raw log; board sees everything. */
  private scanView(s: {
    id: string; walletStakeAddr: string; walletPaymentAddr: string | null; title: string; abstract: string; motivation: string;
    rationale: string; amountAda?: Prisma.Decimal | null; extraLinks: string[]; priceAda: bigint; toAddress: string; feeTxHash: string | null; feeSeenOnchainAt: Date | null;
    status: string; attempts: number; error: string | null; scorePct: number | null; templateFindings: unknown; questions: unknown;
    visionPct: number | null; visionFindings: unknown; model: string | null; prompt?: string | null; rawResponse?: string | null; createdAt: Date;
    version?: number; parentScanId?: string | null;
  }, board = false, payments: ScanPaymentRow[] = []) {
    const paidLovelace = payments.reduce((sum, p) => sum + (p.lovelace ?? 0n), 0n);
    return {
      id: s.id,
      walletStakeAddr: s.walletStakeAddr,
      walletPaymentAddr: s.walletPaymentAddr,
      title: s.title, abstract: s.abstract, motivation: s.motivation, rationale: s.rationale, extraLinks: s.extraLinks,
      amountAda: s.amountAda != null ? Number(s.amountAda) : null,
      feeAda: Number(s.priceAda / 1_000_000n),
      toAddress: s.toAddress,
      feeTxHash: s.feeTxHash,
      feeVerified: !!s.feeSeenOnchainAt,
      // Fee-payment ledger: the total confirmed so far, and each payment (so an underpayment/overpayment
      // is visible to the user and the board, and so several small txs can add up to the fee).
      paidAda: lovelaceToAda(paidLovelace),
      payments: payments
        .slice()
        .sort((a, b) => (a.seenAt?.getTime() ?? Infinity) - (b.seenAt?.getTime() ?? Infinity))
        .map((p) => ({ txHash: p.txHash, ada: p.lovelace != null ? lovelaceToAda(p.lovelace) : null, sender: p.sender, seen: !!p.seenAt })),
      status: s.status,
      attempts: s.attempts,
      error: s.error,
      scorePct: s.scorePct, templateFindings: s.templateFindings, questions: s.questions, visionPct: s.visionPct, visionFindings: s.visionFindings,
      model: s.model,
      version: s.version ?? 1,
      parentId: s.parentScanId ?? null,
      createdAt: s.createdAt,
      ...(board ? { prompt: s.prompt ?? null, response: s.rawResponse ?? null } : {}),
    };
  }
  async publicScanView(id: string) {
    const s = await this.prisma.publicScan.findUnique({ where: { id }, include: { payments: true } });
    if (!s) throw new NotFoundException('scan not found');
    return this.scanView(s, false, s.payments);
  }

  /** Create a pending-payment scan from pasted CIP-108 fields. Returns where + how much to pay. */
  async createPublicScan(dto: { walletStakeAddr: string; walletPaymentAddr?: string; title: string; abstract?: string; motivation?: string; rationale?: string; amountAda?: number; extraLinks?: string[] }) {
    const cfg = await this.publicScanConfig();
    if (!cfg.enabled) throw new BadRequestException('The public proposal-scan tool is not enabled.');
    if (!cfg.resolvedAddress) throw new BadRequestException('No receiving address is configured — ask the board.');
    const fields = { title: dto.title ?? '', abstract: dto.abstract ?? '', motivation: dto.motivation ?? '', rationale: dto.rationale ?? '', amountAda: dto.amountAda ?? null };
    if (!this.pastedProposalToText(fields).trim()) throw new BadRequestException('Enter a title and some proposal content.');
    const links = (dto.extraLinks ?? []).map((l) => (l || '').trim()).filter(Boolean).slice(0, 10);
    const row = await this.prisma.publicScan.create({
      data: {
        walletStakeAddr: (dto.walletStakeAddr || '').trim(),
        walletPaymentAddr: dto.walletPaymentAddr?.trim() || null,
        title: fields.title.trim(), abstract: fields.abstract.trim(), motivation: fields.motivation.trim(), rationale: fields.rationale.trim(),
        amountAda: fields.amountAda,
        extraLinks: links,
        priceAda: BigInt(cfg.feeAda) * 1_000_000n,
        toAddress: cfg.resolvedAddress,
        status: 'PENDING_PAYMENT',
      },
      select: { id: true },
    });
    return { id: row.id, toAddress: cfg.resolvedAddress, feeAda: cfg.feeAda, status: 'PENDING_PAYMENT' as const };
  }

  /** Add a payment tx to a scan, then try to verify. A scan can collect several payments that add up to
   *  the fee (e.g. two 200 ₳ txs → 400 ₳); one tx can fund only one scan (global unique tx hash). */
  async attachPublicScanTx(id: string, txHash: string) {
    const hash = (txHash || '').trim().toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(hash)) throw new BadRequestException('Enter a valid 64-character transaction hash.');
    const scan = await this.prisma.publicScan.findUnique({ where: { id }, select: { id: true, status: true } });
    if (!scan) throw new NotFoundException('scan not found');
    if (scan.status !== 'PENDING_PAYMENT') return this.publicScanView(id);
    const existing = await this.prisma.publicScanPayment.findUnique({ where: { txHash: hash }, select: { scanId: true } }).catch(() => null);
    if (existing && existing.scanId !== id) throw new BadRequestException('This transaction has already been used for another scan.');
    if (!existing) await this.prisma.publicScanPayment.create({ data: { scanId: id, txHash: hash } });
    await this.tryVerifyPublicScan(id);
    return this.publicScanView(id);
  }

  /** Edit the draft proposal text — allowed any time BEFORE the scan is spent (the engine reads the
   *  text only at run time, so a payment covers whatever the draft says when SCAN is pressed). Blocked
   *  once DONE (the result is tied to the scored text) or after the attempts are exhausted. */
  async editPublicScanDraft(id: string, dto: { title: string; abstract?: string; motivation?: string; rationale?: string; amountAda?: number; extraLinks?: string[] }) {
    const scan = await this.prisma.publicScan.findUnique({ where: { id }, select: { id: true, status: true } });
    if (!scan) throw new NotFoundException('scan not found');
    if (scan.status === 'DONE') throw new BadRequestException('This scan is complete — start a New scan to score a different draft.');
    if (scan.status === 'FAILED_CONTACT_ADMIN') throw new BadRequestException('This scan has failed twice — please contact the board.');
    const fields = { title: dto.title ?? '', abstract: dto.abstract ?? '', motivation: dto.motivation ?? '', rationale: dto.rationale ?? '', amountAda: dto.amountAda ?? null };
    if (!this.pastedProposalToText(fields).trim()) throw new BadRequestException('Enter a title and some proposal content.');
    const links = (dto.extraLinks ?? []).map((l) => (l || '').trim()).filter(Boolean).slice(0, 10);
    await this.prisma.publicScan.update({
      where: { id },
      data: { title: fields.title.trim(), abstract: fields.abstract.trim(), motivation: fields.motivation.trim(), rationale: fields.rationale.trim(), amountAda: fields.amountAda, extraLinks: links },
    });
    return this.publicScanView(id);
  }

  /** "Edit and Rescan": fork a scan into a NEW pending-payment version that copies its proposal content,
   *  keeps the original untouched, and links back to it (parentScanId). The user can then edit the copy,
   *  pay the fee again, and run it. A new fee is charged — one payment grants one scan. */
  async forkPublicScan(id: string) {
    const parent = await this.prisma.publicScan.findUnique({ where: { id }, select: { id: true, version: true, walletStakeAddr: true, walletPaymentAddr: true, title: true, abstract: true, motivation: true, rationale: true, amountAda: true, extraLinks: true } });
    if (!parent) throw new NotFoundException('scan not found');
    const cfg = await this.publicScanConfig();
    if (!cfg.enabled) throw new BadRequestException('The public proposal-scan tool is not enabled.');
    if (!cfg.resolvedAddress) throw new BadRequestException('No receiving address is configured — ask the board.');
    const row = await this.prisma.publicScan.create({
      data: {
        walletStakeAddr: parent.walletStakeAddr,
        walletPaymentAddr: parent.walletPaymentAddr,
        title: parent.title, abstract: parent.abstract, motivation: parent.motivation, rationale: parent.rationale,
        amountAda: parent.amountAda, extraLinks: parent.extraLinks,
        priceAda: BigInt(cfg.feeAda) * 1_000_000n,
        toAddress: cfg.resolvedAddress,
        status: 'PENDING_PAYMENT',
        parentScanId: parent.id,
        version: (parent.version ?? 1) + 1,
      },
      include: { payments: true },
    });
    return this.scanView(row, false, row.payments);
  }

  /** Resolve each not-yet-seen payment on-chain (record its amount + sender), then flip PENDING_PAYMENT
   *  → PAID once the confirmed total reaches the fee. Idempotent; used by the poller too. Returns true
   *  when the scan just became PAID. */
  async tryVerifyPublicScan(id: string): Promise<boolean> {
    const scan = await this.prisma.publicScan.findUnique({ where: { id }, select: { id: true, status: true, toAddress: true, priceAda: true, payments: true } });
    if (!scan || scan.status !== 'PENDING_PAYMENT') return false;
    for (const p of scan.payments) {
      if (p.seenAt) continue; // already resolved — amount is fixed
      // 0 threshold: we just want "is it on-chain yet, and how much did THIS tx pay to the fee address".
      const v = await this.cardano.verifyPayment(p.txHash, scan.toAddress, 0n);
      if (!v.found) continue; // not visible yet — the next tick retries
      let sender: string | null = null;
      try { sender = await this.cardano.txSenderAddress(p.txHash); } catch { /* best-effort */ }
      const seenAt = new Date();
      await this.prisma.publicScanPayment.update({ where: { id: p.id }, data: { lovelace: v.paidLovelace, sender, seenAt } });
      p.lovelace = v.paidLovelace; p.sender = sender; p.seenAt = seenAt; // keep the local sum current
    }
    const paid = scan.payments.reduce((sum, p) => sum + (p.lovelace ?? 0n), 0n);
    if (paid < scan.priceAda) return false;
    const sender = scan.payments.find((p) => p.sender)?.sender ?? null;
    await this.prisma.publicScan.update({ where: { id }, data: { status: 'PAID', feeSeenOnchainAt: new Date(), ...(sender ? { walletPaymentAddr: sender } : {}) } });
    return true;
  }
  /** On-demand re-check of a pending payment (the public "Check now" button + the client poller). */
  async recheckPublicScan(id: string) {
    await this.tryVerifyPublicScan(id);
    return this.publicScanView(id);
  }

  /** Run the scan. One payment grants up to 2 attempts: PAID/FAILED_RETRY → DONE, or FAILED_RETRY, then
   *  FAILED_CONTACT_ADMIN on the second failure. Never throws on a scan failure — returns the view so the
   *  user sees "try again" / "contact admin". */
  async runPublicScan(id: string) {
    const scan = await this.prisma.publicScan.findUnique({ where: { id } });
    if (!scan) throw new NotFoundException('scan not found');
    if (scan.status === 'DONE') return this.publicScanView(id);
    if (scan.status === 'PENDING_PAYMENT') throw new BadRequestException('Payment is not confirmed yet.');
    if (scan.status === 'FAILED_CONTACT_ADMIN') throw new BadRequestException('This scan has failed twice — please contact the board for a refund.');
    if (scan.status !== 'PAID' && scan.status !== 'FAILED_RETRY') throw new BadRequestException('This scan cannot be run.');
    const template = await this.prisma.proposalCheckTemplate.findFirst({ where: { active: true }, orderBy: { createdAt: 'desc' }, select: { id: true, extractedText: true, rubric: true } });
    if (!template) throw new BadRequestException('No active template is configured — ask the board.');
    try {
      const proposalText = this.pastedProposalToText(scan);
      const { tpl, fw, vis, combinedPrompt, combinedRaw } = await this.scoreContent({ templateId: template.id, template, proposalText, extraLinks: scan.extraLinks, refUris: [], amountAda: scan.amountAda });
      await this.prisma.publicScan.update({
        where: { id },
        data: {
          status: 'DONE',
          scorePct: tpl.pct, templateFindings: tpl.findings as unknown as Prisma.InputJsonValue,
          questions: fw.findings as unknown as Prisma.InputJsonValue,
          visionPct: vis.pct, visionFindings: vis.findings as unknown as Prisma.InputJsonValue,
          model: fw.model, prompt: combinedPrompt, rawResponse: combinedRaw, error: null,
        },
      });
    } catch (e) {
      const attempts = scan.attempts + 1;
      const status = attempts >= 2 ? 'FAILED_CONTACT_ADMIN' : 'FAILED_RETRY';
      const msg = e instanceof Error ? e.message : 'the scan failed';
      await this.prisma.publicScan.update({ where: { id }, data: { attempts, status, error: msg.slice(0, 500) } });
    }
    return this.publicScanView(id);
  }

  // ── board/admin views of the public scans ─────────────────────────────────────
  /** Board: EVERY public scan, newest first — wallet, status, score, how much was paid (incl. partial /
   *  over-payments), and each payment tx so the board can refund. refundCandidate = money came in but the
   *  scan isn't a clean paid-and-run case (over-paid, or paid while pending/abandoned/failed). */
  async listPublicScans() {
    const rows = await this.prisma.publicScan.findMany({ orderBy: { createdAt: 'desc' }, take: 500, include: { payments: true } });
    const toViews = rows.map((r) => {
      const view = this.scanView(r, true, r.payments);
      const refundCandidate = view.paidAda > 0 && (view.paidAda > view.feeAda || r.status === 'PENDING_PAYMENT' || r.status === 'FAILED_CONTACT_ADMIN');
      return { ...view, refundCandidate };
    });
    return {
      total: rows.length,
      paid: rows.filter((r) => !!r.feeSeenOnchainAt).length,
      pending: rows.filter((r) => r.status === 'PENDING_PAYMENT').length,
      done: rows.filter((r) => r.status === 'DONE').length,
      failedPaid: rows.filter((r) => !!r.feeSeenOnchainAt && r.status === 'FAILED_CONTACT_ADMIN').length,
      scans: toViews,
    };
  }
  /** Board: one scan with the full log + its payment ledger. */
  async publicScanBoardDetail(id: string) {
    const s = await this.prisma.publicScan.findUnique({ where: { id }, include: { payments: true } });
    if (!s) throw new NotFoundException('scan not found');
    return this.scanView(s, true, s.payments);
  }

  /** Poller: resolve pending-payment scans that have an unconfirmed payment (flip PENDING_PAYMENT → PAID
   *  once the confirmed total reaches the fee). */
  async pollPublicScanPayments(): Promise<number> {
    const rows = await this.prisma.publicScan.findMany({ where: { status: 'PENDING_PAYMENT', payments: { some: { seenAt: null } } }, orderBy: { createdAt: 'asc' }, take: 20, select: { id: true } });
    let paid = 0;
    for (const r of rows) {
      try { if (await this.tryVerifyPublicScan(r.id)) paid++; } catch { /* a wobble — next tick retries */ }
    }
    return paid;
  }

  /** The exact message a wallet must sign to prove it controls a stake address (for "my scans"). */
  scanOwnershipMessage(stakeAddress: string): string {
    return `Prove control of ${(stakeAddress || '').trim()} to view your DRep Council proposal scans.`;
  }
  /** Public: all scans for a wallet — gated by a CIP-30 signature proving the user controls the address,
   *  so a returning wallet (any device) sees its own history without exposing others' drafts. */
  async listMyPublicScans(stakeAddress: string, signature: string, key: string) {
    const addr = (stakeAddress || '').trim();
    if (!addr) throw new BadRequestException('Connect a wallet first.');
    if (!verifyCip30Signature(signature, key, this.scanOwnershipMessage(addr), addr)) {
      throw new BadRequestException('Could not verify wallet ownership.');
    }
    const rows = await this.prisma.publicScan.findMany({ where: { walletStakeAddr: addr }, orderBy: { createdAt: 'desc' }, take: 100, include: { payments: true } });
    return rows.map((r) => this.scanView(r, false, r.payments));
  }

  // ── score ─────────────────────────────────────────────────────────────────────
  /** Apply the board's prompt to one governance action: render placeholders with live data
   *  (proposal, template, external docs, GitHub repos), run the model, persist the % + the exact
   *  prompt and raw response (board-only log). */
  /** Shared scoring core for all three dimensions (template coverage / Triangle Forces / Vision 2030).
   *  Takes the already-resolved proposal TEXT — from an on-chain action OR a pasted draft — plus the
   *  template and any links, and runs the three scoreAgainst calls. Knows nothing about on-chain actions
   *  or persistence; the caller supplies proposalText + refUris and persists the returned result. */
  private async scoreContent(opts: {
    templateId: string;
    template: { extractedText: string; rubric: unknown };
    proposalText: string;
    extraLinks?: string[];
    refUris?: string[];
    amountAda?: number | Prisma.Decimal | null; // drives ask-size tiering of the template checklist
  }) {
    const { templateId, template } = opts;
    // B — score against a FIXED requirement checklist compiled once from the template, so every proposal
    // is judged against the same items (stable count, comparable coverage). Compiled lazily on first use.
    let rubric = Array.isArray(template.rubric) ? (template.rubric as { id: number; code?: string; item: string }[]) : null;
    // Recompile when there's no rubric OR the stored one predates requirement codes (so old rubrics
    // pick up the template's own labels like 1A/5A on the next score, no manual DB step needed).
    if (!rubric || !rubric.length || !rubric.some((r) => r.code)) {
      try {
        rubric = await this.ai.compileRubric(template.extractedText);
        await this.prisma.proposalCheckTemplate.update({ where: { id: templateId }, data: { rubric: rubric as unknown as Prisma.InputJsonValue } });
      } catch { rubric = null; /* fall back to free enumeration from #TEMPLATE_RULES */ }
    }
    // Ask-size tiering (template coverage only). Larger withdrawals are judged against EXTRA requirements,
    // cumulatively (Large = base + Middle-extra + Large-extra). This is not a worse score — it is a longer
    // checklist, so a big ask must cover more to reach the same %. Each extra carries a stable id (10001+
    // Middle, 20001+ Large) so findings map back and the tier is snapshotted into the stored result.
    const tiers = await this.templateTiersConfig();
    const tier = this.tierFor(opts.amountAda, tiers);
    const baseItems = (rubric ?? []).map((r) => ({ id: r.id, text: r.code ? `[${r.code}] ${r.item}` : r.item, tier: 'base' as const }));
    const extraItems: { id: number; text: string; tier: 'middle' | 'large' }[] = [];
    if (tiers.enabled && opts.amountAda != null && Number.isFinite(Number(opts.amountAda))) {
      if (tier === 'middle' || tier === 'large') tiers.middleQuestions.forEach((q, i) => extraItems.push({ id: 10001 + i, text: q, tier: 'middle' }));
      if (tier === 'large') tiers.largeQuestions.forEach((q, i) => extraItems.push({ id: 20001 + i, text: q, tier: 'large' }));
    }
    const allItems = [...baseItems, ...extraItems];
    const tierById = new Map<number, 'base' | 'middle' | 'large'>(allItems.map((q) => [q.id, q.tier]));
    const rubricBlock = baseItems.length || extraItems.length
      ? allItems.map((q) => `${q.id}. ${q.text}`).join('\n')
      : '(No pre-compiled checklist available — enumerate the distinct requirements from the TEMPLATE above yourself and score each.)';

    // The proposal's references (its full doc, work packages, PDF…) are part of the evidence — fetch
    // their CONTENT and score over it too. Combined with any board/user-supplied links. GitHub repos get
    // code/contributor metadata; the rest are read as documents. Best-effort — unreadable links are noted.
    const links = [...new Set([...(opts.extraLinks ?? []), ...(opts.refUris ?? [])].map((l) => (l || '').trim()).filter(Boolean))].slice(0, 10);
    const githubLinks = links.filter((l) => parseGithubRepo(l));
    const otherLinks = links.filter((l) => !parseGithubRepo(l));
    const externalBlock = await this.renderLinkBlock(otherLinks, async (url) => (await this.fetchDocText(url)).text.slice(0, MAX_EXTRA_LINK_CHARS));
    const githubBlock = await this.renderLinkBlock(githubLinks, (url) => this.fetchGithubInfo(url));

    const framework = await this.ai.reviewFramework();
    const vision = await this.ai.visionFramework();
    const values: Record<string, string> = {
      '#TEMPLATE_RULES': template.extractedText,
      '#TEMPLATE_RUBRIC': rubricBlock,
      '#PROPOSAL': opts.proposalText,
      '#FRAMEWORK_QUESTIONS': renderFramework(framework),
      '#VISION_REFERENCE': await this.ai.visionReference(),
      '#VISION_QUESTIONS': renderFramework(vision),
      '#EXTERNAL_LINKS': externalBlock || '(none provided)',
      '#GITHUB_LINKS': githubBlock || '(none provided)',
    };
    // Order matters: longer tokens (TEMPLATE_RUBRIC, VISION_*) before TEMPLATE_RULES so the right one wins.
    const render = (prompt: string) => prompt.replace(/#(?:PROPOSAL|TEMPLATE_RUBRIC|TEMPLATE_RULES|FRAMEWORK_QUESTIONS|VISION_REFERENCE|VISION_QUESTIONS|EXTERNAL_LINKS|GITHUB_LINKS)\b/g, (m: string) => values[m] ?? m);

    // The template is scored as its own question set (one question per rubric requirement), sharing
    // the framework's five outcomes so all three dimensions read the same way.
    const templateQS: ReviewFramework = {
      title: 'Template coverage', guidance: '', outcomes: framework.outcomes,
      areas: [{ key: 'requirements', title: 'Template requirements', questions: allItems.map((q) => ({ id: q.id, text: q.text })) }],
    };

    // Three dimensions, three prompts, three calls. Each → { pct, findings, raw }.
    const templateRendered = render(await this.ai.templatePrompt());
    const frameworkRendered = render(await this.ai.frameworkPrompt());
    const visionRendered = render(await this.ai.visionPrompt());
    const tpl = await this.ai.scoreAgainst(templateRendered, templateQS);
    const fw = await this.ai.scoreAgainst(frameworkRendered, framework);
    const vis = await this.ai.scoreAgainst(visionRendered, vision);

    // Tag each template finding with its tier so the UI can colour Base/Middle/Large and the tier is
    // snapshotted into the stored result (history survives later config edits).
    tpl.findings = tpl.findings.map((f) => ({ ...f, tier: tierById.get(f.id) ?? 'base' }));
    // Deterministic backstop for the evidence hard-rule the model does not reliably obey on polished
    // proposals (it marks evidence-seeking template requirements "Supported" while citing no external
    // source — e.g. PFMS: 25/25 Supported, all evidenceCited=no). An evidence-seeking requirement
    // (by its own wording) marked "Supported" without an EXTERNAL source is capped at "Supported with
    // condition", so a 100% coverage score is impossible without real evidence. Structural items (budget,
    // milestones, team) carry no evidence word and are untouched; items that DO cite evidence keep theirs.
    tpl.findings = tpl.findings.map((f) => {
      const asksEvidence = /\b(evidence|data source|dataset|proof|audit|assurance|verifiable|verified|independent(?:ly)?|baseline|citation|benchmark|track record|publicly accessible)\b/i.test(f.question || '');
      const isSupported = (f.outcome || '').trim().toLowerCase() === 'supported';
      const hasExternal = (f.evidenceCited || '').toLowerCase() === 'yes';
      if (asksEvidence && isSupported && !hasExternal) {
        return { ...f, outcome: 'Supported with condition', condition: f.condition || 'No source external to the proposal is cited for this evidence-seeking requirement.' };
      }
      return f;
    });
    tpl.pct = pctFromFindings(tpl.findings); // recompute after the backstop may have re-weighted items

    const combinedPrompt = `=== TEMPLATE PROMPT ===\n${templateRendered}\n\n=== FRAMEWORK PROMPT ===\n${frameworkRendered}\n\n=== VISION 2030 PROMPT ===\n${visionRendered}`;
    const combinedRaw = `=== TEMPLATE RESPONSE ===\n${tpl.raw}\n\n=== FRAMEWORK RESPONSE ===\n${fw.raw}\n\n=== VISION 2030 RESPONSE ===\n${vis.raw}`;
    return { tpl, fw, vis, combinedPrompt, combinedRaw, model: fw.model, tier };
  }

  async score(templateId: string, govActionId: string, userId: string | null, extraLinks: string[] = []) {
    const template = await this.prisma.proposalCheckTemplate.findUnique({ where: { id: templateId }, select: { extractedText: true, rubric: true } });
    if (!template) throw new NotFoundException('template not found');
    const { action, meta } = await this.getGovAction(govActionId);
    const proposalText = this.govActionToText(action, meta);
    if (!proposalText.trim() || (!meta.available && !meta.raw)) {
      throw new BadRequestException("couldn't load this governance action's metadata (the anchor may be offline) — try another action");
    }
    const refUris = (meta.references ?? []).map((r) => r.uri).filter((u): u is string => !!u && /^(https?|ipfs):/i.test(u));
    const { tpl, fw, vis, combinedPrompt, combinedRaw } = await this.scoreContent({ templateId, template, proposalText, extraLinks, refUris, amountAda: action.withdrawalAda });

    const saved = await this.prisma.proposalCheckResult.create({
      data: {
        templateId,
        govActionId: action.proposalId,
        govActionTitle: meta.title ?? null,
        govActionType: action.type,
        amountAda: action.withdrawalAda ?? null,                              // snapshot of the requested ADA
        submittedAt: action.blockTime ? new Date(action.blockTime * 1000) : null, // on-chain submission time
        scorePct: tpl.pct,                                                    // Template coverage %
        templateFindings: tpl.findings as unknown as Prisma.InputJsonValue,   // per-requirement detail
        questions: fw.findings as unknown as Prisma.InputJsonValue,           // Triangle Forces findings
        visionPct: vis.pct,                                                   // Cardano Vision 2030 %
        visionFindings: vis.findings as unknown as Prisma.InputJsonValue,     // Vision findings
        summary: null,
        prompt: combinedPrompt,
        rawResponse: combinedRaw,
        model: fw.model,
        createdBy: userId,
      },
      select: { id: true, scorePct: true, visionPct: true, model: true, govActionId: true, govActionTitle: true, govActionType: true, amountAda: true, submittedAt: true, templateId: true, createdAt: true },
    });
    // The board that just ran it sees the full log immediately; the public list never carries these.
    return { ...saved, summary: null, templateFindings: tpl.findings, questions: fw.findings, visionFindings: vis.findings, prompt: combinedPrompt, response: combinedRaw };
  }

  /** Fetch each link with `fetchOne` (concurrently, order preserved), labelling the source; a
   *  failure becomes an inline note. Concurrency keeps many references from exceeding the score timeout. */
  private async renderLinkBlock(links: string[], fetchOne: (url: string) => Promise<string>): Promise<string> {
    if (!links.length) return '';
    const blocks = await Promise.all(
      links.map(async (link) => {
        try { return `Source: ${link}\n${await fetchOne(link)}`; }
        catch (e) { return `Source: ${link}\n[could not be read: ${e instanceof Error ? e.message : e}]`; }
      }),
    );
    return blocks.join('\n\n----\n\n');
  }

  /** GitHub repository summary for code-quality assessment: metadata, contributor count, README. */
  private async fetchGithubInfo(url: string): Promise<string> {
    const gh = parseGithubRepo(url);
    if (!gh) throw new Error('not a GitHub repository URL');
    const headers: Record<string, string> = { Accept: 'application/vnd.github+json', 'User-Agent': 'drep-council' };
    if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
    const base = `https://api.github.com/repos/${gh.owner}/${gh.repo}`;
    const res = await fetch(base, { headers, signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new Error(`GitHub API returned ${res.status}`);
    const r = (await res.json()) as Record<string, unknown>;
    const s = (k: string) => (typeof r[k] === 'string' ? (r[k] as string) : '?');
    const n = (k: string) => (typeof r[k] === 'number' ? String(r[k] as number) : '?');

    let contributors = 'unknown';
    try {
      const c = await fetch(`${base}/contributors?per_page=1&anon=true`, { headers, signal: AbortSignal.timeout(15_000) });
      if (c.ok) {
        const m = /[?&]page=(\d+)>;\s*rel="last"/.exec(c.headers.get('link') || '');
        contributors = m ? m[1] : '1';
      }
    } catch { /* leave as unknown */ }

    let readme = '';
    try {
      const rd = await fetch(`${base}/readme`, { headers: { ...headers, Accept: 'application/vnd.github.raw' }, signal: AbortSignal.timeout(15_000) });
      if (rd.ok) readme = (await rd.text()).slice(0, MAX_EXTRA_LINK_CHARS);
    } catch { /* README optional */ }

    const meta = [
      `Repository: ${s('full_name') !== '?' ? s('full_name') : `${gh.owner}/${gh.repo}`}`,
      typeof r.description === 'string' && r.description ? `Description: ${r.description}` : '',
      `Primary language: ${s('language')}`,
      `Stars: ${n('stargazers_count')} · Forks: ${n('forks_count')} · Open issues: ${n('open_issues_count')}`,
      `Contributors (developers): ${contributors}`,
      `Created: ${s('created_at')} · Last push: ${s('pushed_at')} · Archived: ${r.archived ? 'yes' : 'no'}`,
    ].filter(Boolean).join('\n');
    return readme ? `${meta}\n\nREADME:\n${readme}` : meta;
  }

  // ── results (public read-only) ────────────────────────────────────────────────
  /** The prompt + raw response for one score (board-only; never in the public list). */
  async getResultLog(id: string) {
    const r = await this.prisma.proposalCheckResult.findUnique({ where: { id }, select: { prompt: true, rawResponse: true } });
    if (!r) throw new NotFoundException('result not found');
    return { prompt: r.prompt, response: r.rawResponse };
  }

  listResults(templateId?: string, limit = 50) {
    return this.prisma.proposalCheckResult.findMany({
      where: templateId ? { templateId } : {},
      orderBy: { createdAt: 'desc' },
      take: Math.max(1, Math.min(200, limit)),
      select: { id: true, templateId: true, govActionId: true, govActionTitle: true, govActionType: true, amountAda: true, submittedAt: true, scorePct: true, templateFindings: true, visionPct: true, visionFindings: true, summary: true, questions: true, model: true, createdAt: true },
    });
  }

  /** Delete one score (board) — e.g. to re-run an auto-score with external links added. */
  async deleteResult(id: string) {
    await this.prisma.proposalCheckResult.delete({ where: { id } }).catch(() => {
      throw new NotFoundException('result not found');
    });
    return { id, deleted: true };
  }

  // ── auto-check: score new Treasury Withdrawals ─────────────────────────────────
  /** Run the auto-check: for each Treasury Withdrawal with no score yet, generate one against the
   *  active template (no external links — nobody supplies them for an automatic run). `force` skips
   *  the interval gate (board "Run check now"); otherwise it respects the configured interval. */
  async runCheck(opts: { force?: boolean; userId?: string | null } = {}): Promise<{
    ran: boolean; reason?: string; scored: { govActionId: string; scorePct: number }[]; errors: { govActionId: string; error: string }[];
  }> {
    const userId = opts.userId ?? null;
    // Automatic review is off by default; only a manual "Run check now" (force) bypasses it.
    if (!opts.force && !(await this.ai.autoCheckEnabled())) return { ran: false, reason: 'automatic review is off', scored: [], errors: [] };
    if (!opts.force) {
      const intervalH = await this.ai.checkIntervalHours();
      const last = await this.ai.lastCheckAt();
      if (last && Date.now() - last.getTime() < intervalH * 3_600_000) return { ran: false, reason: 'interval not elapsed', scored: [], errors: [] };
    }

    const actions = await this.listGovActions(150); // Treasury Withdrawals only, newest first
    const maxBlock = actions.reduce((m, a) => Math.max(m, a.blockTime || 0), 0);
    // Baseline: the first check records the current newest block_time and scores NOTHING, so auto-scoring
    // never runs retroactively over pre-existing proposals — only ones that appear afterwards.
    const watermark = await this.ai.scoreWatermark();
    if (watermark === null) {
      await this.ai.setScoreWatermark(maxBlock, userId);
      await this.ai.setLastCheckAt(new Date(), userId);
      return { ran: true, reason: 'baseline recorded — only new Treasury Withdrawals are auto-scored from now on', scored: [], errors: [] };
    }

    const cfg = await this.ai.getConfig();
    if (!cfg.configured) { await this.ai.setLastCheckAt(new Date(), userId); return { ran: true, reason: 'no AI key configured', scored: [], errors: [] }; }
    const template = await this.prisma.proposalCheckTemplate.findFirst({ where: { active: true }, orderBy: { createdAt: 'desc' }, select: { id: true } });
    if (!template) { await this.ai.setLastCheckAt(new Date(), userId); return { ran: true, reason: 'no active template', scored: [], errors: [] }; }

    const existing = new Set((await this.prisma.proposalCheckResult.findMany({ select: { govActionId: true } })).map((r) => r.govActionId));
    const todo = actions.filter((a) => (a.blockTime || 0) > watermark && !existing.has(a.proposalId)).slice(0, 20); // only NEW since the baseline

    const scored: { govActionId: string; scorePct: number }[] = [];
    const errors: { govActionId: string; error: string }[] = [];
    for (const a of todo) {
      try {
        const r = await this.score(template.id, a.proposalId, userId, []);
        scored.push({ govActionId: a.proposalId, scorePct: r.scorePct });
      } catch (e) {
        errors.push({ govActionId: a.proposalId, error: e instanceof Error ? e.message : String(e) });
        // A key/credit/rate failure will repeat for every action — stop early rather than burn calls.
        if (e instanceof AiError && ['no_key', 'bad_key', 'insufficient_quota', 'rate_limited'].includes(e.code)) break;
      }
    }
    await this.ai.setLastCheckAt(new Date(), userId);
    return { ran: true, scored, errors };
  }

  private govActionToText(action: GovAction, meta: GovActionMeta): string {
    const parts: string[] = [`Governance action id: ${action.proposalId}`, `Type: ${action.type}`];
    if (action.withdrawalAda != null) parts.push(`Requested amount: ${action.withdrawalAda.toLocaleString('en-US')} ₳`);
    if (meta.title) parts.push(`Title: ${meta.title}`);
    if (meta.abstract) parts.push(`Abstract:\n${meta.abstract}`);
    if (meta.motivation) parts.push(`Motivation:\n${meta.motivation}`);
    if (meta.rationale) parts.push(`Rationale:\n${meta.rationale}`);
    if (meta.references?.length) parts.push(`References:\n${meta.references.map((r) => `- ${r.label ?? ''} ${r.uri ?? ''}`.trim()).join('\n')}`);
    // Fallback: if the anchor had no recognisable CIP-108 fields, feed the raw JSON text.
    if (!meta.title && !meta.abstract && !meta.motivation && !meta.rationale && meta.raw) parts.push(`Raw metadata:\n${meta.raw}`);
    return parts.join('\n\n');
  }
}
