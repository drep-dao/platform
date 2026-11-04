// Cardano Vision / Strategy 2030 — the third scoring dimension: how well a Treasury proposal aligns
// with the published Cardano 2030 strategy. The REFERENCE is a consolidated digest of
// https://product.cardano.intersectmbo.org/vision/strategy-2030 (5 pillars + core KPIs); the QUESTION
// SET is a ReviewFramework (same shape as Triangle Forces) so scoring, findings and the radar are
// shared. Both are board-editable (Setup → Vision). Source captured 2026-10-28.

import type { ReviewFramework } from './framework';

export const DEFAULT_VISION_SOURCE_URL = 'https://product.cardano.intersectmbo.org/vision/strategy-2030';

/** Consolidated digest of the Cardano 2030 Strategy, fed to the model as #VISION_REFERENCE. */
export const DEFAULT_VISION_REFERENCE = `CARDANO 2030 STRATEGY (digest of ${DEFAULT_VISION_SOURCE_URL})

VISION: Cardano runs a secure, interoperable base layer that sustains ~324 million transactions per year and anchors Layer-2 solutions and real-world applications. Outcomes are shared across the Cardano Foundation, IOG, Emurgo, Intersect, SPOs and funded community teams — no single owner.

CORE 2030 KPIs (current → 2030 target):
- TVL: $200M → $3B
- Monthly submitted transactions: 800k → ≥27M
- Monthly Active Users: ~100k–300k → 1M
- Uptime (6 epochs): 99.98%, with no 5-minute blockless gaps
- Stake concentration: 50%+1 lovelace controlled by >22 DReps
- Alternative full-node clients: 1 → ≥2
- Annual protocol revenue: 3.5M ada → ≥16M ada
- DRep participation: >70% of active DReps (by stake) vote on ≥90% of actions
- Throughput capacity: ~3x current (300k tx/day baseline)
- SPO decentralization: >500 pools producing ≥95% of blocks

FIVE STRATEGIC PILLARS:
1. Infrastructure & Research Excellence — L1/L2 scalability, cross-chain interoperability, core ZK; security & resilience (post-quantum readiness, client diversity, threat detection & recovery).
2. Adoption & Utility — high-value verticals (DeFi, RWA, supply chain/provenance, payments); experience (invisible technology, decentralized/self-sovereign identity, enterprise security & compliance); developer experience (open-source incentives, education & migration, compatibility).
3. Governance — incentivized & accessible governance (role-based incentives for DReps, SPOs, Constitutional Committee; governance tooling); turnout-aware voting with delegator safeguard (adaptive thresholds, per-proposal delegator override); treasury seasons (seasonal proposal windows and season reports).
4. Community & Ecosystem Growth — talent acquisition & retention (youth engagement, hands-on experience, structured funding routes); global engagement & market adoption (demonstrating ecosystem value, localized adoption).
5. Ecosystem Sustainability & Resilience — financial stewardship & tokenomics (multi-asset treasury, managed treasury, L2-to-L1 value retention, sustainable revenue); SPO incentives (diversified SPO roles, decentralization target).

HOW TO JUDGE A PROPOSAL: a strong proposal advances one or more pillars with a clear, specific mechanism, and credibly moves at least one core KPI toward its 2030 target. A proposal need not touch every pillar — focus is fine; a pillar it genuinely does not relate to is "Not applicable", not a failure.`;

