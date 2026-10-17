// Render the real panel without browser, providers or Git; unavailable prerequisites must keep action buttons disabled.
import {expect,it} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {ProposalPanel} from '../../src/renderer/components/ProposalPanel';
import {proposalBlocks} from '../../src/renderer/lib/proposal-availability';
it('keeps creation unavailable with the main prerequisite reason',()=>{
  const noop=async()=>{};
  const markup=renderToStaticMarkup(<ProposalPanel proposals={[]} createBlocked="Cartella non configurata" publishBlocked="Accesso GitHub richiesto" onCreate={noop} onRefresh={noop} onResume={noop} onPublish={noop}/>);
  expect(markup).toContain('Cartella non configurata');expect(markup).toContain('Accesso GitHub richiesto');
  expect(markup).toMatch(/<button[^>]*disabled=""[^>]*data-testid="proposal-create"/);
});
it('preserves main permission to publish while unknown and explicit prerequisite failures remain blocked',()=>{
  expect(proposalBlocks(null).publishBlocked).toBeTruthy();
  expect(proposalBlocks({available:true,reason:null,publishBlocked:null})).toEqual({createBlocked:null,publishBlocked:null});
  expect(proposalBlocks({available:false,reason:'Cartella assente',publishBlocked:'Accesso richiesto'})).toEqual({createBlocked:'Cartella assente',publishBlocked:'Accesso richiesto'});
});
