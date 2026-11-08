// Real-process mutex fixture: IPC barriers hold/release the gate without wall-clock assertions. Used by check-lock.test.
import { acquireCheckLock } from '../../scripts/check-lock.mjs';
const release = await acquireCheckLock(process.argv[2], {
  waitMs: Number(process.argv[3] ?? 600000),
  onWait: () => process.send('waiting'),
});
process.send('acquired');
process.once('message', () => { release(); process.disconnect(); });
