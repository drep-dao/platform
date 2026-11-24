// Triangle Forces review framework (adapted for Cardano Treasury proposal review).
// Structured so the UI + scoring are deterministic and the five outcomes are enforced; the board
// can edit it (Configuration → Framework). Seeded from the "Triangle Forces Framework" document
// (adapted from the Triangle Forces Framework by Jürgen Proschinger, founder of Triangle Forces).

export interface ReviewOutcome { key: string; label: string; definition: string }
export interface ReviewQuestion { id: number; text: string }
export interface ReviewArea {
  key: string; title: string; description?: string; templateRefs?: string[]; questions: ReviewQuestion[];
  // 'force' = one of the three scored Triangle Forces (Desirability/Feasibility/Viability) — the default.
  // 'verification' = Jürgen Proschinger's verifiable-reflexivity layer: these questions ARE assessed, but
  // do NOT count toward the score. They wrap the three forces as a trust check (see `verifies`). Per his
  // article: verifiable reflexivity "does not function as a fourth pillar … it belongs around the framework
  // as a verification layer."
  role?: 'force' | 'verification';
  // Verification area only: the KEY of the force this check hardens
  // (reflexivity→desirability, verifiability→feasibility, reinforcement→viability).
  verifies?: string;
}
export interface ReviewFramework {
  title: string;
  attribution?: string;
  guidance: string;
  outcomes: ReviewOutcome[];
  areas: ReviewArea[];
}

/** One evidence passage with its resolved origin: `proposal` = the quote is in the proposal text,
 *  `external` = it was found in a fetched link (url names which). Origin is computed deterministically
 *  from the fetched source texts (not the model), so it is reliable. */
export interface EvidenceItem {
  quote: string;
  from: 'proposal' | 'external';
  url?: string; // set when from === 'external'
}

/** One source the scorer read, for the "Sources considered" panel. `kind` = what it is; `ok` = whether
 *  its content was successfully loaded; `github` carries repo stats when kind === 'github'. */
export interface ScanSource {
  kind: 'proposal' | 'document' | 'github';
  url?: string; // omitted for the proposal itself
  ok: boolean;
  note?: string; // 'truncated', the failure reason, or a short descriptor
  chars?: number; // extracted characters (documents / the proposal)
  github?: {
    repo: string;
    contributors?: number;
    commits?: number;
    language?: string;
    stars?: number;
    lastPush?: string;
    effort?: string; // e.g. "1 full-time · 2 part-time · 5 occasionally"
    participation?: string; // e.g. "active in 34 of the last 52 weeks"
  };
}

/** One assessed framework question. `outcome` is always one of the framework's outcome labels. */
export interface ReviewFinding {
  id: number;
  // Template dimension only: which ask-size tier this requirement belongs to. 'base' = asked of every
  // proposal; 'middle'/'large' = extra requirement added for larger Treasury withdrawals. Undefined on
  // the framework/vision dimensions. Carried into the stored result so the tier snapshot is permanent.
  tier?: 'base' | 'middle' | 'large';
  area: string;
  question: string;
  outcome: string;
  reason?: string;
  risk?: string;
  condition?: string;
  templateRefs?: string[];
  // The exact passage(s) used. The model returns plain strings; after scoring each is resolved to an
  // EvidenceItem carrying whether it came from the proposal or an external link (back-compat: a stored
  // result may still hold plain strings, read as proposal quotes).
  evidence?: (string | EvidenceItem)[];
  evidenceCited?: string; // 'yes' | 'no' | 'na' — did the proposal cite a source for this answer
  // Snapshotted from the area at scoring time so a stored result renders correctly even if the framework
  // later changes. 'verification' findings are excluded from the score and shown as a per-force trust check.
  role?: 'force' | 'verification';
  verifies?: string; // verification findings only: the TITLE of the force this check hardens
}

