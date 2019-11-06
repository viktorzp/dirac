#!/usr/bin/env bash

# standard bash switches for our scripts
set -e -o pipefail

SPAWN_DIR=$(pwd)
SPAWN_COMMAND="$0"
SPAWN_ARGS="$@"

pushd "$(dirname "${BASH_SOURCE[0]}")" > /dev/null

source "lib/utils.sh"
source "lib/tools.sh"

cd ..

ROOT=$(pwd -P)
DIRAC_WORKSPACE_DIR=$(portable_realpath "$ROOT/..")
CHROMIUM_MIRROR_DIR=${CHROMIUM_MIRROR_DIR:-"$DIRAC_WORKSPACE_DIR/chromium-mirror"}
export DIRAC_CHROMIUM_MIRROR_DIR=${CHROMIUM_MIRROR_DIR}
DEVTOOLS_BRANCH="devtools"
DIFF_BRANCH="devtools-diff"
DEVTOOLS_DIRAC_PREFIX="resources/unpacked/devtools"
DEVTOOLS_ROOT="$ROOT/$DEVTOOLS_DIRAC_PREFIX"
DEVTOOLS_SCRIPTS="$DEVTOOLS_ROOT/scripts"
DIRAC_USER_PROFILE=${DIRAC_USER_PROFILE:-".profiles/dirac"}
DIRAC_USER_PROFILE2=${DIRAC_USER_PROFILE2:-".profiles/dirac-custom-devtools"}
DIRAC_BROWSER_TESTS_USER_PROFILE=".profiles/dirac-browser-tests"
DEVSERVER_ROOT="$DEVTOOLS_ROOT"
DEVSERVER_PORT=9000
RELEASES="$ROOT/releases"
RELEASE_BUILD="$ROOT/resources/release"
RELEASE_BUILD_COMPILED_BACKGROUND_JS="$RELEASE_BUILD/background.js"
RELEASE_BUILD_COMPILED_OPTIONS_JS="$RELEASE_BUILD/options.js"
RELEASE_BUILD_DEVTOOLS="$RELEASE_BUILD/devtools"
RELEASE_BUILD_DEVTOOLS_FRONTEND="$RELEASE_BUILD_DEVTOOLS/front_end"
CSS_PROPERTIES_OUTPUT_FILE="$DEVTOOLS_ROOT/front_end/SupportedCSSProperties.js"
INSPECTOR_BACKEND_COMMANDS_OUTPUT_FILE="$DEVTOOLS_ROOT/front_end/InspectorBackendCommands.js"
SCRIPTS="$ROOT/scripts"
DIFF_WORK_DIR="$DIRAC_WORKSPACE_DIR/diff-upstream"
PROJECT_VERSION_FILE="src/project/dirac/project.clj"
UNPACKED_MANIFEST_FILE="resources/unpacked/manifest.json"
RELEASE_MANIFEST_FILE="resources/release/manifest.json"
PROJECT_FILE="project.clj"
DEVTOOLS_WORKTREE="$DIRAC_WORKSPACE_DIR/devtools"
DEV_FIXTURES_SERVER_ROOT="$ROOT/test/browser/fixtures/resources"
DEV_FIXTURES_SERVER_PORT="9080"
DEV_DIRAC_EXTENSION_PATH="$ROOT/resources/unpacked"
DEV_MARION_EXTENSION_PATH="$ROOT/test/marion/resources/unpacked"
TMP_DIR="/tmp/dirac-tmp"
TEST_CANARY_FLAG_FILE="$TMP_DIR/canary-flag"
NOTIFY_DIR="$ROOT/.notify"
DIRAC_USE_CHROME=${DIRAC_USE_CHROME}
DIRAC_USE_CHROMIUM=${DIRAC_USE_CHROMIUM}
DIRAC_USE_CUSTOM_CHROME=${DIRAC_USE_CUSTOM_CHROME}
DIRAC_AGENT_PORT=${DIRAC_AGENT_PORT}
DIRAC_TEST_STAGE_DIR=${DIRAC_TEST_STAGE_DIR:-"$DIRAC_WORKSPACE_DIR/.test_stage"}
DIRAC_DOCKER_TEST_STAGE_DIR=${DIRAC_DOCKER_TEST_STAGE_DIR:-"$DIRAC_WORKSPACE_DIR/.docker_test_stage"}
DIRAC_TEST_STAGE_RSYNC_EXCLUDE_FILE="$ROOT/.test-stage-excludes"
ACTUAL_TRANSCRIPTS_PATH="test/browser/transcripts/_actual_"
EXPECTED_TRANSCRIPTS_PATH="test/browser/transcripts/expected"
DOCKER_TESTS_DIR="$ROOT/test/docker"
ROOT_TMP_DIR_RELATIVE=".tmp"
ROOT_TMP_DIR="$ROOT/$ROOT_TMP_DIR_RELATIVE"
TRAVIS_CHROMEDRIVER_VERSION=${TRAVIS_CHROMEDRIVER_VERSION:-VIA_CHROMIUM_DOWNLOAD_URL}
EXAMPLES_LEININGEN_PROJECT_FILE="examples/leiningen/project.clj"
EXAMPLES_FIGMAIN_DEPS_FILE="examples/figwheel-main/deps.edn"
DEPOT_DIR="$DIRAC_WORKSPACE_DIR/.depot"

popd
