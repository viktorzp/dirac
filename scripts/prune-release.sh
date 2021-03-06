#!/usr/bin/env bash

set -e -o pipefail
# shellcheck source=_config.sh
source "$(dirname "${BASH_SOURCE[0]}")/_config.sh"

set -x

cd "$RELEASE_BUILD"

rm -f "devtools/front_end/debug"
rm -f "devtools/front_end/dirac/.compiled"

find . -name ".DS_Store" -print -exec rm -rf {} \;
find . -name ".htaccess" -print -exec rm -rf {} \;
find . -depth -name '*runner' -type d -print -exec rm -rf {} \;

rm -f "devtools/front_end/Tests.js"
