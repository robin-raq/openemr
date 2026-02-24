#!/bin/bash
# One-time setup: Register OAuth2 client with OpenEMR Docker
# Run with: ./scripts/register-oauth-client.sh
# Requires: OpenEMR Docker running at https://localhost:9300

set -e

BASE_URL="${OPENEMR_BASE_URL:-https://localhost:9300}"
REG_URL="${BASE_URL}/oauth2/default/registration"

echo "Registering OAuth2 client with OpenEMR at ${REG_URL}"
echo ""

RESP=$(curl -s -k -X POST "${REG_URL}" \
  -H 'Content-Type: application/json' \
  -d '{
    "client_name": "AgentForge",
    "scope": "openid api:oemr api:fhir user/Patient.read user/MedicationRequest.read user/Observation.read user/AllergyIntolerance.read user/Condition.read"
  }')

echo "$RESP" | head -c 500
echo ""
echo ""

CLIENT_ID=$(echo "$RESP" | grep -o '"client_id"[[:space:]]*:[[:space:]]*"[^"]*"' | cut -d'"' -f4)
CLIENT_SECRET=$(echo "$RESP" | grep -o '"client_secret"[[:space:]]*:[[:space:]]*"[^"]*"' | cut -d'"' -f4)

if [ -n "$CLIENT_ID" ]; then
  echo ""
  echo "Add to your .env:"
  echo "  FHIR_CLIENT_ID=${CLIENT_ID}"
  [ -n "$CLIENT_SECRET" ] && echo "  FHIR_CLIENT_SECRET=${CLIENT_SECRET}"
  echo ""
  echo "Then set DATA_SOURCE=fhir and restart the server."
else
  echo "Could not parse client_id from response. Check the output above."
  exit 1
fi
