import { loadConfig } from './config';
import { ActualClient } from './actual';
import { classifyAndExtract, classifyAndExtractMany, groupExpenses, type CaptureInput, type LlmDeps } from './llm';
import { planFromLlm, normalizeName } from './mapping';
import { describePlan } from './describe';
import { formatConfirmation } from './feedback';
import { transcribe } from './stt';
import { PendingStore } from './pending';
import { createBot, type BotHandlers } from './bot';
import { MonoSync } from './mono_sync';
import { loadDotEnv } from './env';
import type { DraftOffer, LlmResult, Vocab } from './types';

// Bootstrap: connect to Actual, build the vocabulary, wire the Telegram bot to
// the capture pipeline (LLM → plan → file draft → confirm).

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

const FUEL_HINTS = ['топл', 'бензин', 'заправ', 'пальн', 'fuel'];
function isFuel(text: string | null | undefined): boolean {
  if (!text) return false;
  const n = normalizeName(text);
  return FUEL_HINTS.some((h) => n.includes(h));
}

async function main(): Promise<void> {
  loadDotEnv();
  const cfg = loadConfig(process.env);
  const stateDir = process.env.STATE_DIR ?? '/data';
  const dataDir = `${stateDir}/actual`;

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

  // /draft…/release session: quick notes are buffered here until released.
  let draftSession: string[] | null = null;

  const releaseDraft = async (): Promise<string> => {
    if (draftSession === null) return 'Нет открытой сессии. Начни с /draft.';
    const lines = draftSession;
    draftSession = null;
    if (lines.length === 0) return 'Сессия пустая — ничего не записал.';
    const results = await groupExpenses(lines.join('\n'), vocab, llmDeps());
    if (results.length === 0) return '⚠ Не смог разобрать покупки — ничего не записал.';
    const summaries: string[] = [];
    for (const llm of results) {
      // Fuel is the exception to the market→cash context: route it to the card
      // when no account was stated. Non-fuel account-less items stay cash.
      if (!llm.account && (isFuel(llm.category) || isFuel(llm.note))) {
        llm.account = cfg.defaultCardAccount;
      }
      const outcome = planFromLlm(llm, vocab, { defaultCashAccount: cfg.defaultCashAccount, today: today() });
      await actual.post(outcome.plan);
      summaries.push(describePlan(outcome.plan, vocab));
    }
    return `✅ Записал ${summaries.length} черновиков:\n\n${summaries.join('\n\n')}`;
  };

  const handlers: BotHandlers = {
    onText: async (text) => {
      if (draftSession !== null) {
        draftSession.push(text);
        return `📝 ${draftSession.length}: ${text}`;
      }
      return captureAuto({ text });
    },
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
            'Пакетно (закупка): /draft → пиши покупки по одной («помидоры 100»,',
            '«бензин 1000») → /release. Сгруппирую по категориям и запишу черновиками.',
            'Первой строкой можно задать контекст («на базаре» ⇒ всё наличными, кроме заправки).',
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
        case 'draft':
          draftSession = [];
          return [
            '📝 Сессия закупки открыта. Пиши покупки по одному сообщению:',
            '«помидоры 100», «бензин 1000»…',
            'Первой строкой можно задать контекст: «на базаре».',
            '',
            '/release — сгруппировать и записать · /cancel — отменить',
          ].join('\n');
        case 'release':
          return releaseDraft();
        case 'cancel': {
          const n = draftSession?.length ?? 0;
          draftSession = null;
          return n ? `Отменил сессию (${n} сообщений отброшено).` : 'Активной сессии не было.';
        }
      }
    },
  };

  const bot = createBot(cfg.botToken, cfg.ownerChatId, handlers);

  // Monobank sync is inert unless a token is configured.
  let mono: MonoSync | undefined;
  if (cfg.monoToken) {
    mono = new MonoSync(
      {
        pollMinutes: cfg.monoPollMinutes,
        batchSize: cfg.monoBatchSize,
        flushHour: cfg.monoFlushHour,
        balanceHour: cfg.monoBalanceHour,
        startDate: cfg.monoStartDate,
        cashAccountName: cfg.defaultCashAccount,
      },
      {
        mono: { token: cfg.monoToken },
        actual,
        llmDeps: () => ({
          apiKey: cfg.openrouterApiKey,
          textModel: cfg.textModel,
          visionModel: cfg.visionModel,
          today: today(),
        }),
        notify: async (msg) => {
          await bot.api.sendMessage(cfg.ownerChatId, msg);
        },
        statePath: `${stateDir}/mono-state.json`,
        now: () => new Date(),
        log: (msg) => console.log(msg),
      },
    );
    // Fire-and-forget so the bot starts immediately; init runs in the background.
    void mono.start().catch((err) => console.error('[mono] start failed', err));
    console.log('[mono] enabled');
  } else {
    console.log('[mono] disabled (no MONO_TOKEN)');
  }

  const shutdown = async (signal: string): Promise<void> => {
    console.log(`[shutdown] ${signal}`);
    mono?.stop();
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