export const DEFAULT_REVIEW_FRAMEWORK: ReviewFramework = {
  title: 'Triangle Forces (adapted)',
  attribution: 'Framework adapted from the Triangle Forces Framework by Jürgen Proschinger, founder of Triangle Forces and a Cardano DRep.',
  guidance: [
    'Apply exactly one outcome to each question, chosen from the outcome definitions. Be a critical, skeptical reviewer — a real proposal almost always shows a MIX of outcomes, so marking nearly everything "Supported" means you were not critical enough.',
    'CALIBRATION: "Supported" means the proposal answers the question SPECIFICALLY and SUBSTANTIVELY on its face (concrete detail/evidence/data/reasoning that satisfies it). A topic merely appearing, or a generic/vague/thin statement, is NOT enough. You do NOT verify real-world facts and must not down-rank for lack of independent verification — but you DO judge whether the proposal\'s own answer is adequate and convincing.',
    'When a question asks for EVIDENCE/DATA and the proposal gives only an unsourced claim or bare figure (no source, dataset, citation or baseline), that is "Supported with condition" (name the missing source) at best, or "Unsupported" if central — the proposal must at least point to where the figure comes from.',
    'Answer EVERY part of a multi-part question; if only the first part is covered, it is "Supported with condition" (name the missing part), not "Supported". For counterfactual / opportunity-cost questions (what would NOT happen without funding, what this displaces, alternatives), require specific concrete reasoning — a circular/generic answer ("without funding it may not be built") is inadequate.',
    'Scrutinise especially the two areas proposals most often assert without real support: genuine demand / market validation / independent research, and continuity (who maintains, funds and adopts the result after funding ends).',
    '"Supported with condition" is a COMMON, correct outcome whenever the answer is present but a specific concrete item is missing (a source for a figure, an independent baseline, a signed agreement, a dated/verifiable milestone, a named accountable party, an audit). Prefer it over "Supported" whenever such a gap exists.',
    'Reserve "Unsupported" for a bare assertion with no supporting material, material that does not bear on the claim, or an answer too vague/thin to make the case. Do not use it merely because a claim is unverified.',
    'Keep "Unsupported" and "Unanswered" strictly separate: Unsupported = addressed but inadequate; Unanswered = not addressed / no relevant material found.',
    'For every finding, cite the specific passage or evidence you used (quote it briefly in "evidence"). If nothing in the material supports the claim, say so rather than inventing one.',
    'Give a short "reason" (report what the proposal provides, do not endorse its truth), the "risk" to the Treasury if the gap remains, and — only when the outcome is "Supported with condition" — a "condition": a defined requirement to be met before approval, payment, deployment, or a later stage.',
    'List the TEMPLATE field references you relied on in "templateRefs" (e.g. "2A", "12F").',
    'Judge only from the material provided; do not invent facts. Do not collapse the framework into a single score.',
  ].join('\n'),
  outcomes: [
    { key: 'supported', label: 'Supported', definition: 'The issue is answered clearly and backed by relevant, credible evidence.' },
    { key: 'supported_with_condition', label: 'Supported with condition', definition: 'The proposal can proceed if a defined requirement is met before approval, payment, deployment, or a later stage.' },
    { key: 'unsupported', label: 'Unsupported', definition: 'The issue is addressed, but the explanation or evidence does not support the claim sufficiently.' },
    { key: 'unanswered', label: 'Unanswered', definition: 'A material question is not answered, or relevant evidence cannot be found.' },
    { key: 'not_applicable', label: 'Not applicable', definition: 'The issue does not apply to the category, funding mechanism, scale, or activity. A reason is required.' },
  ],
  areas: [
    {
      key: 'desirability',
      role: 'force',
      title: 'Desirability',
      description: 'Is there a sufficiently important reason for this proposal to exist?',
      templateRefs: ['2A', '2B', '2C', '2D', '7B', '10A', '12F', '12J'],
      questions: [
        { id: 1, text: 'What specific problem does the proposal address, who experiences it, and what evidence shows that it exists at the requested scale?' },
        { id: 2, text: 'Why is the solution valuable for Cardano users or the Cardano ecosystem? What would likely not happen without Treasury support?' },
        { id: 3, text: 'Why should Treasury fund this proposal now, and what other public benefits or proposals does this allocation displace?' },
      ],
    },
    {
      key: 'feasibility',
      role: 'force',
      title: 'Feasibility',
      description: 'Can the team create and deliver the promised value?',
      templateRefs: ['3A', '3B', '3C', '3D', '4A', '4B', '4C', '4D', '5A', '5B', '5C', '5D', '6A', '6B', '6C', '9A', '9C', '12A', '12B', '12C', '12D', '12E', '12F', '12H', '12I', '12J'],
      questions: [
        { id: 4, text: 'Which assumptions must be true for success, and which have already been tested or independently evidenced?' },
        { id: 5, text: 'Does the team have the capacity, experience, authority, and confirmed partner support required to deliver the full scope?' },
        { id: 6, text: 'Is the budget proportionate, itemised, and supported by credible cost assumptions, financing evidence, and disclosure of prior funding?' },
        { id: 7, text: 'Are payments tied to dated deliverables, measurable acceptance criteria, independent verification, and practical responses to delay, partial delivery, or failure?' },
      ],
    },
    {
      key: 'viability',
      role: 'force',
      title: 'Viability',
      description: 'Does expected value justify the funding and risk?',
      templateRefs: ['3C', '3D', '7A', '7B', '7C', '10A', '10B', '10C', '12B', '12F', '12G', '12H'],
      questions: [
        { id: 8, text: 'Does expected public value justify the requested funding and Treasury exposure compared with alternatives, prior work, or a smaller validation phase?' },
        { id: 9, text: 'How will the proposal demonstrate meaningful outcomes rather than only activities, outputs, impressions, registrations, or subsidised transactions?' },
        { id: 10, text: 'Will the outcome persist after Treasury funding ends? Who will maintain it, fund it, operate it, or take it over if the original operator cannot continue?' },
      ],
    },
    {
      key: 'verifiability',
      role: 'verification',
      verifies: 'feasibility',
      title: 'Verifiability',
      description: 'Trust layer over Feasibility — can we build it, AND can we prove we built what we claimed?',
      templateRefs: ['7B', '11A', '11B', '11C'],
      questions: [
        { id: 11, text: 'Can an independent person inspect the evidence for each material claim, understand its limitations, and determine whether the claim is true?' },
        { id: 12, text: 'Are definitions, calculations, source data, evidence versions, and the distinction between on-chain facts and real-world facts sufficiently clear?' },
        { id: 13, text: 'Does the proposed assurance, audit, reporting, or acceptance process match the financial value, irreversibility, and risk of the decision?' },
      ],
    },
    {
      key: 'reinforcement',
      role: 'verification',
      verifies: 'viability',
      title: 'Reinforcement',
      description: 'Trust layer over Viability — do incentives and controls make honesty pay better than concealment?',
      templateRefs: ['4B', '4C', '6A', '6B', '6C', '8C', '9A', '9B', '9C', '12D', '12I', '12J'],
      questions: [
        { id: 14, text: 'Who benefits if a claim remains unclear, a result cannot be measured, or expenditure cannot be inspected?' },
        { id: 15, text: 'Are conflicts disclosed and managed, and are execution, verification, custody, oversight, and decision-making sufficiently separated?' },
        { id: 16, text: 'Who can withhold payment, pause spending, replace an operator, recover funds, or enforce commitments when the proposal fails to deliver?' },
      ],
    },
    {
      key: 'reflexivity',
      role: 'verification',
      verifies: 'desirability',
      title: 'Reflexivity',
      description: 'Trust layer over Desirability — visibility changes behaviour: is the demand real and observable, not just asserted?',
      templateRefs: ['2A', '2B', '7B', '10A'],
      questions: [
        { id: 17, text: 'Can the claimed demand or impact be independently observed or measured (adoption, usage, on-chain activity), rather than asserted through surveys, stated intentions, or internal enthusiasm?' },
        { id: 18, text: 'Does the proposal commit to transparent, checkable reporting of outcomes, so the community can verify the stated benefits after delivery instead of taking them on trust?' },
        { id: 19, text: 'Are the key claims made public and auditable in a way that changes the team’s accountability — does the proposal embrace that visibility rather than rely on "trust me"?' },
      ],
    },
  ],
};

