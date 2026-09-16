#!/usr/bin/env bash
# HISTORICAL installer: do not use for the September recovery / fresh ARM64 VPS.
# Use DEPLOY-ORACLE-ARM64.md; this script assumes the previous release layout.
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
exec bash "$SCRIPT_DIR/install-main-batch1.sh" "$@"
