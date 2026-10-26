// Approved browser targets and the write-only site login editor; authored on branch, executed only on main.
import { test, expect } from '@playwright/test';
import type { FlowSnapshot } from '../../src/shared/flows';
import { launchDemo, shot, publishFlows, closeQuestions, moreAction } from './helpers';
test('browser approval names its scope and encrypted site logins are editable without reading passwords', async () => {
  const { app, page } = await launchDemo({ orchestrator: true });
  try {
    const snapshot: FlowSnapshot = { contextKey:'browser-ui', versions:[],active:{},runs:[],drafts:[{revision:1,status:'proposed',updatedAt:1,definition:{id:'browser-fixture',title:'Aggiorna il portale di test',description:'Una modifica sul sito approvato.',aliases:[],scope:{},steps:[{id:'web',title:'Aggiorna il record',kind:'agent',role:'artisan',engine:'claude',model:'sonnet',instructions:'Modifica il record e verifica il risultato.',inputs:['workspace'],workspaceInput:'workspace',evidence:['Screenshot e verifica'],timeoutMs:60000,maxAttempts:2,effect:'external-write',writeVia:'browser',browserTargets:['https://qa.example.com']}]}}] };
    await publishFlows(app,snapshot);
    const approval=page.getByTestId('qwin-flow-definition');
    await expect(approval.getByTestId('flow-browser-approval')).toContainText('https://qa.example.com');
    await expect(approval.getByTestId('flow-browser-approval')).toContainText('Claude');
    await shot(page,'routine-browser-approval'); await closeQuestions(page);
    // Metadata-only IPC fixtures: this test does not store or inspect a real secret.
    await app.evaluate(({ipcMain})=>{
      let entries: {id:string;site:string;user:string;updatedAt:number;createdAt:number}[]=[];
      for(const c of ['credentials:sites','credentials:saveSite','credentials:removeSite'])ipcMain.removeHandler(c);
      ipcMain.handle('credentials:sites',()=>({origins:['https://qa.example.com'],entries,unavailable:null}));
      ipcMain.handle('credentials:saveSite',(_e,a)=>{entries=[{id:'fixture',site:a.origin,user:a.user,createdAt:1,updatedAt:1}];});
      ipcMain.handle('credentials:removeSite',()=>{entries=[];});
    });
    await moreAction(page,'more-credentials'); const panel=page.getByTestId('site-credentials');
    await panel.getByTestId('site-add').click(); await panel.getByTestId('site-user').fill('qa-reviewer');
    await panel.getByTestId('site-password').fill('synthetic-ui-only');
    await expect(panel.getByTestId('site-password')).toHaveAttribute('type','password');
    await panel.getByTestId('site-save').click(); await expect(panel).toContainText('qa-reviewer');
    await expect(panel.getByTestId('site-password')).toHaveCount(0); await expect(panel).not.toContainText('synthetic-ui-only');
    await shot(page,'routine-site-logins');
    await panel.getByRole('button',{name:/Modifica qa-reviewer/}).click(); await expect(panel.getByTestId('site-password')).toHaveValue('');
    await panel.getByRole('button',{name:'Annulla',exact:true}).click();
    await panel.getByRole('button',{name:/Elimina qa-reviewer/}).click(); await expect(panel).not.toContainText('qa-reviewer');
  } finally { await app.close(); }
});
