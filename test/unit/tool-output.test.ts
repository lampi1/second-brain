// Tool output detail requests are scoped to the visible row and must never treat a preview as complete output.
import { expect, it, vi } from 'vitest';
import { readToolOutput, toolOutputLoader } from '../../src/renderer/lib/tool-output';
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

it('loads during uninterrupted streams, coalesces updates and ignores replies after close', async () => {
  vi.useFakeTimers();
  try {
    const read=vi.fn(async()=> 'full'), accept=vi.fn(), fail=vi.fn();
    const loader=toolOutputLoader(read,accept,fail);
    for(let i=0;i<30;i++){loader.refresh();await vi.advanceTimersByTimeAsync(100);}
    expect(read.mock.calls.length).toBeGreaterThan(5);
    expect(accept).toHaveBeenCalledWith('full');
    expect(fail).not.toHaveBeenCalled();loader.dispose();
    let resolve!:(value:string)=>void;
    const late=toolOutputLoader(()=>new Promise(r=>{resolve=r;}),accept,fail);
    late.refresh();await vi.advanceTimersByTimeAsync(150);late.dispose();accept.mockClear();resolve('late');await Promise.resolve();
    expect(accept).not.toHaveBeenCalled();
    const retry=toolOutputLoader(vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue('recovered'),accept,fail);
    retry.refresh();await vi.advanceTimersByTimeAsync(150);expect(fail).toHaveBeenCalledOnce();
    retry.refresh();await vi.advanceTimersByTimeAsync(150);expect(accept).toHaveBeenCalledWith('recovered');retry.dispose();
  } finally {vi.useRealTimers();}
});
