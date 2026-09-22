// §29 OG / configurable Groups — feature flag. The entire Groups/OG surface (left-nav items, group
// routes, My-area group tabs, the OG role label) is gated on this one flag so the feature can be
// removed instantly without deleting code: set NEXT_PUBLIC_GROUPS_ENABLED=false and rebuild. The
// backend GroupsModule + apps/web group-* components + this flag are the whole footprint to delete
// if it's ever dropped permanently. Default: enabled.
export const GROUPS_ENABLED = process.env.NEXT_PUBLIC_GROUPS_ENABLED !== 'false';
