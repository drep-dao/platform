// Triangle Forces review framework (adapted for Cardano Treasury proposal review).
// Structured so the UI + scoring are deterministic and the five outcomes are enforced; the board
// can edit it (Configuration → Framework). Seeded from the "Triangle Forces Framework" document
// (adapted from the Triangle Forces Framework by Jürgen Proschinger, founder of Triangle Forces).

export interface ReviewOutcome { key: string; label: string; definition: string }
export interface ReviewQuestion { id: number; text: string }
export interface ReviewArea { key: string; title: string; description?: string; templateRefs?: string[]; questions: ReviewQuestion[] }
export interface ReviewFramework {
  title: string;
  attribution?: string;
  guidance: string;
  outcomes: ReviewOutcome[];
  areas: ReviewArea[];
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
  evidence?: string[]; // the exact passage(s) from the proposal used — one or more short quotes
  evidenceCited?: string; // 'yes' | 'no' | 'na' — did the proposal cite a source for this answer
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
      title: 'Verifiability',
      description: 'Can material claims and commitments be checked?',
      templateRefs: ['7B', '11A', '11B', '11C'],
      questions: [
        { id: 11, text: 'Can an independent person inspect the evidence for each material claim, understand its limitations, and determine whether the claim is true?' },
        { id: 12, text: 'Are definitions, calculations, source data, evidence versions, and the distinction between on-chain facts and real-world facts sufficiently clear?' },
        { id: 13, text: 'Does the proposed assurance, audit, reporting, or acceptance process match the financial value, irreversibility, and risk of the decision?' },
      ],
    },
    {
      key: 'reinforcement',
      title: 'Reinforcement',
      description: 'Do incentives and controls support honest delivery?',
      templateRefs: ['4B', '4C', '6A', '6B', '6C', '8C', '9A', '9B', '9C', '12D', '12I', '12J'],
      questions: [
        { id: 14, text: 'Who benefits if a claim remains unclear, a result cannot be measured, or expenditure cannot be inspected?' },
        { id: 15, text: 'Are conflicts disclosed and managed, and are execution, verification, custody, oversight, and decision-making sufficiently separated?' },
        { id: 16, text: 'Who can withhold payment, pause spending, replace an operator, recover funds, or enforce commitments when the proposal fails to deliver?' },
      ],
    },
  ],
};

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
    const o = (f.outcome || '').toLowerCase();
    if (o.includes('not applicable') || o === 'na' || o === 'n/a') continue;
    n += 1;
    weight += o.includes('condition') ? 0.5 : o.includes('unsupported') || o.includes('unanswered') ? 0 : o.includes('supported') ? 1 : 0;
  }
  return n ? Math.round((weight / n) * 100) : 0;
}
