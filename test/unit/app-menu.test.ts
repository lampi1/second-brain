// The native menu (src/main/app-menu.ts, ADR 0054): macOS gets the standard app, edit and window menus (Cmd+C/V/Q live
// there); Windows and Linux keep no native menu.
import { describe, expect, it } from 'vitest';
import { appMenuTemplate } from '../../src/main/app-menu';

describe('appMenuTemplate', () => {
  it('macOS: app, edit and window roles only', () => {
    expect(appMenuTemplate('darwin')?.map(m => m.role)).toEqual(['appMenu', 'editMenu', 'windowMenu']);
  });
  it('Windows and Linux: none', () => {
    expect(appMenuTemplate('win32')).toBeNull();
    expect(appMenuTemplate('linux')).toBeNull();
  });
});
