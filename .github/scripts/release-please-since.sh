#!/usr/bin/env bash
# Prints the commits release-please reads for the release pull request,
# oldest first, one SHA per line: those after the last release, which is
# the tag of the version in the manifest. Right after a release pull
# request has merged, that tag may not exist yet; the release step
# creates it on the merge commit, which is also the last commit to change
# the manifest, so the commits after that one are printed instead. Every
# parent is followed, as release-please's history query does.
#
# release-please itself does not fall back that way: with no Release and
# no tag of the manifest's version, it reads back through the history
# well past the last manifest change. So whoever runs release-please
# after this must check that the tag exists by then, on the commit this
# printed as the boundary; `--require-tag` makes this script fail instead
# of falling back, for a read made after tagging.
#
# Usage: release-please-since.sh [--require-tag] [--last FILE] > shas, run
# at the root of a clone of the commit in question with every tag
# (`fetch-depth: 0`). `--last` writes the boundary commit to FILE.
# Progress goes to standard error.
set -euo pipefail

require_tag=false
last_file=""
while [ "$#" -gt 0 ]; do
  case $1 in
    --require-tag) require_tag=true ;;
    --last) last_file=${2:?--last needs a file}; shift ;;
    *) echo "unknown argument: $1" >&2; exit 1 ;;
  esac
  shift
done

version=$(jq -r '."."' .release-please-manifest.json)
if ! printf '%s' "$version" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+$'; then
  echo "::error::.release-please-manifest.json holds no X.Y.Z version" >&2
  exit 1
fi
if last=$(git rev-parse -q --verify "refs/tags/$version^{commit}"); then
  echo "The last release is $version, on $last." >&2
elif [ "$require_tag" = true ]; then
  echo "::error::The tag $version of the manifest's version does not" \
    "exist, so release-please reads the history beyond the last" \
    "release." >&2
  exit 1
else
  last=$(git rev-list -1 --first-parent HEAD -- .release-please-manifest.json)
  if [ -z "$last" ]; then
    echo "::error::Found neither the tag $version nor a commit that" \
      "changed .release-please-manifest.json" >&2
    exit 1
  fi
  echo "The tag $version does not exist yet; reading the commits after" \
    "$last, which set the manifest to it." >&2
fi
[ -z "$last_file" ] || printf '%s\n' "$last" > "$last_file"
shas=$(git rev-list --reverse HEAD "^$last")
echo "$(printf '%s' "$shas" | grep -c . || true) commit(s) since then." >&2
[ -z "$shas" ] || printf '%s\n' "$shas"
