## What changes for the user

<!-- One or two sentences. Link the issue if there is one. -->

## How it was verified

- [ ] `npm run check:branch` is green on the last commit
- [ ] I looked at the screenshots in `test-results/shots/` (attach the relevant ones)
- [ ] Contract first: shapes and channels in `src/shared/contract.ts`, no `ipcMain`/`ipcRenderer` outside `ipc.ts` and the preload
- [ ] Unit tests for the module, an e2e spec with a screenshot for what the user sees
- [ ] Demo data updated if the UI shows something new
- [ ] An ADR in `docs/adr/` if a real choice was made; a line in `CHANGELOG.md` under Unreleased
- [ ] No secrets, personal data or real names in code, fixtures or screenshots
