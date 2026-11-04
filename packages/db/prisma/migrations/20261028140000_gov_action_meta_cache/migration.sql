-- Persistent cache of resolved CIP-108 gov-action metadata (immutable anchors) — survives restarts
-- and cuts IPFS gateway calls so the shared gateways stop rate-limiting the server.
CREATE TABLE "gov_action_meta" (
  "proposal_id" TEXT NOT NULL,
  "meta_url" TEXT,
  "json" JSONB NOT NULL,
  "fetched_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT "gov_action_meta_pkey" PRIMARY KEY ("proposal_id")
);