/** Vision 2030 question set (ReviewFramework shape — 5 pillar areas, shared outcomes). */
export const DEFAULT_VISION_FRAMEWORK: ReviewFramework = {
  title: 'Cardano Vision 2030',
  attribution: `Questions derived from the Cardano 2030 Strategy (Intersect Product Committee), ${DEFAULT_VISION_SOURCE_URL}.`,
  guidance:
    'Judge how well the proposal ADVANCES the Cardano 2030 Strategy, using the VISION REFERENCE as the source of truth. ' +
    '"Supported" = it clearly and specifically advances this priority with a credible mechanism; ' +
    '"Supported with condition" = it plausibly helps but a concrete piece is missing (named owner, measurable target, dated milestone, evidence of demand); ' +
    '"Unsupported" = it claims to help but the case is vague, generic or not convincing; ' +
    '"Unanswered" = the proposal does not address this priority at all; ' +
    '"Not applicable" = this priority genuinely does not relate to the proposal\'s category or scope (give the reason) — a focused proposal will have several N/A, which is fine and MUST NOT be penalised. ' +
    'Throughout, prefer a measurable link to a 2030 KPI over a generic aspiration; a confident claim with no mechanism or metric is "Unsupported" or "Supported with condition", not "Supported". Do not reward buzzwords.',
  outcomes: [
    { key: 'supported', label: 'Supported', definition: 'The proposal clearly and specifically advances this Vision 2030 priority with a credible mechanism.' },
    { key: 'supported_with_condition', label: 'Supported with condition', definition: 'It plausibly helps, but a concrete item is missing (named owner, measurable target, dated milestone, evidence of demand).' },
    { key: 'unsupported', label: 'Unsupported', definition: 'It claims to advance this priority but the case is vague, generic, or not convincing.' },
    { key: 'unanswered', label: 'Unanswered', definition: 'The proposal does not address this priority at all.' },
    { key: 'not_applicable', label: 'Not applicable', definition: 'This priority genuinely does not relate to the proposal (a reason is required). Excluded from the score.' },
  ],
  areas: [
    {
      key: 'infrastructure',
      title: 'Infrastructure & Research Excellence',
      description: 'Scalability, interoperability, security and resilience of the base layer and L2.',
      questions: [
        { id: 1, text: 'Does the proposal improve Layer-1/Layer-2 scalability, throughput, or cross-chain interoperability?' },
        { id: 2, text: 'Does it strengthen network security or resilience (client diversity, post-quantum readiness, threat detection and recovery)?' },
        { id: 3, text: 'Does it protect or improve base-layer reliability and uptime?' },
      ],
    },
    {
      key: 'adoption',
      title: 'Adoption & Utility',
      description: 'Real on-chain demand, user/enterprise experience, and developer experience.',
      questions: [
        { id: 4, text: 'Does it drive real on-chain demand in a high-value vertical (DeFi, RWA, supply chain/provenance, or payments)?' },
        { id: 5, text: 'Does it improve end-user or enterprise experience (invisible technology, decentralized identity, security/compliance)?' },
        { id: 6, text: 'Does it improve developer experience (open-source incentives, education/migration, compatibility)?' },
      ],
    },
    {
      key: 'governance',
      title: 'Governance',
      description: 'Incentivised and accessible governance, turnout-aware voting, treasury processes.',
      questions: [
        { id: 7, text: 'Does it make governance more incentivised or accessible (roles for DReps/SPOs/CC, governance tooling)?' },
        { id: 8, text: 'Does it support turnout-aware voting or delegator safeguards (adaptive thresholds, per-proposal override)?' },
        { id: 9, text: 'Does it fit or strengthen treasury processes (seasons, reporting, accountable spending)?' },
      ],
    },
    {
      key: 'community',
      title: 'Community & Ecosystem Growth',
      description: 'Talent, global/regional adoption, and public confidence in the ecosystem.',
      questions: [
        { id: 10, text: 'Does it build or retain talent (youth engagement, hands-on experience, structured funding routes)?' },
        { id: 11, text: 'Does it expand global or regional adoption of Cardano (localized outreach, new markets, partnerships)?' },
        { id: 12, text: 'Does it demonstrate ecosystem value or strengthen public/enterprise confidence (case studies, education, communication, measurable reach)?' },
      ],
    },
    {
      key: 'sustainability',
      title: 'Ecosystem Sustainability & Resilience',
      description: 'Tokenomics, treasury stewardship, SPO incentives/decentralization, and measurable KPI impact.',
      questions: [
        { id: 13, text: 'Does it improve financial stewardship or tokenomics (multi-asset/managed treasury, L2→L1 value retention, sustainable protocol revenue)?' },
        { id: 14, text: 'Does it strengthen SPO incentives or decentralization (diversified SPO roles, stake distribution, >500 pools producing ≥95% of blocks)?' },
        { id: 15, text: 'Does it credibly move one or more 2030 KPIs toward target (TVL, monthly transactions, MAU, revenue, DRep participation, decentralization), in a way measurable and realistic for its budget and scope?' },
      ],
    },
  ],
};
