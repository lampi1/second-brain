// Tool output detail requests are scoped to the visible row and must never treat a preview as complete output.
import { expect, it, vi } from 'vitest';
import { readToolOutput } from '../../src/renderer/lib/tool-output';
import type { ChatItem } from '../../src/shared/contract';
const tool: ChatItem = {kind:'tool',id:'wanted',at:1,name:'Bash',input:{},summary:'test',status:'ok',output:'x'.repeat(800000)};
it('reads exactly the requested item and returns its full bytes', async () => {
  const read=vi.fn(async()=>[tool]);
  expect(await readToolOutput('chat','wanted',read)).toBe(tool.output);
  expect(read).toHaveBeenCalledExactlyOnceWith({chatId:'chat',itemId:'wanted'});
});
it('rejects unavailable, mismatched, partial and failed responses', async () => {
  for(const rows of [[],[{...tool,id:'different'}],[{...tool,outputPreviewChars:900000}]]) await expect(readToolOutput('chat','wanted',async()=>rows)).rejects.toThrow('unavailable');
  await expect(readToolOutput('chat','wanted',async()=>{throw new Error('offline');})).rejects.toThrow('offline');
});