// Canonical Triangle Forces role map, keyed by area key. A force is scored; a verification area is the
// trust layer over the force it names. Used to upgrade a stored (seeded) framework that predates the layer.
const FORCE_KEYS = ['desirability', 'feasibility', 'viability'];
const VERIFICATION_VERIFIES: Record<string, string> = { verifiability: 'feasibility', reinforcement: 'viability', reflexivity: 'desirability' };

/** Overlay the canonical roles onto a framework whose areas predate the verification layer, and append the
 *  Reflexivity trust area if missing — so a stored (seeded) framework upgrades on read without a data
 *  migration. Idempotent: a framework that already has a verification area is returned unchanged, and
 *  board-added areas keep whatever role they carry. */
export function applyFrameworkDefaults(fw: ReviewFramework): ReviewFramework {
  if (fw.areas.some((a) => a.role === 'verification')) return fw; // already upgraded (default or saved)
  const areas: ReviewArea[] = fw.areas.map((a) => {
    if (FORCE_KEYS.includes(a.key)) return { ...a, role: 'force' };
    if (a.key in VERIFICATION_VERIFIES) return { ...a, role: 'verification', verifies: VERIFICATION_VERIFIES[a.key] };
    return a;
  });
  if (!areas.some((a) => a.key === 'reflexivity')) {
    const reflexivity = DEFAULT_REVIEW_FRAMEWORK.areas.find((a) => a.key === 'reflexivity');
    if (reflexivity) areas.push(reflexivity);
  }
  return { ...fw, areas };
}

