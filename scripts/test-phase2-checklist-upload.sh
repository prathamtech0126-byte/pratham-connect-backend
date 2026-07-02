#!/usr/bin/env bash
set -euo pipefail

# Phase 2 API smoke test (checklist assignment + client uploads)
# Usage:
#   chmod +x scripts/test-phase2-checklist-upload.sh
#   BASE_URL=http://localhost:5000 ./scripts/test-phase2-checklist-upload.sh
#
# Required env vars:
# - COUNSELLOR_EMAIL
# - COUNSELLOR_PASSWORD
# - CLIENT_LOGIN_ID
# - CLIENT_PASSWORD
# - CLIENT_ID
# - TEST_FILE_PATH
#
# Optional:
# - CHECKLIST_ID / CHECKLIST_ITEM_ID (auto-loaded from DB when omitted)
# - CHECKLIST_SLUG (default: visitor-visa-checklist-canada)
# - VISA_TYPE / COUNTRY (auto-loaded from DB when checklist IDs are resolved)
# - BASE_URL (default: http://localhost:5000)

BASE_URL="${BASE_URL:-http://localhost:5000}"
CHECKLIST_SLUG="${CHECKLIST_SLUG:-visitor-visa-checklist-canada}"

require_var() {
  local name="$1"
  if [[ -z "${!name:-}" ]]; then
    echo "Missing env var: $name"
    exit 1
  fi
}

require_var COUNSELLOR_EMAIL
require_var COUNSELLOR_PASSWORD
require_var CLIENT_LOGIN_ID
require_var CLIENT_PASSWORD
require_var CLIENT_ID
require_var TEST_FILE_PATH

if [[ -z "${CHECKLIST_ID:-}" || -z "${CHECKLIST_ITEM_ID:-}" ]]; then
  echo "Resolving checklist IDs from database (slug: $CHECKLIST_SLUG)..."
  script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  repo_root="$(cd "$script_dir/.." && pwd)"
  resolved_ids="$(
    cd "$repo_root" && CHECKLIST_SLUG="$CHECKLIST_SLUG" npx ts-node scripts/resolve-phase2-checklist-ids.ts 2>/dev/null \
      | grep -E '^(CHECKLIST_ID|CHECKLIST_ITEM_ID|VISA_TYPE|COUNTRY)='
  )"
  eval "$resolved_ids"
  echo "   CHECKLIST_ID=$CHECKLIST_ID"
  echo "   CHECKLIST_ITEM_ID=$CHECKLIST_ITEM_ID"
  echo "   VISA_TYPE=$VISA_TYPE"
  echo "   COUNTRY=$COUNTRY"
fi

require_var CHECKLIST_ID
require_var CHECKLIST_ITEM_ID
VISA_TYPE="${VISA_TYPE:-visitor}"
COUNTRY="${COUNTRY:-canada}"

if [[ ! -f "$TEST_FILE_PATH" ]]; then
  echo "File not found: $TEST_FILE_PATH"
  exit 1
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "jq is required for this script."
  exit 1
fi

tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

COUNSELLOR_COOKIE_JAR="$tmp_dir/counsellor.cookies.txt"
CLIENT_COOKIE_JAR="$tmp_dir/client.cookies.txt"

echo "1) Counsellor login..."
COUNSELLOR_LOGIN_RESP="$tmp_dir/counsellor.login.json"
curl -sS -X POST "$BASE_URL/api/users/login" \
  -H "Content-Type: application/json" \
  -c "$COUNSELLOR_COOKIE_JAR" \
  -d "{
    \"email\": \"$COUNSELLOR_EMAIL\",
    \"password\": \"$COUNSELLOR_PASSWORD\"
  }" > "$COUNSELLOR_LOGIN_RESP"

COUNSELLOR_TOKEN="$(jq -r '.accessToken // empty' "$COUNSELLOR_LOGIN_RESP")"
COUNSELLOR_CSRF="$(jq -r '.csrfToken // empty' "$COUNSELLOR_LOGIN_RESP")"

