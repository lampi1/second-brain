// Host-rendered links/images and run-owned screenshot boundaries; no network or image decoder dependency.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { organizationUrl, readEvidenceImage, renderDevOpsComment } from '../../../packages/routine-runtime/src/devops-host/devops-content';
const dirs: string[] = [];
const temp = () => { const d = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'routine-images-')); dirs.push(d); return d; };
afterEach(() => { dirs.splice(0).forEach(d => fs.rmSync(d, { recursive: true, force: true })); });
const devops = ['https://dev', 'azure', 'com'].join('.');
const image = { id: 'a1', url: `${devops}/contoso/Project/_apis/wit/attachments/a1`, sha256: 'a'.repeat(64), name: 'before.png' };
it('escapes all HTML while rendering only approved organization links and run-uploaded images', () => {
  const rendered = renderDevOpsComment(`<script>alert(1)</script> [bug](${devops}/contoso/Project/_workitems/edit/42)\n![BEFORE](attachment:a1)`, 'contoso', [image]);
  expect(rendered).toContain('&lt;script&gt;'); expect(rendered).toContain(`<a href="${devops}/contoso/`); expect(rendered).toContain(`<img src="${devops}/contoso/`); expect(rendered).not.toContain('<script>');
  expect(renderDevOpsComment(`[bug](https://${'contoso'}.visualstudio.com/Project)`, 'contoso', [], 'markdown')).toContain(`[bug](https://${'contoso'}.visualstudio.com/Project)`);
  for (const url of ['javascript:alert(1)', 'https://evil.example/contoso', `${devops}/other/p`, `${devops}/${['contoso', 'evil.example'].join('@')}/`, devops.replace('://', `://${['user', 'pass'].join(':')}@`) + '/contoso', `${devops}/contoso/../other/p`, `${devops}/contoso%2fother/p`, `${devops.replace('https:', 'http:')}/contoso`]) expect(() => organizationUrl(url, 'contoso')).toThrow();
  expect(() => renderDevOpsComment(`![image](${devops}/contoso/x.png)`, 'contoso', [image])).toThrow('uploaded');
  expect(() => renderDevOpsComment('![image](attachment:other-run)', 'contoso', [image])).toThrow('uploaded');
});
it('opens only bounded PNG/JPEG regular single-link evidence files with matching signatures', () => {
  const root = temp(), png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aM1sAAAAASUVORK5CYII=', 'base64');
  fs.writeFileSync(path.join(root, 'before.png'), png); expect(readEvidenceImage(root, 'before.png').data).toEqual(png);
  for (const name of ['../before.png', '/before.png', 'sub/before.png', 'before.svg', 'before.png.exe']) expect(() => readEvidenceImage(root, name)).toThrow();
  fs.writeFileSync(path.join(root, 'fake.png'), '<html>this is not an image</html>'); expect(() => readEvidenceImage(root, 'fake.png')).toThrow('contents');
  fs.symlinkSync(path.join(root, 'before.png'), path.join(root, 'linked.png')); expect(() => readEvidenceImage(root, 'linked.png')).toThrow('link');
  fs.linkSync(path.join(root, 'before.png'), path.join(root, 'hard.png')); expect(() => readEvidenceImage(root, 'hard.png')).toThrow('single-link');
});
