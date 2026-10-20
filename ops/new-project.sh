#!/usr/bin/env bash
# Create the isolated pieces for a new greenfield project. Run in your Mac's Terminal, never
# inside a Claude session: it uses your broad GitHub, Supabase and Vercel logins.
#
#   greenfield-starter/ops/new-project.sh <project-name>
#
# It asks before every step, so you can stop at any point and finish by hand.
# Requires: gh, supabase, vercel, jq, openssl, perl, logged in to each
# (gh auth login, supabase login, vercel login).
#
# Settings you can override with environment variables:
#   GH_OWNER        GitHub owner for the new repo     (default: Mosaic-Foundation)
#   TEMPLATE        template repo                     (default: $GH_OWNER/greenfield-starter)
#   VISIBILITY      public | private                  (default: public; rulesets on private repos
#                                                      need a paid GitHub plan)
#   VERCEL_SCOPE    Vercel team slug                  (default: the CLI's active team, shown by
#                                                      'vercel whoami'; change it with 'vercel switch')
#   SUPABASE_REGION Supabase region                   (default: us-east-1)
#   MONO            path to Civic-Social-Mono         (default: ~/Developer/Civic-Social-Mono)

set -euo pipefail

NAME="${1:-}"
if ! printf '%s' "$NAME" | grep -Eq '^[a-z0-9][a-z0-9-]*$'; then
  echo "Usage: $0 <project-name>   (lowercase letters, digits and hyphens, e.g. mosaic-river)" >&2
  exit 1
fi

GH_OWNER="${GH_OWNER:-Mosaic-Foundation}"
TEMPLATE="${TEMPLATE:-$GH_OWNER/greenfield-starter}"
VISIBILITY="${VISIBILITY:-public}"
VERCEL_SCOPE="${VERCEL_SCOPE:-}"
SUPABASE_REGION="${SUPABASE_REGION:-us-east-1}"
MONO="${MONO:-$HOME/Developer/Civic-Social-Mono}"
REPO="$GH_OWNER/$NAME"
# Clone next to the template checkout, never inside it.
WORKDIR="$(cd "$(dirname "$0")/../.." && pwd)"
DIR="$WORKDIR/$NAME"

step() { printf '\n== %s ==\n' "$1"; }
confirm() {
  local answer
  read -r -p "$1 [y/N] " answer
  [ "$answer" = "y" ] || [ "$answer" = "Y" ]
}
# Print the ref of the Supabase project with this name, or nothing. Never fails, so a CLI that
# doesn't print JSON falls through to the paste prompt instead of stopping the script.
project_ref() {
  { supabase projects list --output-format json 2>/dev/null \
      || supabase projects list -o json 2>/dev/null || true; } \
    | jq -r --arg n "$1" '[.[] | select(.name == $n)][0] | (.ref // .id // empty)' 2>/dev/null \
    || true
}

step "0. Check tools and logins"
for tool in gh supabase vercel jq openssl perl; do
  command -v "$tool" >/dev/null 2>&1 || { echo "Missing: $tool. Install it and run again." >&2; exit 1; }
done
gh auth status >/dev/null 2>&1 || { echo "Run: gh auth login" >&2; exit 1; }
gh api "repos/$TEMPLATE" --jq '.is_template' 2>/dev/null | grep -q true \
  || { echo "$TEMPLATE is not marked as a template repo. See One-time setup in the runbook." >&2; exit 1; }
echo "Repo:     $REPO ($VISIBILITY) from template $TEMPLATE, cloned to $DIR"
echo "Vercel:   project $NAME in team ${VERCEL_SCOPE:-(the active team below)}"
[ -n "$VERCEL_SCOPE" ] || vercel whoami 2>&1 | sed 's/^/          /' || true
echo "Supabase: project $NAME-dev in $SUPABASE_REGION"
confirm "Continue with these settings?" || exit 0

# ---------------------------------------------------------------------------------------------
step "1. Create the GitHub repo from the template"
# Every step checks for what an earlier run already made, so the script is safe to run again
# after a failure (answer y to the steps that didn't finish).
if confirm "Create $REPO and clone it into $DIR?"; then
  if gh api "repos/$REPO" >/dev/null 2>&1; then
    echo "$REPO already exists; not creating it."
  else
    gh repo create "$REPO" --template "$TEMPLATE" "--$VISIBILITY"
  fi
  # GitHub generates template repos asynchronously; wait until the first commit exists.
  for _ in $(seq 1 30); do
    gh api "repos/$REPO/commits?per_page=1" >/dev/null 2>&1 && break
    sleep 2
  done
  if [ -d "$DIR/.git" ]; then
    echo "$DIR already exists; not cloning."
  else
    ( cd "$WORKDIR" && gh repo clone "$REPO" )
  fi