if [[ -z "$COUNSELLOR_TOKEN" ]]; then
  echo "Counsellor login failed:"
  cat "$COUNSELLOR_LOGIN_RESP"
  exit 1
fi
echo "   Counsellor login OK"

echo "2) Assign checklist to client..."
ASSIGN_RESP="$tmp_dir/assign.json"
curl -sS -X POST "$BASE_URL/api/client-documents/assignments" \
  -H "Authorization: Bearer $COUNSELLOR_TOKEN" \
  -H "X-CSRF-Token: $COUNSELLOR_CSRF" \
  -H "Content-Type: application/json" \
  -b "$COUNSELLOR_COOKIE_JAR" \
  -d "{
    \"clientId\": $CLIENT_ID,
    \"checklistId\": \"$CHECKLIST_ID\",
    \"visaType\": \"$VISA_TYPE\",
    \"country\": \"$COUNTRY\"
  }" > "$ASSIGN_RESP"

ASSIGNMENT_ID="$(jq -r '.data.id // empty' "$ASSIGN_RESP")"
if [[ -z "$ASSIGNMENT_ID" ]]; then
  echo "Checklist assignment failed:"
  cat "$ASSIGN_RESP"
  exit 1
fi
echo "   Assignment created: $ASSIGNMENT_ID"

echo "3) Counsellor fetch assignment list..."
curl -sS -X GET "$BASE_URL/api/client-documents/assignments/$CLIENT_ID" \
  -H "Authorization: Bearer $COUNSELLOR_TOKEN" \
  -H "X-CSRF-Token: $COUNSELLOR_CSRF" \
  -b "$COUNSELLOR_COOKIE_JAR" | jq .

echo "4) Client portal login..."
CLIENT_LOGIN_RESP="$tmp_dir/client.login.json"
curl -sS -X POST "$BASE_URL/api/client-portal/login" \
  -H "Content-Type: application/json" \
  -c "$CLIENT_COOKIE_JAR" \
  -d "{
    \"loginId\": \"$CLIENT_LOGIN_ID\",
    \"password\": \"$CLIENT_PASSWORD\"
  }" > "$CLIENT_LOGIN_RESP"

CLIENT_ACCESS_TOKEN="$(jq -r '.accessToken // empty' "$CLIENT_LOGIN_RESP")"
CLIENT_CSRF="$(jq -r '.csrfToken // empty' "$CLIENT_LOGIN_RESP")"
if [[ -z "$CLIENT_ACCESS_TOKEN" ]]; then
  echo "Client login failed:"
  cat "$CLIENT_LOGIN_RESP"
  exit 1
fi
echo "   Client login OK"

echo "5) Client fetch assigned checklists..."
curl -sS -X GET "$BASE_URL/api/client-portal/checklists" \
  -H "Authorization: Bearer $CLIENT_ACCESS_TOKEN" \
  -H "X-CSRF-Token: $CLIENT_CSRF" \
  -b "$CLIENT_COOKIE_JAR" | jq .

echo "6) Client fetch storage usage..."
curl -sS -X GET "$BASE_URL/api/client-portal/storage-usage" \
  -H "Authorization: Bearer $CLIENT_ACCESS_TOKEN" \
  -H "X-CSRF-Token: $CLIENT_CSRF" \
  -b "$CLIENT_COOKIE_JAR" | jq .

echo "7) Client upload checklist document..."
UPLOAD_RESP="$tmp_dir/upload.json"
curl -sS -X POST "$BASE_URL/api/client-portal/checklists/upload" \
  -H "Authorization: Bearer $CLIENT_ACCESS_TOKEN" \
  -H "X-CSRF-Token: $CLIENT_CSRF" \
  -b "$CLIENT_COOKIE_JAR" \
  -F "assignmentId=$ASSIGNMENT_ID" \
  -F "checklistItemId=$CHECKLIST_ITEM_ID" \
  -F "file=@$TEST_FILE_PATH" > "$UPLOAD_RESP"

echo "   Upload response:"
jq . "$UPLOAD_RESP"

echo
echo "All Phase 2 API calls executed."
