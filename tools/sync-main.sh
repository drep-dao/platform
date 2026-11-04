#!/usr/bin/env bash
#
# KI-3 — sync a feature-branch commit onto `main` without the error-prone manual dance
# (checkout main, cherry-pick, push, checkout back). Codifies exactly the steps we do by hand.
#
#   tools/sync-main.sh                # cherry-pick the TIP of the current (feature) branch onto main
#   tools/sync-main.sh <commit-ish>   # cherry-pick that single commit
#   tools/sync-main.sh <a>..<b>       # cherry-pick a range (oldest-first, inclusive of b, exclusive of a)
#
# Behaviour:
#   • refuses to run with a dirty working tree (so nothing uncommitted is lost),
#   • pushes the feature branch first, then applies the SAME commit(s) to main and pushes,
#   • always returns you to the branch you started on, even on failure,
#   • on a cherry-pick conflict it aborts cleanly and tells you to resolve by hand.
#
# It deliberately does NOT touch the public mirror or the funding edition — those are separate
# repos and whether a change is edition-wide is a judgement call (see KNOWN_ISSUES KI-3). Propagate
# those yourself after this succeeds.
set -euo pipefail

TARGET="main"
REMOTE="origin"

start_branch=$(git rev-parse --abbrev-ref HEAD)
if [[ "$start_branch" == "$TARGET" ]]; then
  echo "✗ You are on '$TARGET'. Run this from the feature branch you want to sync FROM." >&2
  exit 1
fi

if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "✗ Working tree is not clean — commit or stash first (refusing to risk uncommitted work)." >&2
  exit 1
fi

# What to cherry-pick: an explicit arg, or the tip of the current branch.
spec="${1:-$start_branch~1..$start_branch}"
# A bare commit-ish (no range) → make it a one-commit range so `cherry-pick` takes exactly it.
if [[ "$spec" != *..* ]]; then
  spec="$spec~1..$spec"
fi

commits=$(git rev-list --reverse "$spec")
if [[ -z "$commits" ]]; then
  echo "✗ No commits selected by '$spec'." >&2
  exit 1
fi

echo "— will sync these commit(s) onto '$TARGET':"
git --no-pager log --oneline "$spec" | sed 's/^/    /'

cleanup() { git checkout -q "$start_branch" 2>/dev/null || true; }
trap cleanup EXIT

echo "— pushing '$start_branch'…"
git push "$REMOTE" "$start_branch"

echo "— updating '$TARGET'…"
git checkout -q "$TARGET"
git pull -q --ff-only "$REMOTE" "$TARGET" || { echo "✗ '$TARGET' is not fast-forwardable — reconcile it first." >&2; exit 1; }

for c in $commits; do
  if ! git cherry-pick -x "$c"; then
    echo "✗ Conflict cherry-picking $c. Resolve it, 'git cherry-pick --continue', push '$TARGET', then re-run for the rest." >&2
    git cherry-pick --abort 2>/dev/null || true
    exit 1
  fi
done

git push "$REMOTE" "$TARGET"
echo "✓ Synced onto '$TARGET' and pushed. (Mirror / funding edition are NOT touched — propagate those by hand.)"
