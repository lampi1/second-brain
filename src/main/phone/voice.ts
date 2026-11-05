// Voice notes from the phone (design §7): refused over 5 minutes or 20 MB (before downloading), downloaded into memory,
// decoded to a 16 kHz WAV (decodeVoice, the renderer's WebAudio), written to a temporary WAV with a random name in
// tempDir (owner-only), transcribed on the PC (transcribe, the local voice engine) and deleted in a finally, also when
// any step fails. Never a recording, never an external speech service. The text goes to the Orchestrator as a voice
// message and comes back as an echo "🎙️ Ho capito: «…»" (filtered), so a wrong transcription shows at once. No voice
// models → "Attiva la voce nell'app, scrivimi in testo".
// Used by bridge.ts; tests: test/unit/phone/voice.test.ts (temp file deleted on success and on error).
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { PhonePort } from '../../shared/contract/phone';
import { MAX_DOWNLOAD_BYTES, type TelegramClient } from './client';
import { condense } from './condense';
import type { Outbound } from './outbound';
import type { PhoneLog, TgVoice } from './types';

export const MAX_VOICE_SECONDS = 5 * 60;
export const NO_MODELS = 'Attiva la voce nell\'app, scrivimi in testo.';

export interface VoiceDeps {
  client: TelegramClient;
  out: Outbound;
  port: PhonePort;
  decodeVoice(bytes: Uint8Array): Promise<Uint8Array>;
  transcribe(wavPath: string): Promise<string | null>;
  tempDir: string;
  log: PhoneLog;
}

export type VoiceOutcome = 'sent' | 'too-long' | 'too-large' | 'no-models' | 'empty' | 'error';

export async function handleVoice(v: TgVoice, d: VoiceDeps): Promise<VoiceOutcome> {
  if (!Number.isFinite(v.duration) || v.duration > MAX_VOICE_SECONDS) {
    await d.out.send('Vocale troppo lungo (max 5 minuti): dividilo o scrivimi in testo.');
    return 'too-long';
  }
  if ((v.file_size ?? 0) > MAX_DOWNLOAD_BYTES) { await d.out.send('Vocale troppo grande (max 20 MB).'); return 'too-large'; }
  let wavPath: string | null = null;
  let text: string | null;
  try {
    const file = await d.client.getFile(v.file_id);
    if ((file.file_size ?? 0) > MAX_DOWNLOAD_BYTES || !file.file_path) { await d.out.send('Vocale troppo grande (max 20 MB).'); return 'too-large'; }
    const bytes = await d.client.download(file.file_path, MAX_DOWNLOAD_BYTES);
    const wav = await d.decodeVoice(bytes);
    wavPath = path.join(d.tempDir, `phone-${crypto.randomBytes(12).toString('hex')}.wav`);
    await fs.mkdir(d.tempDir, { recursive: true });
    await fs.writeFile(wavPath, wav, { flag: 'wx', mode: 0o600 });
    text = await d.transcribe(wavPath);
  } catch (e) {
    const code = (e as { code?: unknown }).code;
    d.log.warn('phone', 'voice note failed', { data: { step: code === 'too-large' ? 'size' : 'pipeline', error: e instanceof Error ? e.name : 'error' } });
    await d.out.send(code === 'too-large' ? 'Vocale troppo grande (max 20 MB).' : 'Non sono riuscito a leggere il vocale: scrivimi in testo.');
    return code === 'too-large' ? 'too-large' : 'error';
  } finally {
    if (wavPath) await fs.rm(wavPath, { force: true }).catch(() => undefined);
  }
  if (text === null) { await d.out.send(NO_MODELS); return 'no-models'; }
  const said = text.trim();
  if (!said) { await d.out.send('Non ho capito il vocale: riprova o scrivimi in testo.'); return 'empty'; }
  await d.out.send(`🎙️ Ho capito: «${condense(said, 400)}»`);
  const r = await d.port.sendFromPhone(said, { voice: true });
  if (r.queued) await d.out.send('In coda all\'Orchestrator.', { silent: true });
  return 'sent';
}
