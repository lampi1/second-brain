// First-run UI never presents canceled or concurrently-unconnected creation as a connected brain.
import {expect,it} from 'vitest';
import {memoryCreationMessage,validMemoryFolder} from '../../src/renderer/lib/memory-creation';
it('validates a single Windows-safe folder name without accepting paths/reserved names',()=>{
  for(const name of ['Il mio lavoro','Documenti_2026','Attività'])expect(validMemoryFolder(name),name).toBe(true);
  for(const name of ['../work','C:/work','work\\child','CON','NUL.txt','work.','work ','','a'.repeat(65)])expect(validMemoryFolder(name),name).toBe(false);
});
it('distinguishes cancel, successful connection and preservation of a newer memory choice',()=>{
  expect(memoryCreationMessage(null)).toContain('annullata');
  expect(memoryCreationMessage({root:'synthetic',connected:true})).toContain('creata e collegata');
  expect(memoryCreationMessage({root:'synthetic',connected:false})).toContain('scelta nel frattempo');
});
