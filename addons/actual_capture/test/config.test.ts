import { describe, it, expect } from 'vitest';
import { loadConfig } from '../src/config';

const base = {
  BOT_TOKEN: 'bot',
  OWNER_CHAT_ID: '12345',
  OPENROUTER_API_KEY: 'key',
  GROQ_API_KEY: 'gk',
  ACTUAL_URL: 'https://192.168.68.140:5006',
  ACTUAL_PASSWORD: 'pw',
  ACTUAL_SYNC_ID: 'sync-1',
};

describe('loadConfig', () => {
  it('parses a valid env with defaults applied', () => {
    const cfg = loadConfig({ ...base } as NodeJS.ProcessEnv);
    expect(cfg.botToken).toBe('bot');
    expect(cfg.ownerChatId).toBe(12345);
    expect(cfg.textModel).toBe('openai/gpt-4o-mini');
    expect(cfg.visionModel).toBe('openai/gpt-4o-mini');
    expect(cfg.groqModel).toBe('whisper-large-v3-turbo');
    expect(cfg.defaultCashAccount).toBe('Наличные');
    expect(cfg.actualE2ePassword).toBe('');
  });

  it('coerces OWNER_CHAT_ID to a number', () => {
    const cfg = loadConfig({ ...base, OWNER_CHAT_ID: '-1001' } as NodeJS.ProcessEnv);
    expect(cfg.ownerChatId).toBe(-1001);
  });

  it('lists every missing required field', () => {
    expect(() => loadConfig({} as NodeJS.ProcessEnv)).toThrow(/BOT_TOKEN/);
    try {
      loadConfig({} as NodeJS.ProcessEnv);
    } catch (e) {
      const msg = (e as Error).message;
      expect(msg).toContain('OPENROUTER_API_KEY');
      expect(msg).toContain('ACTUAL_SYNC_ID');
    }
  });

  it('rejects a non-URL ACTUAL_URL', () => {
    expect(() => loadConfig({ ...base, ACTUAL_URL: 'not-a-url' } as NodeJS.ProcessEnv)).toThrow(/ACTUAL_URL/);
  });
});
