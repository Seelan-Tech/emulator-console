#!/usr/bin/env bash
# Does the Dockerfile's base image have the libpam fix yet (CVE-2025-6020)? Until it does, the Dockerfile carries a layer
# that upgrades libpam itself; once it does, that layer can be deleted.
#
#   scripts/check-base-image.sh [image] [fixed-version]
#
# Exit codes: 0 the image has the fix, 1 not yet, 2 the check could not run, 3 the workaround is gone (nothing to watch).
# The workflow .github/workflows/base-image-watch.yml runs it daily.
set -uo pipefail
cd "$(dirname "$0")/.."

dockerfile="${DOCKERFILE:-Dockerfile}"
if ! grep -q "CVE-2025-6020" "$dockerfile"; then
  echo "The libpam workaround is no longer in $dockerfile: nothing to watch"
  exit 3
fi
image="${1:-$(grep -E '^FROM node:' "$dockerfile" | tail -1 | awk '{print $2}')}"
fixed="${2:-1.5.2-6+deb12u3}"
if [ -z "$image" ]; then
  echo "Could not find the runtime base image in $dockerfile" >&2
  exit 2
fi

docker pull -q "$image" >/dev/null || { echo "Could not pull $image" >&2; exit 2; }
have="$(docker run --rm --entrypoint dpkg-query "$image" -W -f='${Version}' libpam0g)" \
  || { echo "Could not read the libpam0g version in $image" >&2; exit 2; }
# dpkg itself compares Debian versions (a plain string comparison gets deb12u10 wrong)
if docker run --rm --entrypoint dpkg "$image" --compare-versions "$have" ge "$fixed"; then
  echo "$image has libpam0g $have (fixed in $fixed): the workaround layer can go"
  exit 0
fi
echo "$image still has libpam0g $have (fixed in $fixed)"
exit 1
