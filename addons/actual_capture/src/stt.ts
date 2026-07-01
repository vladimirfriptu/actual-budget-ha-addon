// Speech-to-text via Groq Whisper (OpenAI-compatible). Accepts Telegram's
// OGG/Opus voice bytes directly — no transcoding. Thin I/O shell.

const GROQ_URL = 'https://api.groq.com/openai/v1/audio/transcriptions';

export interface SttDeps {
  apiKey: string;
  model: string;
  fetchImpl?: typeof fetch;
}

/** Transcribe OGG/Opus audio to text. Throws on network/API failure. */
export async function transcribe(audio: Buffer, deps: SttDeps): Promise<string> {
  const doFetch = deps.fetchImpl ?? fetch;
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(audio)], { type: 'audio/ogg' }), 'voice.ogg');
  form.append('model', deps.model);
  form.append('response_format', 'text');

  const res = await doFetch(GROQ_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${deps.apiKey}` },
    body: form,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Groq STT ${res.status}: ${body.slice(0, 300)}`);
  }
  return (await res.text()).trim();
}
