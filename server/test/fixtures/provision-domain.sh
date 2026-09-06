#!/usr/bin/env bash
# Fixture provisioning script — echoes its argv (so tests can assert the exact
# argument order/values the server passes), exit code from $EZ_PROVISION_EXIT.
set -u
echo "provisioned ${1:-} for ${2:-}"
exit "${EZ_PROVISION_EXIT:-0}"