/** Validate + normalise a framework object coming from the board editor. Throws on an unusable shape. */
export function normaliseFramework(input: unknown): ReviewFramework {
  const o = (input ?? {}) as Record<string, unknown>;
  const str = (v: unknown, fallback = '') => (typeof v === 'string' ? v : fallback);
  const outcomes = Array.isArray(o.outcomes)
    ? o.outcomes.map((x) => {
        const r = (x ?? {}) as Record<string, unknown>;
        return { key: str(r.key) || str(r.label).toLowerCase().replace(/\s+/g, '_'), label: str(r.label), definition: str(r.definition) };
      }).filter((x) => x.label)
    : [];
  const areas = Array.isArray(o.areas)
    ? o.areas.map((a) => {
        const r = (a ?? {}) as Record<string, unknown>;
        const questions = Array.isArray(r.questions)
          ? r.questions.map((q) => {
              const qr = (q ?? {}) as Record<string, unknown>;
              return { id: Number(qr.id), text: str(qr.text) };
            }).filter((q) => Number.isFinite(q.id) && q.text)
          : [];
        return {
          key: str(r.key) || str(r.title).toLowerCase().replace(/\s+/g, '_'),
          title: str(r.title),
          description: str(r.description) || undefined,
          templateRefs: Array.isArray(r.templateRefs) ? r.templateRefs.map((t) => str(t)).filter(Boolean) : [],
          role: (r.role === 'verification' ? 'verification' : r.role === 'force' ? 'force' : undefined) as 'force' | 'verification' | undefined,
          verifies: str(r.verifies) || undefined,
          questions,
        };
      }).filter((a) => a.title && a.questions.length)
    : [];
  if (!outcomes.length) throw new Error('the framework needs at least one outcome');
  if (!areas.length) throw new Error('the framework needs at least one area with questions');
  return {
    title: str(o.title) || 'Review framework',
    attribution: str(o.attribution) || undefined,
    guidance: str(o.guidance),
    outcomes,
    areas,
  };
}

