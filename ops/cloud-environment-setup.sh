#!/bin/bash
# Paste this into the cloud environment's "Setup script" field at claude.ai/code.
# It runs as root before Claude Code starts and must exit 0 within about 5 minutes, after which
# the environment is cached. Steps that fail are non-fatal (|| true) so a session still starts.

# Node 24 and npm 12.2.0, to match the Civic Hub, CI and Vercel. Cloud VMs ship Node 22.
# `n` downloads from nodejs.org (on the default allowed list) and installs to /usr/local/bin.
npm install -g n >/dev/null 2>&1 && n 24 >/dev/null 2>&1 || true
/usr/local/bin/npm install -g npm@12.2.0 >/dev/null 2>&1 || true

# Playwright's Chromium and its system libraries, so e2e tests don't download per session.
# Needs cdn.playwright.dev and playwright.download.prss.microsoft.com on the allowed list.
npx -y playwright@1.64.1 install --with-deps chromium >/dev/null 2>&1 || true

# Supabase's Docker images, so `npx supabase start` in a session doesn't pull them each time.
# `start` needs a config.toml, hence the throwaway folder. Images come from public.ecr.aws.
# Capped (60 s + 150 s) so the script stays inside its time limit; if a cap is hit, sessions
# just pull what's missing. The pilot checks how long this takes. Keep the CLI version in step with package.json.
if docker info >/dev/null 2>&1; then
  ( cd "$(mktemp -d)" || exit 0
    timeout 60 npx -y supabase@2.121.0 init >/dev/null 2>&1 \
      && timeout 150 npx -y supabase@2.121.0 start >/dev/null 2>&1
    npx -y supabase@2.121.0 stop --no-backup >/dev/null 2>&1 ) || true
fi

exit 0
