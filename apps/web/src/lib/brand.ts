/**
 * Per-deployment branding. This deployment is the DRep Council — a pure governance Council
 * (DReps join, propose and vote; no funding rounds/treasury budgeting). The landing
 * page reads `kind` to show governance figures rather than funding ones.
 */
export interface Brand {
  name: string;
  /** Tab icon served from /public. */
  icon: string;
  /** <meta name="description"> for the deployment. */
  description: string;
  /** Which public landing to show: a funding Council (rounds/treasury) or a pure governance Council. */
  kind: 'funding' | 'governance';
}

export const brand: Brand = {
  name: 'DRep Council',
  icon: '/icons/drep-ballot-check.svg',
  description: 'DRep Council — Cardano governance platform',
  kind: 'governance',
};
