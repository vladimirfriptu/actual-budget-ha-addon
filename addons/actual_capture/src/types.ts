import { z } from 'zod';

// ─── Vocabulary pulled from Actual (fed to the LLM and used for resolution) ───

export interface AccountRef {
  id: string;
  name: string;
  offbudget: boolean;
}

export interface CategoryRef {
  id: string;
  name: string;
  group: string;
}

/** A payee that represents "transfer to <accountId>". Used to create transfers. */
export interface TransferPayeeRef {
  accountId: string;
  payeeId: string;
}

export interface Vocab {
  accounts: AccountRef[];
  categories: CategoryRef[];
  transferPayees: TransferPayeeRef[];
}

// ─── LLM output contract ──────────────────────────────────────────────────────
// Lenient on purpose: models vary, so unknown/missing fields degrade to a draft
// rather than throwing. Account/category names are validated against the vocab
// later in mapping.ts, not here.

export const llmSplitSchema = z.object({
  amount: z.number().nonnegative(),
  category: z.string().nullish(),
  note: z.string().nullish(),
});

export const llmResultSchema = z.object({
  intent: z.enum(['expense', 'transfer', 'receipt', 'unknown']).catch('unknown'),
  confidence: z.number().min(0).max(1).catch(0),
  amount: z.number().nullish(),
  account: z.string().nullish(),
  from_account: z.string().nullish(),
  to_account: z.string().nullish(),
  payee: z.string().nullish(),
  category: z.string().nullish(),
  date: z.string().nullish(),
  note: z.string().nullish(),
  splits: z.array(llmSplitSchema).catch([]),
});

export type LlmResult = z.infer<typeof llmResultSchema>;
export type LlmSplit = z.infer<typeof llmSplitSchema>;

// Voice: one message may mention several transactions.
export const llmManyResultSchema = z.object({
  transactions: z.array(llmResultSchema).catch([]),
});
export type LlmManyResult = z.infer<typeof llmManyResultSchema>;

// A draft offered to the user with a single [✅ Записать] button.
export interface DraftOffer {
  id: string;
  summary: string;
}

// ─── Post plan: the concrete instruction for the Actual layer ────────────────
// All amounts are integer minor units. Expenses are negative (outflow).

export interface SubPlan {
  amountMinor: number;
  categoryId?: string;
  notes?: string;
}

export interface TransactionPlan {
  kind: 'transaction';
  accountId: string;
  amountMinor: number;
  categoryId?: string;
  payeeName?: string;
  date: string; // YYYY-MM-DD
  notes: string;
  subtransactions?: SubPlan[];
}

export interface TransferPlan {
  kind: 'transfer';
  fromAccountId: string;
  transferPayeeId: string;
  amountMinor: number; // negative: leaves fromAccount
  date: string;
  notes: string;
}

export type PostPlan = TransactionPlan | TransferPlan;

export interface PlanOutcome {
  plan: PostPlan;
  /** Human-readable notes about what could not be resolved (shown to the user). */
  warnings: string[];
}
