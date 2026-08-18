/**
 * Per-deployment branding. This deployment is the DRep DAO — a pure governance DAO
 * (DReps join, propose and vote; no funding rounds/treasury budgeting). The landing
 * page reads `kind` to show governance figures rather than funding ones.
 */
export interface Brand {
  name: string;
  /** Tab icon served from /public. */
  icon: string;
  /** <meta name="description"> for the deployment. */
  description: string;
  /** Which public landing to show: a funding DAO (rounds/treasury) or a pure governance DAO. */
  kind: 'funding' | 'governance';
}

export const brand: Brand = {
  name: 'DRep DAO',
  icon: '/icons/drep-globe.svg',
  description: 'Cardano governance DAO platform',
  kind: 'governance',
};
