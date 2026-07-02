import { Bot, Context, InlineKeyboard, type Api } from 'grammy';
import type { DraftOffer } from './types';

// Thin grammY wiring: authorize the owner, route text/photo/voice/commands and
// button taps to injected async handlers. Business logic lives elsewhere.
// This module does live I/O and is not unit-tested.

export interface PhotoInput {
  base64: string;
  mime: string;
  caption?: string;
}

export interface BotHandlers {
  onText(text: string): Promise<string>;
  onPhoto(input: PhotoInput): Promise<DraftOffer[]>;
  onVoice(ogg: Buffer): Promise<DraftOffer[]>;
  onApprove(id: string): Promise<string>;
  onCommand(cmd: 'start' | 'help' | 'vocab' | 'refresh' | 'draft' | 'release' | 'cancel'): Promise<string>;
}

async function fetchFileBuffer(api: Api, token: string, fileId: string): Promise<Buffer | null> {
  const file = await api.getFile(fileId);
  if (!file.file_path) return null;
  const res = await fetch(`https://api.telegram.org/file/bot${token}/${file.file_path}`);
  if (!res.ok) throw new Error(`telegram file download ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

export function createBot(token: string, ownerChatId: number, handlers: BotHandlers): Bot {
  const bot = new Bot(token);

  // Authorize: only the owner's chat is served; everything else is ignored.
  bot.use(async (ctx, next) => {
    if (ctx.chat?.id === ownerChatId) await next();
  });

  const reply = async (ctx: Context, work: () => Promise<string>): Promise<void> => {
    try {
      await ctx.reply(await work());
    } catch (err) {
      await ctx.reply(`⚠ ошибка: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  // Send one Telegram message per draft, each with a single [✅ Записать] button.
  const offerDrafts = async (
    ctx: Context,
    produce: () => Promise<DraftOffer[]>,
    emptyMsg: string,
  ): Promise<void> => {
    let offers: DraftOffer[];
    try {
      offers = await produce();
    } catch (err) {
      await ctx.reply(`⚠ ошибка: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }
    if (offers.length === 0) {
      await ctx.reply(emptyMsg);
      return;
    }
    for (const offer of offers) {
      const kb = new InlineKeyboard().text('✅ Записать', `ok:${offer.id}`);
      await ctx.reply(offer.summary, { reply_markup: kb });
    }
  };

  bot.command('start', (ctx) => reply(ctx, () => handlers.onCommand('start')));
  bot.command('help', (ctx) => reply(ctx, () => handlers.onCommand('help')));
  bot.command('vocab', (ctx) => reply(ctx, () => handlers.onCommand('vocab')));
  bot.command('refresh', (ctx) => reply(ctx, () => handlers.onCommand('refresh')));
  bot.command('draft', (ctx) => reply(ctx, () => handlers.onCommand('draft')));
  bot.command('release', (ctx) => reply(ctx, () => handlers.onCommand('release')));
  bot.command('cancel', (ctx) => reply(ctx, () => handlers.onCommand('cancel')));

  bot.on('message:photo', (ctx) =>
    offerDrafts(
      ctx,
      async () => {
        const photos = ctx.message.photo;
        const largest = photos[photos.length - 1];
        if (!largest) return [];
        const buf = await fetchFileBuffer(ctx.api, token, largest.file_id);
        if (!buf) return [];
        return handlers.onPhoto({ base64: buf.toString('base64'), mime: 'image/jpeg', caption: ctx.message.caption });
      },
      '⚠ не понял, что на фото — уточни текстом',
    ),
  );

  bot.on('message:voice', (ctx) =>
    offerDrafts(
      ctx,
      async () => {
        const buf = await fetchFileBuffer(ctx.api, token, ctx.message.voice.file_id);
        if (!buf) return [];
        return handlers.onVoice(buf);
      },
      '⚠ не расслышал — повтори или напиши текстом',
    ),
  );

  bot.on('message:text', (ctx) => reply(ctx, () => handlers.onText(ctx.message.text)));

  // Button tap: record the pending draft.
  bot.on('callback_query:data', async (ctx) => {
    const data = ctx.callbackQuery.data;
    const id = data.startsWith('ok:') ? data.slice(3) : null;
    if (!id) {
      await ctx.answerCallbackQuery();
      return;
    }
    let status: string;
    try {
      status = await handlers.onApprove(id);
    } catch (err) {
      status = `⚠ ошибка записи: ${err instanceof Error ? err.message : String(err)}`;
    }
    const orig = 'text' in (ctx.callbackQuery.message ?? {}) ? (ctx.callbackQuery.message as { text: string }).text : '';
    try {
      await ctx.editMessageText(`${status}\n${orig}`.trim(), { reply_markup: undefined });
    } catch {
      // message may be too old to edit — ignore
    }
    await ctx.answerCallbackQuery();
  });

  return bot;
}
