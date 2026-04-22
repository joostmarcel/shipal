#!/usr/bin/env bash
set -euo pipefail

ENV_EXAMPLE=".env.example"
ENV_FILE=".env"

if [ ! -f "$ENV_EXAMPLE" ]; then
  echo "Error: $ENV_EXAMPLE not found. Run this from the project root."
  exit 1
fi

if [ -f "$ENV_FILE" ]; then
  read -rp ".env already exists. Overwrite? [y/N] " answer
  if [[ ! "$answer" =~ ^[Yy]$ ]]; then
    echo "Aborted."
    exit 0
  fi
fi

cp "$ENV_EXAMPLE" "$ENV_FILE"

# Generate cryptographic secrets
NEXTAUTH_SECRET=$(openssl rand -base64 32)
JWT_SECRET=$(openssl rand -base64 32)
API_KEY_HASH_SECRET=$(openssl rand -base64 32)
ENCRYPTION_KEY=$(openssl rand -base64 32)

# macOS vs Linux sed
if [[ "$(uname)" == "Darwin" ]]; then
  sed -i '' "s|^NEXTAUTH_SECRET=.*|NEXTAUTH_SECRET=$NEXTAUTH_SECRET|" "$ENV_FILE"
  sed -i '' "s|^JWT_SECRET=.*|JWT_SECRET=$JWT_SECRET|" "$ENV_FILE"
  sed -i '' "s|^API_KEY_HASH_SECRET=.*|API_KEY_HASH_SECRET=$API_KEY_HASH_SECRET|" "$ENV_FILE"
  sed -i '' "s|^ENCRYPTION_KEY=.*|ENCRYPTION_KEY=$ENCRYPTION_KEY|" "$ENV_FILE"
else
  sed -i "s|^NEXTAUTH_SECRET=.*|NEXTAUTH_SECRET=$NEXTAUTH_SECRET|" "$ENV_FILE"
  sed -i "s|^JWT_SECRET=.*|JWT_SECRET=$JWT_SECRET|" "$ENV_FILE"
  sed -i "s|^API_KEY_HASH_SECRET=.*|API_KEY_HASH_SECRET=$API_KEY_HASH_SECRET|" "$ENV_FILE"
  sed -i "s|^ENCRYPTION_KEY=.*|ENCRYPTION_KEY=$ENCRYPTION_KEY|" "$ENV_FILE"
fi

echo ""
echo "✓ .env created with random secrets"
echo ""
echo "Next steps:"
echo "  1. git submodule add https://github.com/teamyavio/yavio.git yavio"
echo "  2. docker compose up -d"
echo "  3. Open http://localhost:3000 to access the Yavio dashboard"
echo "  4. Create a workspace + project, then copy the API key"
echo "  5. Set YAVIO_API_KEY and YAVIO_ENDPOINT on your Cloud Run deploy"
