#!/bin/sh
# Checks the live site the way a student and ChatGPT reach it, and prints one
# line per check. Exits 1 if any check still fails after its retries, and
# writes the failures (as markdown bullets) to $REPORT_FILE for the uptime
# workflow's issue. Safe to run by hand: it only makes ordinary requests.
#
#   SITE_URL        default https://app.campus-os.net
#   FALLBACK_URL    default https://campus-os-mocha-pi.vercel.app
#   RETRIES         tries per check, default 3 (a blip shouldn't page anyone)
#   SLEEP_BETWEEN   seconds between tries, default 10
#   MAX_TIME        seconds before one request gives up, default 15
#   REPORT_FILE     default uptime-report.md
set -u

SITE_URL=${SITE_URL:-https://app.campus-os.net}
FALLBACK_URL=${FALLBACK_URL:-https://campus-os-mocha-pi.vercel.app}
RETRIES=${RETRIES:-3}
SLEEP_BETWEEN=${SLEEP_BETWEEN:-10}
MAX_TIME=${MAX_TIME:-15}
REPORT_FILE=${REPORT_FILE:-uptime-report.md}

failed=0
: > "$REPORT_FILE"

# check NAME URL [extra curl args...]: passes when the URL answers 200.
check() {
  name=$1
  url=$2
  shift 2
  attempt=1
  code=000
  while [ "$attempt" -le "$RETRIES" ]; do
    code=$(curl -s -o /dev/null --max-time "$MAX_TIME" -w '%{http_code}' "$@" "$url" || true)
    if [ "$code" = 200 ]; then
      echo "ok    $name"
      return 0
    fi
    attempt=$((attempt + 1))
    if [ "$attempt" -le "$RETRIES" ]; then sleep "$SLEEP_BETWEEN"; fi
  done
  echo "FAIL  $name (HTTP $code)"
  echo "- $name: HTTP $code ($url)" >> "$REPORT_FILE"
  failed=1
}

check "Website" "$SITE_URL/login"
check "Database" "$SITE_URL/api/health"
check "ChatGPT connection" "$SITE_URL/mcp" -X POST -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"ping"}'

# When something is down, say whether the same app answers on its Vercel
# address: that tells a domain or DNS problem (like the Nov 5-14 hold at
# Squarespace) from a problem in the app itself.
if [ "$failed" = 1 ]; then
  fallback=$(curl -s -o /dev/null --max-time "$MAX_TIME" -w '%{http_code}' "$FALLBACK_URL/api/health" || true)
  echo "- For comparison, $FALLBACK_URL/api/health answers HTTP $fallback." >> "$REPORT_FILE"
  echo "info  fallback address answers HTTP $fallback"
fi

exit "$failed"
