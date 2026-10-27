#!/usr/bin/env bash
# Creates the FIRST platform superadministrator of a deployment.
#
#   infra/deploy/bootstrap-superadmin.sh <email> [<env-file>] [<database-container>]
#
# Why a script: accounts are normally created through the platform's own flows (an invitation
# by e-mail), and a brand-new deployment has neither a superadministrator to invite from nor,
# yet, an SMTP server. This creates the account directly in Supabase Auth with a random
# password and registers it in public.platform_superadmins.
#
#  - The password is written to deploy-secrets/superadmin-<email>.txt (owner-only) and NEVER
#    printed. Sign in with it once at <app>/acceso; the platform then asks you to enrol an
#    authenticator (second factor) and you should change the password. Delete the file after.
#  - It needs the production env file (deploy-secrets/production.env) for the public Supabase
#    address and the server key, and Docker access to the database container.
#  - Running it again for the same e-mail does not create a second account.
set -euo pipefail
export MSYS_NO_PATHCONV=1

EMAIL=${1:?usage: bootstrap-superadmin.sh <email> [env-file] [db-container]}
ENV_FILE=${2:-deploy-secrets/production.env}
DB_CONTAINER=${3:-}
cd "$(dirname "$0")/../.."

case "$EMAIL" in *@*.*) ;; *) echo "that does not look like an e-mail" >&2; exit 1 ;; esac
get() { grep -m1 "^$1=" "$ENV_FILE" | cut -d= -f2-; }
SUPABASE_URL=$(get NEXT_PUBLIC_SUPABASE_URL)
SECRET_KEY=$(get SUPABASE_SECRET_KEY)
[ -n "$SUPABASE_URL" ] && [ -n "$SECRET_KEY" ] || { echo "$ENV_FILE lacks the Supabase address or key" >&2; exit 1; }

# Where Docker runs (Coolify's engine lives in WSL on Windows).
docker_cmd() { if [ -n "${DOCKER_WSL_DISTRO:-}" ]; then wsl -d "$DOCKER_WSL_DISTRO" -- docker "$@"; else docker "$@"; fi; }
if [ -z "$DB_CONTAINER" ]; then
  DB_CONTAINER=$(docker_cmd ps --format '{{.Names}}' | grep -E '^db-' | head -1)
fi
[ -n "$DB_CONTAINER" ] || { echo "database container not found (pass it as the 3rd argument)" >&2; exit 1; }
psql_db() { docker_cmd exec -i "$DB_CONTAINER" psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -At "$@"; }

PASSWORD="Sa-$(head -c 18 /dev/urandom | base64 | tr -d '/+=\n' | head -c 20)"
BODY=$(printf '{"email":"%s","password":"%s","email_confirm":true}' "$EMAIL" "$PASSWORD")

existing=$(psql_db -c "select id from auth.users where lower(email) = lower('${EMAIL//\'/}')" </dev/null)
if [ -n "$existing" ]; then
  USER_ID=$existing
  echo "the account already exists; its password is NOT changed"
  NEW=0
else
  # LOCAL_PROXY=1 talks to the proxy on this machine with the public name as the Host header:
  # useful before the DNS / tunnel for that name exists.
  if [ "${LOCAL_PROXY:-0}" = "1" ]; then
    public_host=${SUPABASE_URL#https://}
    endpoint="http://127.0.0.1/auth/v1/admin/users"
    host_header=(-H "Host: ${public_host%%/*}")
  else
    endpoint="$SUPABASE_URL/auth/v1/admin/users"
    host_header=()
  fi
  response=$(curl -sS -m 30 -X POST "$endpoint" "${host_header[@]}" \
    -H "apikey: $SECRET_KEY" -H "Authorization: Bearer $SECRET_KEY" \
    -H "Content-Type: application/json" -d "$BODY")
  USER_ID=$(printf '%s' "$response" | sed -n 's/.*"id":"\([0-9a-f-]\{36\}\)".*/\1/p' | head -1)
  [ -n "$USER_ID" ] || { echo "Supabase Auth refused the account (is $SUPABASE_URL reachable?)" >&2; exit 1; }
  NEW=1
fi

psql_db -c "insert into public.platform_superadmins (user_id) values ('$USER_ID') on conflict do nothing" </dev/null >/dev/null
echo "superadmin registered: $EMAIL"

if [ "$NEW" = "1" ]; then
  umask 077
  FILE="deploy-secrets/superadmin-${EMAIL//[^A-Za-z0-9._@-]/_}.txt"
  printf 'email: %s\npassword: %s\n' "$EMAIL" "$PASSWORD" > "$FILE"
  echo "password saved to $FILE (not printed). Sign in at $(get NEXT_PUBLIC_APP_URL)/acceso, enrol the authenticator and change it."
fi
