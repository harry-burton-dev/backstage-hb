#!/bin/sh
# Makes (or updates) the `backstage` client in the workbench AUGUR's Keycloak, realm "platform",
# and prints its secret for deploy/.env. Run it on the server, from this folder:
#   ./keycloak-client.sh <AUGUR's folder> <BACKSTAGE_URL>
# It signs in to Keycloak's admin console with KEYCLOAK_ADMIN_USER and KEYCLOAK_ADMIN_PASSWORD from AUGUR's .env.
set -eu
augur=${1:?usage: keycloak-client.sh <AUGUR folder, e.g. /opt/stacks/augur/infra/deploy> <BACKSTAGE_URL>}
url=${2:?usage: keycloak-client.sh <AUGUR folder> <BACKSTAGE_URL>}
url=${url%/}
password=$(grep '^KEYCLOAK_ADMIN_PASSWORD=' "$augur/.env" | cut -d= -f2-)
user=$(grep '^KEYCLOAK_ADMIN_USER=' "$augur/.env" | cut -d= -f2-)
user=${user:-keycloak-admin}
[ -n "$password" ] || { echo "No KEYCLOAK_ADMIN_PASSWORD in $augur/.env" >&2; exit 1; }
kc() { docker compose --project-directory "$augur" exec -T keycloak /opt/keycloak/bin/kcadm.sh "$@"; }

kc config credentials --server http://localhost:8080/sso --realm master --user "$user" --password "$password" >/dev/null
id=$(kc get clients -r platform -q clientId=backstage --fields id --format csv --noquotes | head -n 1)
settings="-s enabled=true -s protocol=openid-connect -s publicClient=false -s standardFlowEnabled=true -s directAccessGrantsEnabled=false -s serviceAccountsEnabled=false -s redirectUris=[\"$url/api/auth/oidc/handler/frame\"] -s webOrigins=[\"$url\"] -s rootUrl=$url"
if [ -z "$id" ]; then
  # shellcheck disable=SC2086
  kc create clients -r platform -s clientId=backstage -s name=Backstage $settings >/dev/null
  id=$(kc get clients -r platform -q clientId=backstage --fields id --format csv --noquotes | head -n 1)
  echo "Made the backstage client." >&2
else
  # shellcheck disable=SC2086
  kc update "clients/$id" -r platform $settings
  echo "Updated the backstage client." >&2
fi
secret=$(kc get "clients/$id/client-secret" -r platform --fields value --format csv --noquotes)
echo "OIDC_CLIENT_SECRET=$secret"