fi
[ -d "$DIR/.git" ] || { echo "No local clone at $DIR; stopping." >&2; exit 1; }

# ---------------------------------------------------------------------------------------------
step "1b. Name the app, fill in the repo, vendor the design system (pushed before protection)"
DS="$MONO/shared/design-system/src"
if confirm "Rename the app to $NAME, write $REPO into the rules, copy the design system from $DS?"; then
  ( cd "$DIR"
    perl -pi -e "s/\"greenfield-app-ui\"/\"$NAME-ui\"/; s/\"greenfield-app\"/\"$NAME\"/" \
      package.json ui/package.json
    perl -pi -e "s/\"name\": \"greenfield-app\"/\"name\": \"$NAME\"/" package-lock.json
    perl -pi -e "s/\"name\": \"greenfield-app-ui\"/\"name\": \"$NAME-ui\"/" ui/package-lock.json
    perl -pi -e "s#<title>App</title>#<title>$NAME</title>#" ui/index.html
    perl -pi -e "s#__REPO__#$REPO#g" CLAUDE.md .claude/settings.json .claude/skills/finish-task/SKILL.md
    if [ -d "$DS" ]; then
      mkdir -p ui/src/styles/design-system
      cp "$DS/tokens.css" "$DS/base.css" "$DS/components.css" ui/src/styles/design-system/
      perl -pi -e 's#^/\* (\@import "\./design-system/[a-z]+\.css";) \*/#$1#' ui/src/styles/theme.css
    else
      echo "Design system not found at $DS; skipping. Set MONO=<path> to point at Civic-Social-Mono."
    fi
    git add -A
    if git diff --cached --quiet; then
      echo "Nothing to change; an earlier run already did this."
    else
      git commit -m "Setup: name the app $NAME, fill in the repo, vendor the design system"
      git push origin main
    fi )
fi

# ---------------------------------------------------------------------------------------------
step "2. Repo settings: squash merges only, delete merged branches, read-only workflow token, label"
if confirm "Apply these settings to $REPO?"; then
  gh repo edit "$REPO" \
    --enable-squash-merge \
    --enable-merge-commit=false \
    --enable-rebase-merge=false \
    --delete-branch-on-merge
  gh api -X PUT "repos/$REPO/actions/permissions/workflow" \
    -f default_workflow_permissions=read -F can_approve_pull_request_reviews=false
  gh label create needs-adam --repo "$REPO" --color D93F0B \
    --description "Waiting on Adam: schema, auth, ADR, CI, settings, paid service or data source" \
    2>/dev/null || echo "(label already exists)"
fi

# ---------------------------------------------------------------------------------------------
step "3. Ruleset on main: PR required, ci must pass from GitHub Actions, no force push or deletion"
if gh api "repos/$REPO/rulesets" --jq '.[].name' 2>/dev/null | grep -qx 'protect main'; then
  echo "The ruleset already exists: https://github.com/$REPO/settings/rules"
elif confirm "Create the ruleset?"; then
  gh api -X POST "repos/$REPO/rulesets" --input - <<'JSON'
{
  "name": "protect main",
  "target": "branch",
  "enforcement": "active",
  "conditions": { "ref_name": { "include": ["refs/heads/main"], "exclude": [] } },
  "rules": [
    { "type": "deletion" },
    { "type": "non_fast_forward" },
    { "type": "pull_request",
      "parameters": {
        "required_approving_review_count": 0,
        "dismiss_stale_reviews_on_push": false,
        "require_code_owner_review": false,
        "require_last_push_approval": false,
        "required_review_thread_resolution": false
      } },
    { "type": "required_status_checks",
      "parameters": {
        "strict_required_status_checks_policy": true,
        "required_status_checks": [ { "context": "ci", "integration_id": 15368 } ]
      } }
  ]
}
JSON
  echo "Ruleset created. Check it at https://github.com/$REPO/settings/rules"
fi

# ---------------------------------------------------------------------------------------------
step "4. Supabase dev project, with its secrets in a main-only GitHub environment"
REF="$(project_ref "$NAME-dev")"
ORG_ID=""
if [ -n "$REF" ]; then
  echo "Supabase project $NAME-dev already exists (ref $REF); not creating it."
  echo "If an earlier run stopped before storing its secrets, reset the database password in the"
  echo "dashboard, then run:"
  echo "  gh secret set SUPABASE_DB_PASSWORD --repo $REPO --env supabase-dev"
  echo "  gh variable set SUPABASE_PROJECT_REF --repo $REPO --body $REF"
  echo "and create the supabase-dev environment and scoped token as in the runbook."