/** Render the framework as the #FRAMEWORK_QUESTIONS block injected into the prompt. */
export function renderFramework(fw: ReviewFramework): string {
  const lines: string[] = [`Framework: ${fw.title}`, '', 'Outcomes (choose exactly one per question):'];
  for (const o of fw.outcomes) lines.push(`- ${o.label}: ${o.definition}`);
  if (fw.guidance.trim()) { lines.push('', 'Guidance:', fw.guidance.trim()); }
  lines.push('', 'Questions:');
  for (const area of fw.areas) {
    const refs = area.templateRefs?.length ? ` (relevant TEMPLATE fields: ${area.templateRefs.join(', ')})` : '';
    lines.push(`${area.title}${area.description ? ` — ${area.description}` : ''}${refs}`);
    for (const q of area.questions) lines.push(`  ${q.id}. ${q.text}`);
  }
  return lines.join('\n');
}

/** Build the authoritative finding list from the framework, merged with the model's answers by id.
 *  Guarantees one finding per framework question (missing / invalid → "Unanswered"). */
export function buildFindings(fw: ReviewFramework, modelFindings: unknown): ReviewFinding[] {
  const labels = fw.outcomes.map((o) => o.label);
  const fallback = labels.find((l) => /unanswer/i.test(l)) ?? labels[labels.length - 1] ?? 'Unanswered';
  // Index the model's findings by a normalised key. The model keys a finding either by the numeric
  // question id (framework / vision) OR by the template's own code like "1A" when the question text
  // carries a "[1A] …" prefix — so match on BOTH, otherwise a code-keyed answer fails Number() and the
  // whole dimension falls back to Unanswered (the Template-all-Unanswered bug).
  const norm = (v: unknown) => String(v ?? '').trim().replace(/^\[|\]$/g, '').toUpperCase();
  const byKey = new Map<string, Record<string, unknown>>();
  if (Array.isArray(modelFindings)) {
    for (const f of modelFindings) {
      const r = (f ?? {}) as Record<string, unknown>;
      const k = norm(r.id);
      if (k) byKey.set(k, r);
    }
  }
  const codeOf = (text: string) => { const m = /^\s*\[([^\]]+)\]/.exec(text); return m ? norm(m[1]) : null; };
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
  // Accept the model's evidence as a single string (legacy) or an array of quotes; normalise to a
  // deduped list of short passages (cap 8) so the UI can show 1–2 and let the reader expand the rest.
  const quotes = (v: unknown): string[] => {
    const raw = Array.isArray(v) ? v : [v];
    const seen = new Set<string>();
    const list: string[] = [];
    for (const item of raw) {
      const s = str(item);
      if (!s) continue;
      const key = s.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      list.push(s);
      if (list.length >= 8) break;
    }
    return list;
  };
  const titleByKey = new Map(fw.areas.map((a) => [a.key, a.title]));
  const out: ReviewFinding[] = [];
  for (const area of fw.areas) {
    for (const q of area.questions) {
      const code = codeOf(q.text);
      const m = byKey.get(norm(q.id)) ?? (code ? byKey.get(code) : undefined) ?? {};
      const given = String(m.outcome ?? '').trim();
      const outcome = labels.find((l) => l.toLowerCase() === given.toLowerCase()) ?? fallback;
      out.push({
        id: q.id,
        area: area.title,
        question: q.text,
        outcome,
        role: area.role,
        verifies: area.role === 'verification' ? (titleByKey.get(area.verifies ?? '') ?? area.verifies) : undefined,
        reason: str(m.reason),
        risk: str(m.risk),
        condition: str(m.condition),
        templateRefs: Array.isArray(m.templateRefs) ? m.templateRefs.map((t) => String(t)).filter(Boolean).slice(0, 24) : [],
        evidence: quotes(m.evidence),
        evidenceCited: str(m.evidenceCited)?.toLowerCase(),
      });
    }
  }
  return out;
}

/** The dimension % — weighted findings over the applicable (non-"Not applicable") ones:
 *  Supported = 1, Supported with condition = 0.5, Unsupported/Unanswered = 0. Shared by all three
 *  scoring dimensions (template coverage, Triangle Forces, Cardano Vision 2030). */
