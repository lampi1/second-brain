// Transient notifications deduplicate without extending deadlines or merging distinct undo operations.
import{afterEach,beforeEach,expect,it,vi}from'vitest';
import{dismissToast,expireToasts,toast,toastKey,ui}from'../../src/renderer/store/ui';
import{setLang,t}from'../../src/renderer/i18n';
beforeEach(()=>{vi.useFakeTimers();vi.setSystemTime(1000);});
afterEach(()=>{for(const item of ui.get().toasts)dismissToast(item.id);vi.useRealTimers();setLang('it');});
it('keeps one identical message and its original real deadline',()=>{
 const id=toast('Saved','ok');vi.advanceTimersByTime(3000);expect(toast('Saved','ok')).toBe(id);expect(ui.get().toasts).toHaveLength(1);
 vi.advanceTimersByTime(1000);expect(ui.get().toasts).toHaveLength(0);
});
it('expires immediately on returning after wall-clock time passed while timers were suspended',()=>{
 toast('Saved');vi.setSystemTime(10000);expireToasts();expect(ui.get().toasts).toEqual([]);expect(vi.getTimerCount()).toBe(0);
});
it('preserves distinct undo actions even if their text is identical',()=>{
 toast('Closed','info',{label:'Undo',run:vi.fn()});toast('Closed','info',{label:'Undo',run:vi.fn()});expect(ui.get().toasts).toHaveLength(2);
});
it('uses a stable localized key across a language change and repeated acknowledgements',()=>{
 const id=toastKey('essential.saved','ok');setLang('en');expect(toastKey('essential.saved','ok')).toBe(id);
 expect(t(ui.get().toasts[0]!.labelKey!)).toBe('Saved');expect(ui.get().toasts).toHaveLength(1);
});