else
  echo "Use a Supabase organization that holds only this project's dev database."
  echo "Your organizations:"
  supabase orgs list || true
  read -r -p "Organization ID to create $NAME-dev in (blank to skip this step): " ORG_ID
fi
if [ -n "$ORG_ID" ] && confirm "Create Supabase project $NAME-dev in org $ORG_ID?"; then
  DB_PASSWORD="$(openssl rand -base64 30 | tr -d '/+=' | cut -c1-32)"
  supabase projects create "$NAME-dev" --org-id "$ORG_ID" --db-password "$DB_PASSWORD" \
    --region "$SUPABASE_REGION"
  REF="$(project_ref "$NAME-dev")"
  if [ -z "$REF" ]; then
    read -r -p "Couldn't read the project ref. Paste it from the dashboard URL: " REF
  fi
  echo "Project ref: $REF"

  echo "Creating the supabase-dev environment, deployable only from main."
  gh api -X PUT "repos/$REPO/environments/supabase-dev" --input - <<'JSON'
{ "deployment_branch_policy": { "protected_branches": false, "custom_branch_policies": true } }
JSON
  gh api -X POST "repos/$REPO/environments/supabase-dev/deployment-branch-policies" \
    -f name=main -f type=branch >/dev/null

  printf '%s' "$DB_PASSWORD" | gh secret set SUPABASE_DB_PASSWORD --repo "$REPO" --env supabase-dev
  gh variable set SUPABASE_PROJECT_REF --repo "$REPO" --body "$REF"
  unset DB_PASSWORD
  echo "The database password now lives only in the GitHub environment and Supabase. Reset it in"
  echo "the dashboard if you ever need it yourself."

  echo
  echo "Now create a Supabase access token limited to this one project:"
  echo "  https://supabase.com/dashboard/account/tokens  > scoped token > project $NAME-dev"
  read -r -s -p "Paste the scoped token (input hidden; blank to skip): " SB_TOKEN; echo
  if [ -n "$SB_TOKEN" ]; then
    printf '%s' "$SB_TOKEN" | gh secret set SUPABASE_ACCESS_TOKEN --repo "$REPO" --env supabase-dev
    unset SB_TOKEN
    echo "Stored as the SUPABASE_ACCESS_TOKEN secret of the supabase-dev environment."
  fi
fi

# ---------------------------------------------------------------------------------------------
step "5. Vercel project connected to the repo"
echo "Vercel's GitHub app must have access to $REPO (github.com/settings/installations, or the"
echo "$GH_OWNER org's installed apps), or 'vercel git connect' fails."
if confirm "Create Vercel project $NAME in ${VERCEL_SCOPE:-the active team} and connect it to $REPO?"; then
  # Unquoted on purpose: expands to nothing, or to the two words --scope <team>.
  # shellcheck disable=SC2086
  ( cd "$DIR"
    vercel project add "$NAME" ${VERCEL_SCOPE:+--scope "$VERCEL_SCOPE"} \
      || echo "(couldn't add it; if it already exists, linking below still works)"
    vercel link --yes --project "$NAME" ${VERCEL_SCOPE:+--scope "$VERCEL_SCOPE"}
    vercel git connect --yes ${VERCEL_SCOPE:+--scope "$VERCEL_SCOPE"} )
fi

# ---------------------------------------------------------------------------------------------
step "Done with the scripted part. Finish these by hand (Phase 1 of the runbook):"
cat <<EOF
  [ ] Vercel > $NAME > Settings > Environment Variables, for Production and Preview
      (server-side only; these never reach the browser):
        SUPABASE_URL              = https://${REF:-<project-ref>}.supabase.co
        SUPABASE_SERVICE_ROLE_KEY = Supabase > $NAME-dev > Project Settings > API keys
                                    (the service_role or secret key)
  [ ] Add $REPO to the Claude GitHub App's selected repositories: https://github.com/apps/claude
  [ ] Cloud environment "$NAME" at claude.ai/code (runbook Phase 1 step 6): Custom network with
      the default list, plus cdn.playwright.dev and playwright.download.prss.microsoft.com, plus
      public.ecr.aws if the default list lacks it (Supabase images), plus every host the spec
      says to record test fixtures from; paste ops/cloud-environment-setup.sh into its Setup
      script field
  [ ] Put the spec under docs/spec/ and accepted ADRs under decisions/, through a PR
      (the ruleset blocks direct pushes, including yours)
  [ ] claude.ai/code > Projects > New project: repo $REPO only, then paste
      ops/project-instructions.template.md (filled in) into Project settings > Memory
  [ ] Run the pilot (runbook Phase 1). deploy-migrations does nothing until the PR that runs
      'npx supabase init' merges.
EOF
