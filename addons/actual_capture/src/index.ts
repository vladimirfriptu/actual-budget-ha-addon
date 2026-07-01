import { loadConfig } from './config';
import { ActualClient } from './actual';
import { classifyAndExtract, classifyAndExtractMany, type CaptureInput, type LlmDeps } from './llm';
import { planFromLlm } from './mapping';
import { describePlan } from './describe';
import { formatConfirmation } from './feedback';
import { transcribe } from './stt';
import { PendingStore } from './pending';
import { createBot, type BotHandlers } from './bot';
import { loadDotEnv } from './env';
import type { DraftOffer, LlmResult, Vocab } from './types';

// Bootstrap: connect to Actual, build the vocabulary, wire the Telegram bot to
// the capture pipeline (LLM → plan → file draft → confirm).

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

async function main(): Promise<void> {
  loadDotEnv();
  const cfg = loadConfig(process.env);
  const dataDir = `${process.env.STATE_DIR ?? '/data'}/actual`;

  const actual = new ActualClient(cfg, dataDir);
  console.log('[actual] connecting…');
  await actual.connect();
  let vocab: Vocab = await actual.getVocab();
  console.log(`[actual] ready: ${vocab.accounts.length} accounts, ${vocab.categories.length} categories`);

  const pending = new PendingStore();
  const llmDeps = (): LlmDeps => ({
    apiKey: cfg.openrouterApiKey,
    textModel: cfg.textModel,
    visionModel: cfg.visionModel,
    today: today(),
  });

  // Text: auto-file a draft straight into Actual (no approval step).
  const captureAuto = async (input: CaptureInput): Promise<string> => {
    const llm = await classifyAndExtract(input, vocab, llmDeps());
    const outcome = planFromLlm(llm, vocab, { defaultCashAccount: cfg.defaultCashAccount, today: today() });
    await actual.post(outcome.plan);
    return formatConfirmation(outcome);
  };

  // Photo/voice: build a plan, stash it as pending, offer it with a ✅ button.
  const toOffer = (llm: LlmResult): DraftOffer => {
    const outcome = planFromLlm(llm, vocab, { defaultCashAccount: cfg.defaultCashAccount, today: today() });
    const summary = describePlan(outcome.plan, vocab);
    const id = pending.add(outcome.plan, summary);
    return { id, summary };
  };

  const handlers: BotHandlers = {
    onText: (text) => captureAuto({ text }),
    onPhoto: async ({ base64, mime, caption }) => {
      const llm = await classifyAndExtract({ imageBase64: base64, imageMime: mime, caption }, vocab, llmDeps());
      return [toOffer(llm)];
    },
    onVoice: async (ogg) => {
      const transcript = await transcribe(ogg, { apiKey: cfg.groqApiKey, model: cfg.groqModel });
      console.log(`[voice] transcript: ${transcript}`);
      if (!transcript) return [];
      const results = await classifyAndExtractMany(transcript, vocab, llmDeps());
      return results.map(toOffer);
    },
    onApprove: async (id) => {
      const draft = pending.take(id);
      if (!draft) return '⏳ Черновик устарел — надиктуй заново';
      await actual.post(draft.plan);
      return '✅ Записано';
    },
    onCommand: async (cmd) => {
      switch (cmd) {
        case 'start':
        case 'help':
          return [
            'Как вносить траты:',
            '• Текстом — «200 нал продукты», «снял 500 с монобанка». Пишу сразу в Actual.',
            '• Голосом — надиктуй одну или несколько трат; пришлю черновики с кнопкой ✅.',
            '• Фото чека — распознаю позиции; пришлю черновик с кнопкой ✅.',
            'Не одобрил — просто не жми ✅ (или уточни текстом).',
            '',
            '/vocab — распознаваемые счета и категории',
            '/refresh — перечитать их из Actual',
          ].join('\n');
        case 'vocab':
          return [
            `Счета: ${vocab.accounts.map((a) => a.name).join(', ') || '—'}`,
            `Категории: ${vocab.categories.map((c) => c.name).join(', ') || '—'}`,
          ].join('\n');
        case 'refresh':
          vocab = await actual.getVocab();
          return `Обновил: ${vocab.accounts.length} счетов, ${vocab.categories.length} категорий`;
      }
    },
  };

  const bot = createBot(cfg.botToken, cfg.ownerChatId, handlers);

  const shutdown = async (signal: string): Promise<void> => {
    console.log(`[shutdown] ${signal}`);
    await bot.stop();
    await actual.disconnect();
    process.exit(0);
  };
  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));

  console.log('[bot] starting long-poll…');
  await bot.start();
}

main().catch((err) => {
  console.error('[fatal]', err);
  process.exit(1);
});
