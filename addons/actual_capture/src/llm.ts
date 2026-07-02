import { parseAmount } from './money';
import { mergeByCategory } from './group';
import {
  llmResultSchema,
  llmManyResultSchema,
  categorizeResultSchema,
  type CategItem,
  type LlmResult,
  type Vocab,
} from './types';

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
    '- Purchases at a market/bazaar ("базар", "на базаре", "рынок", "на рынке",',
    '  "ринок", "market") are paid in CASH by default: set account = the cash',
    '  account from the list above, unless another paying account is explicitly named.',
    '- Money given or sent to ANOTHER PERSON or an external destination',
    '  ("перевёл жене", "відправив другу", "дал в долг") is NOT a transfer — it is an',
    '  EXPENSE: intent=expense, account = the paying account, and pick the best',
    '  matching category (e.g. a category about a transfer to a person, if one exists).',
    '- For a receipt photo, group line items into splits by category; amounts are per group.',
    '- Amounts are always positive numbers in major units; do not add currency signs.',
    '- ALWAYS put the numeric amount in the `amount` field (even for transfers). The',
    '  amount is usually the first number in the message. Never leave it only in `note`.',
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
  const result = llmResultSchema.parse(raw);
  // Deterministic safety net: models sometimes drop the amount into `note` only.
  if (result.amount == null) {
    result.amount = parseAmount(input.text ?? input.caption ?? result.note);
  }
  return result;
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
  const results = llmManyResultSchema.parse(raw).transactions;
  for (const r of results) {
    if (r.amount == null) r.amount = parseAmount(r.note);
  }
  return results;
}

/** Prompt for the /draft…/release session: extract EACH item; code sums by category. */
export function buildGroupPrompt(vocab: Vocab, today: string): string {
  const accounts = vocab.accounts.map((a) => a.name).join(', ') || '(none)';
  const categories = vocab.categories.map((c) => c.name).join(', ') || '(none)';
  return [
    'You are given several short shopping notes from ONE trip (one per line, or',
    'comma-separated). Extract EACH purchased item as its OWN transaction — do NOT',
    'sum or merge; the caller sums per category deterministically.',
    `Today is ${today}.`,
    '',
    'Return ONLY a JSON object {"transactions": [ ... ]}, one entry per item, with:',
    '- intent: always "expense"',
    '- amount: this item\'s price, positive major units',
    '- account: the paying account (from the list, or null)',
    '- category: the budget category (from the list, or null)',
    '- note: the item name only (e.g. "бананы")',
    '- confidence, from_account, to_account, payee, date, splits: leave null/empty',
    '',
    'Rules:',
    '- Assign the SAME category name to items of the same kind so they can be summed',
    '  (e.g. бананы/яблоки/мясо/еда → all "Продукты").',
    `- account MUST be chosen from these accounts (or null): ${accounts}`,
    `- category MUST be chosen from these categories (or null): ${categories}`,
    '- Context/account inference: the FIRST line may set context. "закупаюсь на',
    '  базаре"/"на рынке"/"на базаре" ⇒ paying account = the cash account. Apply that',
    '  account to every following item UNTIL a line changes it (e.g. "теперь в',
    '  магазине", or a specific card is named).',
    '- Fuel ("заправка", "заправился", "бензин", "топливо") is its OWN category. It is',
    '  the EXCEPTION to the market-cash context: leave its account null (the caller',
    '  routes fuel to the card).',
    '- Market/"базар"/"рынок" purchases default to the cash account.',
    '- A line that is only context ("закупаюсь на базаре") is NOT an item — skip it.',
    '- Amounts are positive numbers in major units; do not add currency signs.',
  ].join('\n');
}

/** Group a batch of quick notes into per-category draft expenses. Item
 *  extraction is the LLM's job; summing per category is deterministic. */
export async function groupExpenses(text: string, vocab: Vocab, deps: LlmDeps): Promise<LlmResult[]> {
  const messages: ChatMessage[] = [
    { role: 'system', content: buildGroupPrompt(vocab, deps.today) },
    { role: 'user', content: text },
  ];
  const raw = await chatJson(messages, deps.textModel, deps);
  const items = llmManyResultSchema.parse(raw).transactions;
  for (const r of items) {
    if (r.amount == null) r.amount = parseAmount(r.note);
  }
  return mergeByCategory(items);
}

/** Prompt for batch-categorizing already-parsed bank transactions. */
export function buildCategorizePrompt(vocab: Vocab): string {
  const categories = vocab.categories.map((c) => c.name).join(', ') || '(none)';
  return [
    'You assign a budget category to each bank-card transaction. Input is a JSON',
    'array of items { index, amountMajor, mcc, description, comment }. amountMajor',
    'is negative for spending, positive for income.',
    '',
    'Return ONLY a JSON object {"results": [{ "index": <same index>, "category": <name|null> }]}',
    'with one result per input item, preserving the index.',
    '',
    'Rules:',
    `- category MUST be chosen from this list, or null if none fits: ${categories}`,
    "- Bank MCC/description is often wrong or generic — prefer the merchant name in",
    '  description/comment over a literal reading of the MCC.',
    '- If unsure, use null rather than guessing — a human will review.',
  ].join('\n');
}

/** Categorize many bank transactions in one call. Returns category names aligned
 *  to the input order (null when the model declined). Never throws on shape. */
export async function categorizeBatch(
  items: CategItem[],
  vocab: Vocab,
  deps: LlmDeps,
): Promise<Array<string | null>> {
  if (items.length === 0) return [];
  const messages: ChatMessage[] = [
    { role: 'system', content: buildCategorizePrompt(vocab) },
    { role: 'user', content: JSON.stringify(items) },
  ];
  const raw = await chatJson(messages, deps.textModel, deps);
  const parsed = categorizeResultSchema.parse(raw);
  const byIndex = new Map(parsed.results.map((r) => [r.index, r.category ?? null]));
  return items.map((it) => byIndex.get(it.index) ?? null);
}
