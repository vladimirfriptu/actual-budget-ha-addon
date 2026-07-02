import { z } from 'zod';

// AppConfig is parsed from environment variables. run.sh maps the add-on's
// /data/options.json into these; locally they come from .env. `loadConfig` is
// pure over its input record so it can be unit-tested without process.env.

const rawSchema = z.object({
  BOT_TOKEN: z.string().min(1, 'BOT_TOKEN is required'),
  OWNER_CHAT_ID: z.coerce.number().int('OWNER_CHAT_ID must be an integer'),
  OPENROUTER_API_KEY: z.string().min(1, 'OPENROUTER_API_KEY is required'),
  OPENROUTER_TEXT_MODEL: z.string().min(1).default('openai/gpt-4o-mini'),
  OPENROUTER_VISION_MODEL: z.string().min(1).default('openai/gpt-4o-mini'),
  GROQ_API_KEY: z.string().min(1, 'GROQ_API_KEY is required'),
  GROQ_MODEL: z.string().min(1).default('whisper-large-v3-turbo'),
  ACTUAL_URL: z.string().url('ACTUAL_URL must be a URL'),
  ACTUAL_PASSWORD: z.string().min(1, 'ACTUAL_PASSWORD is required'),
  ACTUAL_SYNC_ID: z.string().min(1, 'ACTUAL_SYNC_ID is required'),
  ACTUAL_E2E_PASSWORD: z.string().optional().default(''),
  DEFAULT_CASH_ACCOUNT: z.string().min(1).default('Наличные'),
  // Fuel (and non-cash defaults in a /draft session) land here when no account is stated.
  DEFAULT_CARD_ACCOUNT: z.string().min(1).default('Монобанк чёрная'),
  // Monobank integration is inert unless MONO_TOKEN is set.
  MONO_TOKEN: z.string().optional().default(''),
  MONO_POLL_MINUTES: z.coerce.number().int().positive().default(60),
  MONO_BATCH_SIZE: z.coerce.number().int().positive().default(10),
  MONO_FLUSH_HOUR: z.coerce.number().int().min(0).max(23).default(21),
  MONO_BALANCE_HOUR: z.coerce.number().int().min(0).max(23).default(9),
  MONO_START_DATE: z.string().optional().default(''),
});

export interface AppConfig {
  botToken: string;
  ownerChatId: number;
  openrouterApiKey: string;
  textModel: string;
  visionModel: string;
  groqApiKey: string;
  groqModel: string;
  actualUrl: string;
  actualPassword: string;
  actualSyncId: string;
  actualE2ePassword: string;
  defaultCashAccount: string;
  defaultCardAccount: string;
  monoToken: string;
  monoPollMinutes: number;
  monoBatchSize: number;
  monoFlushHour: number;
  monoBalanceHour: number;
  monoStartDate: string;
}

// Just the fields needed to talk to Actual — used by the one-off seed script,
// which does not need the Telegram/OpenRouter config.
export interface ActualConnConfig {
  actualUrl: string;
  actualPassword: string;
  actualSyncId: string;
  actualE2ePassword: string;
}

const actualSchema = z.object({
  ACTUAL_URL: z.string().url('ACTUAL_URL must be a URL'),
  ACTUAL_PASSWORD: z.string().min(1, 'ACTUAL_PASSWORD is required'),
  ACTUAL_SYNC_ID: z.string().min(1, 'ACTUAL_SYNC_ID is required'),
  ACTUAL_E2E_PASSWORD: z.string().optional().default(''),
});

function formatIssues(error: z.ZodError): string {
  return error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
}

/** Parse only the Actual connection fields (for the seed script). */
export function loadActualConnConfig(env: NodeJS.ProcessEnv): ActualConnConfig {
  const parsed = actualSchema.safeParse(env);
  if (!parsed.success) throw new Error(`Invalid Actual configuration:\n${formatIssues(parsed.error)}`);
  const v = parsed.data;
  return {
    actualUrl: v.ACTUAL_URL,
    actualPassword: v.ACTUAL_PASSWORD,
    actualSyncId: v.ACTUAL_SYNC_ID,
    actualE2ePassword: v.ACTUAL_E2E_PASSWORD,
  };
}

/**
 * Parse and validate config from an env-like record. Throws a single readable
 * error listing every missing/invalid variable.
 */
export function loadConfig(env: NodeJS.ProcessEnv): AppConfig {
  const parsed = rawSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid configuration:\n${issues}`);
  }
  const v = parsed.data;
  return {
    botToken: v.BOT_TOKEN,
    ownerChatId: v.OWNER_CHAT_ID,
    openrouterApiKey: v.OPENROUTER_API_KEY,
    textModel: v.OPENROUTER_TEXT_MODEL,
    visionModel: v.OPENROUTER_VISION_MODEL,
    groqApiKey: v.GROQ_API_KEY,
    groqModel: v.GROQ_MODEL,
    actualUrl: v.ACTUAL_URL,
    actualPassword: v.ACTUAL_PASSWORD,
    actualSyncId: v.ACTUAL_SYNC_ID,
    actualE2ePassword: v.ACTUAL_E2E_PASSWORD,
    defaultCashAccount: v.DEFAULT_CASH_ACCOUNT,
    defaultCardAccount: v.DEFAULT_CARD_ACCOUNT,
    monoToken: v.MONO_TOKEN,
    monoPollMinutes: v.MONO_POLL_MINUTES,
    monoBatchSize: v.MONO_BATCH_SIZE,
    monoFlushHour: v.MONO_FLUSH_HOUR,
    monoBalanceHour: v.MONO_BALANCE_HOUR,
    monoStartDate: v.MONO_START_DATE,
  };
}
