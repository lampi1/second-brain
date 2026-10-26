// Hidden native UI captures for scoped browser effects and the metadata-only site login editor; no providers run.
export async function captureRoutineBrowser(app, page, capture) {
  await page.getByTestId('nav-flussi').click();
  const definition = { id:'browser-fixture', title:'Aggiorna il portale di test', description:'Una modifica sul sito approvato, con verifica del risultato.', aliases:[], scope:{}, steps:[{ id:'web', title:'Aggiorna il record', kind:'agent', role:'artisan', engine:'claude', model:'sonnet', instructions:'Modifica il record selezionato e verifica il risultato.', inputs:['workspace'], workspaceInput:'workspace', evidence:['Screenshot e verifica'], timeoutMs:60000, maxAttempts:2, effect:'external-write', writeVia:'browser', browserTargets:['https://qa.example.com'] }] };
  const snapshot = { contextKey:'browser-ui', versions:[], active:{}, runs:[], drafts:[{ revision:1, status:'proposed', updatedAt:1, definition }] };
  await app.evaluate(({ BrowserWindow, ipcMain }, value) => {
    ipcMain.removeHandler('flows:list'); ipcMain.handle('flows:list', () => value);
    const win = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().startsWith('file:') && !w.webContents.getURL().includes('#overlay'));
    win.webContents.send('flows:changed', value);
  }, snapshot);
  await page.getByTestId('flow-browser-approval').waitFor(); await capture('routine-browser-approval');
  await page.getByTestId('qwin-later').click();
  await app.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler('credentials:sites');
    ipcMain.handle('credentials:sites', () => ({ origins:['https://qa.example.com'], entries:[{ id:'synthetic', site:'https://qa.example.com', user:'qa-reviewer', createdAt:1, updatedAt:1 }], unavailable:null }));
  });
  await page.getByTestId('topbar-more').click(); await page.getByTestId('more-credentials').click();
  await page.getByTestId('site-credentials').waitFor(); await capture('routine-site-logins');
  await page.getByRole('button', { name:/Modifica qa-reviewer/ }).click(); await capture('routine-site-login-editor');
  await page.keyboard.press('Escape');
}
