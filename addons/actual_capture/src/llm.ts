import { llmResultSchema, llmManyResultSchema, type LlmResult, type Vocab } from './types';

// OpenRouter client. One call classifies intent and extracts fields as strict
// JSON. Account/category names are constrained to the vocabulary; resolution to
// ids happens later in mapping.ts.

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

export interface LlmDeps {
  apiKey: string;
  textModel: string;
  visionModel: string;
  today: string;
  fetchImpl?: typeof fetch;
}

export interface CaptureInput {
  text?: string;
  imageBase64?: string;
  imageMime?: string;
  caption?: string;
}

/** Build the system prompt that constrains the model to the current vocabulary. */
export function buildSystemPrompt(vocab: Vocab, today: string, opts: { multi?: boolean } = {}): string {
  const accounts = vocab.accounts.map((a) => a.name).join(', ') || '(none)';
  const categories = vocab.categories.map((c) => c.name).join(', ') || '(none)';
  const header = opts.multi
    ? [
        'You extract personal-finance transactions from a dictated message that may',
        'mention SEVERAL purchases. Return ONLY a JSON object {"transactions": [ ... ]}',
        'with one array item per separate transaction; each item has these fields:',
      ]
    : ['Return ONLY a JSON object with these fields:'];
  return [
    'You extract personal-finance transactions from a short message or a receipt photo.',
    `Today is ${today}.`,
    '',
    ...header,
    '- intent: "expense" | "transfer" | "receipt" | "unknown"',
    '- confidence: number 0..1',
    '- amount: number in MAJOR units (e.g. 12.50), positive, or null if unknown',
    '- account: the paying account, or null',
    '- from_account, to_account: for transfers (e.g. cash withdrawal from a card), else null',
    '- payee: merchant/person, or null',
    '- category: for a single expense, or null',
    '- date: "YYYY-MM-DD" or null (null means today)',
    '- note: short free text (keep the user\'s words)',
    '- splits: for a receipt or a multi-category payment, an array of { amount, category, note }',
    '',
    'Rules:',
    `- account/from_account/to_account MUST be chosen from these accounts (or null): ${accounts}`,
    `- category MUST be chosen from these categories (or null): ${categories}`,
    '- If a value is uncertain, use null rather than guessing — a human will review.',
    '- A TRANSFER is ONLY a move between the user\'s OWN accounts above: a cash',
    '  withdrawal from a card, or moving money between the user\'s cards/jars.',
    '- Cash withdrawal ("снял/зняв готівку/налич…"): intent=transfer, from_account =',
    '  the card, to_account = the cash account from the list above.',
    '- Money given or sent to ANOTHER PERSON or an external destination',
    '  ("перевёл жене", "відправив другу", "дал в долг") is NOT a transfer — it is an',
    '  EXPENSE: intent=expense, account = the paying account, and pick the best',
    '  matching category (e.g. a category about a transfer to a person, if one exists).',
    '- For a receipt photo, group line items into splits by category; amounts are per group.',
    '- Amounts are always positive numbers in major units; do not add currency signs.',
  ].join('\n');
}

interface ChatMessage {
  role: 'system' | 'user';
  content: string | Array<Record<string, unknown>>;
}

export function buildMessages(input: CaptureInput, vocab: Vocab, today: string): ChatMessage[] {
  const system: ChatMessage = { role: 'system', content: buildSystemPrompt(vocab, today) };
  if (input.imageBase64) {
    const url = `data:${input.imageMime ?? 'image/jpeg'};base64,${input.imageBase64}`;
    const content: Array<Record<string, unknown>> = [
      { type: 'text', text: input.caption?.trim() || 'Receipt photo. Extract the transaction.' },
      { type: 'image_url', image_url: { url } },
    ];
    return [system, { role: 'user', content }];
  }
  return [system, { role: 'user', content: input.text ?? '' }];
}

/** POST chat messages to OpenRouter (JSON mode) and return the parsed JSON content. */
async function chatJson(
  messages: ChatMessage[],
  model: string,
  deps: LlmDeps,
): Promise<unknown> {
  const doFetch = deps.fetchImpl ?? fetch;
  const res = await doFetch(OPENROUTER_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${deps.apiKey}`,
      'Content-Type': 'application/json',
      'X-Title': 'actual-capture',
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: 0,
      response_format: { type: 'json_object' },
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`OpenRouter ${res.status}: ${body.slice(0, 300)}`);
  }

  const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error('OpenRouter returned no content');
  try {
    return JSON.parse(content);
  } catch {
    throw new Error(`OpenRouter returned non-JSON content: ${content.slice(0, 200)}`);
  }
}

/** Call OpenRouter and return a validated LlmResult (single transaction: text/photo). */
export async function classifyAndExtract(
  input: CaptureInput,
  vocab: Vocab,
  deps: LlmDeps,
): Promise<LlmResult> {
  const model = input.imageBase64 ? deps.visionModel : deps.textModel;
  const raw = await chatJson(buildMessages(input, vocab, deps.today), model, deps);
  return llmResultSchema.parse(raw);
}

/** Extract ALL transactions from a dictated (transcribed) message. */
export async function classifyAndExtractMany(
  text: string,
  vocab: Vocab,
  deps: LlmDeps,
): Promise<LlmResult[]> {
  const messages: ChatMessage[] = [
    { role: 'system', content: buildSystemPrompt(vocab, deps.today, { multi: true }) },
    { role: 'user', content: text },
  ];
  const raw = await chatJson(messages, deps.textModel, deps);
  return llmManyResultSchema.parse(raw).transactions;
}
