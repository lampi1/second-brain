// The phone's outbound says when a send or an edit really happened (stage 4 review, finding 2): an edit Telegram did
// not confirm is not a delivered correction, and a send Telegram refused is not an "unknown" result that blocks the
// run's outcome forever. In-process fake client only: no port, no network.
import { describe, expect, it } from 'vitest';
import { TelegramError, type TelegramClient } from '../../../src/main/phone/client';
import { createOutbound } from '../../../src/main/phone/outbound';
import { capLog, ME } from './fakes';

const client = (o: { send?: () => Promise<{ message_id: number }>; edit?: () => Promise<unknown> }) =>
  ({ sendMessage: o.send ?? (async () => ({ message_id: 7 })), editMessageText: o.edit ?? (async () => true) }) as unknown as TelegramClient;

describe('phone outbound results', () => {
  it('edit is true only when Telegram confirmed it', async () => {
    expect(await createOutbound(() => client({}), () => ME, capLog()).edit(1, 'v2')).toBe(true);
    expect(await createOutbound(() => client({ edit: async () => { throw new TelegramError('editMessageText', 'network', 'down'); } }), () => ME, capLog()).edit(1, 'v2')).toBe(false);
    expect(await createOutbound(() => null, () => ME, capLog()).edit(1, 'v2')).toBe(false);
    expect(await createOutbound(() => client({ edit: async () => { throw new TelegramError('editMessageText', 400, 'Bad Request: message is not modified'); } }), () => ME, capLog()).edit(1, 'v2')).toBe(true);
  });

  it('sendOutcome: the id when sent, refused when certainly not sent, null only when the network left it unknown', async () => {
    expect(await createOutbound(() => client({}), () => ME, capLog()).sendOutcome('done')).toBe(7);
    expect(await createOutbound(() => null, () => ME, capLog()).sendOutcome('done')).toBe('refused');
    expect(await createOutbound(() => client({}), () => null, capLog()).sendOutcome('done')).toBe('refused');
    expect(await createOutbound(() => client({ send: async () => { throw new TelegramError('sendMessage', 400, 'bad request'); } }), () => ME, capLog()).sendOutcome('done')).toBe('refused');
    expect(await createOutbound(() => client({ send: async () => { throw new TelegramError('sendMessage', 'network', 'reset'); } }), () => ME, capLog()).sendOutcome('done')).toBeNull();
    expect(await createOutbound(() => client({ send: async () => { throw new TelegramError('sendMessage', 502, 'bad gateway'); } }), () => ME, capLog()).sendOutcome('done')).toBeNull();
  });
});
