#!/usr/bin/env bash
set -euo pipefail

# Deploy post-sync hardening + engagement global switch.
# Không tạo lại secret; yêu cầu đã login Supabase CLI.

PROJECT_REF="${SUPABASE_PROJECT_REF:-vpriomitldkkwtpcwdkw}"
CLI=(pnpm dlx supabase)

echo "[1/3] Áp migration post-sync hardening"
PATH="${PATH}:/home/hoang-liem/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin" \
  "${CLI[@]}" db push --project-ref "$PROJECT_REF" --include-all

echo "[2/3] Deploy engagement-api"
PATH="${PATH}:/home/hoang-liem/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin" \
  "${CLI[@]}" functions deploy engagement-api --project-ref "$PROJECT_REF" --no-verify-jwt

echo "[3/3] Deploy post-sync-api"
PATH="${PATH}:/home/hoang-liem/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin" \
  "${CLI[@]}" functions deploy post-sync-api --project-ref "$PROJECT_REF" --no-verify-jwt

echo "Deploy hoàn tất cho project $PROJECT_REF"