export function pctFromFindings(findings: ReviewFinding[]): number {
  let weight = 0, n = 0;
  for (const f of findings ?? []) {
    if (f.role === 'verification') continue; // the trust layer is assessed but never scored
    const o = (f.outcome || '').toLowerCase();
    if (o.includes('not applicable') || o === 'na' || o === 'n/a') continue;
    n += 1;
    weight += o.includes('condition') ? 0.5 : o.includes('unsupported') || o.includes('unanswered') ? 0 : o.includes('supported') ? 1 : 0;
  }
  return n ? Math.round((weight / n) * 100) : 0;
}

// ── link + evidence helpers (source attribution for the "Sources considered" panel) ─────────────

/** Extract http(s) URLs written in free text (a proposal body), deduped and cleaned of trailing
 *  sentence punctuation. Lets the scorer read links mentioned IN the proposal, not only the explicit
 *  link fields / on-chain references. Capped so a link-dump can't blow past the fetch budget. */
export function urlsFromText(text: string): string[] {
  if (!text) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  const re = /https?:\/\/[^\s<>[\]"'`]+/gi;
  for (const m of text.matchAll(re)) {
    let u = m[0].replace(/[.,;:!?]+$/, '');
    while (u.endsWith(')') && !u.slice(0, -1).includes('(')) u = u.slice(0, -1); // unbalanced trailing paren(s)
    const key = u.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(u);
    if (out.length >= 20) break;
  }
  return out;
}

/** Normalise text for substring matching: lowercase + collapse whitespace. */
function normForMatch(s: string): string {
  return String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Resolve one evidence quote to its origin. The proposal is checked FIRST (a quote the proposal
 *  itself contains reads as "proposal" even if a linked doc repeats it); then each external source.
 *  Unmatched defaults to proposal, since the model is instructed to quote the proposal. Deterministic
 *  — it never trusts the model to self-label the source. */
export function resolveEvidenceOrigin(
  quote: string,
  proposalNorm: string,
  sources: { url: string; textNorm: string }[],
): EvidenceItem {
  const q = normForMatch(quote);
  const seg = q.split(/\s*(?:\.\.\.|…)\s*/).find((s) => s.length >= 15) ?? q; // skip "…" gaps
  const needle = seg.slice(0, 80);
  const hit = (hay: string) => needle.length >= 8 && hay.includes(needle);
  if (!needle || hit(proposalNorm)) return { quote: String(quote), from: 'proposal' };
  for (const s of sources) if (hit(s.textNorm)) return { quote: String(quote), from: 'external', url: s.url };
  return { quote: String(quote), from: 'proposal' };
}

/** Attribute every finding's evidence quotes to their origin (proposal vs a specific link), in place
 *  of the plain strings the model returned. Also flips evidenceCited to 'yes' when a quote resolved to
 *  an external source (the proposal is genuinely backed by a link), so the evidence rate reflects it. */
export function attributeFindingsEvidence(
  findings: ReviewFinding[],
  proposalText: string,
  sources: { url: string; text: string }[],
): ReviewFinding[] {
  const proposalNorm = normForMatch(proposalText);
  const srcNorm = sources.filter((s) => s.text).map((s) => ({ url: s.url, textNorm: normForMatch(s.text) }));
  return findings.map((f) => {
    const quotes = Array.isArray(f.evidence) ? f.evidence : [];
    const resolved: EvidenceItem[] = quotes.map((e) =>
      typeof e === 'string' ? resolveEvidenceOrigin(e, proposalNorm, srcNorm) : e,
    );
    const anyExternal = resolved.some((e) => e.from === 'external');
    return { ...f, evidence: resolved, evidenceCited: anyExternal ? 'yes' : f.evidenceCited };
  });
}

/** Classify one contributor's effort from their commits over the weeks they were active. */
export function classifyEffort(commits: number, activeWeeks: number): 'full-time' | 'part-time' | 'occasionally' | 'rarely' {
  if (activeWeeks <= 0 || commits <= 0) return 'rarely';
  const perWeek = commits / activeWeeks;
  if (perWeek >= 10) return 'full-time';
  if (perWeek >= 3) return 'part-time';
  if (perWeek >= 1) return 'occasionally';
  return 'rarely';
}
