#!/usr/bin/env sh
# Map HAOS add-on options (/data/options.json) into env vars, then start the
# capture service. Only non-empty options are exported.
set -e

export STATE_DIR=/data

# Translate options.json -> export lines (only non-empty values).
eval "$(node - <<'JS'
const fs = require('fs');
let opts = {};
try { opts = JSON.parse(fs.readFileSync('/data/options.json', 'utf8')); } catch {}
const map = {
  bot_token: 'BOT_TOKEN',
  owner_chat_id: 'OWNER_CHAT_ID',
  openrouter_api_key: 'OPENROUTER_API_KEY',
  openrouter_text_model: 'OPENROUTER_TEXT_MODEL',
  openrouter_vision_model: 'OPENROUTER_VISION_MODEL',
  groq_api_key: 'GROQ_API_KEY',
  groq_model: 'GROQ_MODEL',
  actual_url: 'ACTUAL_URL',
  actual_password: 'ACTUAL_PASSWORD',
  actual_budget_sync_id: 'ACTUAL_SYNC_ID',
  actual_e2e_password: 'ACTUAL_E2E_PASSWORD',
  default_cash_account: 'DEFAULT_CASH_ACCOUNT',
};
const sh = (v) => `'${String(v).replace(/'/g, `'\\''`)}'`;
for (const [k, env] of Object.entries(map)) {
  const v = opts[k];
  if (v !== undefined && v !== null && v !== '' && v !== 0) {
    process.stdout.write(`export ${env}=${sh(v)}\n`);
  }
}
JS
)"

# Diagnostic (no secret values — only key names and string lengths).
node -e 'try{const o=JSON.parse(require("fs").readFileSync("/data/options.json","utf8"));console.error("[run.sh] options.json:",JSON.stringify(Object.fromEntries(Object.entries(o).map(([k,v])=>[k,typeof v==="string"?v.length:v]))))}catch(e){console.error("[run.sh] options.json error:",e.message)}'

exec node /app/dist/index.js
