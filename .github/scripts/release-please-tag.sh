#!/usr/bin/env bash
# Prints the commit a tag points to, through a lightweight tag or one or
# more annotated tags, or nothing when the tag does not exist.
#
# Usage: release-please-tag.sh <tag>. Needs GH_TOKEN with
# `contents: read`, and GITHUB_REPOSITORY; it needs no clone. Fails on
# any error of the API other than a missing tag, and when the tag exists
# but does not lead to a commit (a tag of a tree or a blob): that tag is
# taken, so release-please could not tag the version anywhere else, and
# it is not an absent tag either.
#
# A Release reports the `target_commitish` it was created with even when
# its tag already existed elsewhere, in which case GitHub ignores that
# commit and keeps the tag where it is; so where a release is, is read
# from its tag.
set -euo pipefail

tag=${1:-}
if ! printf '%s' "$tag" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+$'; then
  echo "usage: release-please-tag.sh <X.Y.Z tag>" >&2
  exit 1
fi
repo="repos/$GITHUB_REPOSITORY"
error=$(mktemp "${RUNNER_TEMP:-${TMPDIR:-/tmp}}/release-please-tag.XXXXXX")
trap 'rm -f "$error"' EXIT

if ! object=$(gh api "$repo/git/ref/tags/$tag" \
  --jq '"\(.object.type) \(.object.sha)"' 2> "$error"); then
  if grep -q 'HTTP 404' "$error"; then
    exit 0
  fi
  cat "$error" >&2
  exit 1
fi
# Follows annotated tags to what they tag; git itself allows a tag of a
# tag. Ten levels is far more than any release here has.
depth=0
while [ "${object%% *}" = tag ] && [ "$depth" -lt 10 ]; do
  object=$(gh api "$repo/git/tags/${object#* }" \
    --jq '"\(.object.type) \(.object.sha)"')
  depth=$((depth + 1))
done
type=${object%% *}
sha=${object#* }
if [ "$type" != commit ]; then
  echo "The tag $tag exists but points to a $type, not to a commit" >&2
  exit 1
fi
if ! printf '%s' "$sha" | grep -Eq '^[0-9a-f]{40}$'; then
  echo "Could not read the commit of the tag $tag" >&2
  exit 1
fi
printf '%s\n' "$sha"
