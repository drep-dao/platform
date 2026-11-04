// §2.1 — resolve the profile photo shown next to a user on comments, votes and authored documents.
// Precedence: the account's own uploaded avatar (set via the Viewer profile) wins, then a role photo
// the user already uploaded (DRep photo → Expert logo → Submitter logo). Null = use the generated
// placeholder on the web. Callers pass whatever of these relations they loaded; missing ones are
// simply skipped.
export function resolveAvatar(u: {
  avatarDataUrl?: string | null;
  photo?: string | null; // when the subject IS a Drep row (e.g. a voter)
  drep?: { photo?: string | null } | null;
  experts?: { logoDataUrl?: string | null }[] | null;
  submitterApplication?: { logoDataUrl?: string | null } | null;
}): string | null {
  return (
    u.avatarDataUrl ??
    u.photo ??
    u.drep?.photo ??
    u.experts?.find((e) => e.logoDataUrl)?.logoDataUrl ??
    u.submitterApplication?.logoDataUrl ??
    null
  );
}
