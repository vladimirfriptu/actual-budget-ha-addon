# actual_capture

Telegram + OpenRouter capture service for Actual Budget. Send an expense as text
(«200 нал продукты», «снял 500 с монобанка») or a receipt photo; the service
asks an LLM to extract the transaction, resolves accounts/categories against your
Actual budget, and files a **draft** (uncleared, `#draft` in notes). You review
and finalize in the Actual UI in the evening.

Runs as a local HAOS add-on. The bot uses Telegram long-polling, so nothing is
exposed to the internet.

## Configure (add-on options)

| Option | Meaning |
| --- | --- |
| `bot_token` | BotFather token for your private bot |
| `owner_chat_id` | your Telegram chat id (the only chat served) |
| `openrouter_api_key` | OpenRouter API key |
| `openrouter_text_model` | model for text messages (default `openai/gpt-4o-mini`) |
| `openrouter_vision_model` | model for receipt photos (default `openai/gpt-4o-mini`) |
| `actual_url` | Actual server URL, e.g. `https://192.168.68.140:5006` |
| `actual_password` | Actual server password |
| `actual_budget_sync_id` | budget Sync ID (Actual → Settings → Advanced → Sync ID) |
| `actual_e2e_password` | end-to-end encryption password (only if enabled) |
| `default_cash_account` | account used for unqualified cash mentions (default `Наличные`) |

## Commands

- plain text / photo → file a draft
- `/vocab` — show recognized accounts and categories
- `/refresh` — re-read them from Actual
- `/help` — usage

## How it files things

- **Expense** → negative transaction on the paying account.
- **Cash withdrawal** («снял … с карты») → a **transfer** card → cash.
- **Receipt / multi-category** → a **split** transaction (subtransactions).
- Anything uncertain still becomes a `#draft` with a `⚠` note — never dropped.

## Develop

```sh
npm ci               # from addons/actual_capture
npm run build        # tsc → dist
npm test             # vitest (pure modules: money, config, mapping, feedback)
npm run dev          # run locally against .env (see .env.example)
```

Deploy from the repo root: `just redeploy actual_capture`.

## Notes / limits (MVP)

- Actual serves HTTPS with a self-signed cert; this service disables TLS
  verification for that same-box call (`NODE_TLS_REJECT_UNAUTHORIZED=0`).
- Bank import (bulk) and subscriptions/recurring stay in Actual itself.
- No `/undo`: `addTransactions` returns no id, so a safe delete isn't available;
  remove a bad draft in the Actual UI.
