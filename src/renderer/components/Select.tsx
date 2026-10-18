// Linear-style select: a trigger button and a listbox popover, no native picker. Callers keep the <option>/<optgroup>
// children they wrote for <select>; onChange receives { target: { value } } so `e => f(e.target.value)` stays the same.
// Keyboard: ArrowUp/Down/Enter/Space open, then arrows, Home/End and typeahead move, Enter/Space pick, Esc/Tab close.
// The popover is portalled to <body> and registered as an overlay, so a browser view under it hides (lib/viewports.ts).
import { Children, Fragment, forwardRef, isValidElement, useEffect, useId, useImperativeHandle, useLayoutEffect, useRef, useState,
  type ButtonHTMLAttributes, type KeyboardEvent as RKeyboardEvent, type ReactElement, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { registerOverlay, report } from '../lib/viewports';
import { IconCheck, IconChevronDown } from './Icons';

export type SelectChange = { target: { value: string }; currentTarget: { value: string } };
type Option = { value: string; label: ReactNode; text: string; disabled: boolean; group?: string };
type Props = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'value' | 'onChange' | 'children' | 'type'> & {
  value?: string | number; onChange?: (event: SelectChange) => void; children?: ReactNode; 'data-testid'?: string;
};

/** True for an event inside an open Select list: Modal and Popover leave its Esc and clicks to it. */
export const inSelectList = (target: EventTarget | null) => target instanceof Element && !!target.closest('.ui-select-list');

const textOf = (node: ReactNode): string =>
  typeof node === 'string' || typeof node === 'number' ? String(node)
    : Array.isArray(node) ? node.map(textOf).join('')
      : isValidElement<{ children?: ReactNode }>(node) ? textOf(node.props.children) : '';

/** The <option>s under children, through fragments and <optgroup>s (exported for tests). */
export function optionsOf(children: ReactNode, group?: string): Option[] {
  return Children.toArray(children).flatMap((child): Option[] => {
    if (!isValidElement(child)) return [];
    const el = child as ReactElement<{ children?: ReactNode; value?: string | number; disabled?: boolean; label?: string }>;
    if (el.type === Fragment) return optionsOf(el.props.children, group);
    if (el.type === 'optgroup') return optionsOf(el.props.children, el.props.label);
    if (el.type !== 'option') return [];
    const text = textOf(el.props.children);
    return [{ value: String(el.props.value ?? text), label: el.props.children, text, disabled: !!el.props.disabled, group }];
  });
}

export const Select = forwardRef<HTMLButtonElement, Props>(function Select({ value, onChange, children, className = '', disabled, onKeyDown, 'data-testid': testid, ...rest }, forwarded) {
  const options = optionsOf(children);
  const current = String(value ?? '');
  const selected = options.find(o => o.value === current) ?? (value === undefined ? options[0] : undefined);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [pos, setPos] = useState<{ x: number; y: number; w: number; up: boolean } | null>(null);
  const trigger = useRef<HTMLButtonElement>(null), list = useRef<HTMLDivElement>(null);
  const typed = useRef({ text: '', at: 0 });
  const id = useId();
  useImperativeHandle(forwarded, () => trigger.current!, []);

  const enabled = (i: number) => !!options[i] && !options[i]!.disabled;
  const step = (from: number, dir: 1 | -1) => {
    for (let n = 1; n <= options.length; n++) { const i = (from + dir * n + options.length * 2) % options.length; if (enabled(i)) return i; }
    return from;
  };
  const show = (at?: number) => {
    if (disabled || !options.length) return;
    const i = options.indexOf(selected!);
    setActive(at ?? (enabled(i) ? i : step(-1, 1)));
    setOpen(true);
  };
  const close = (refocus = true) => { setOpen(false); setPos(null); if (refocus) trigger.current?.focus(); };
  const pick = (i: number) => {
    const o = options[i];
    if (!o || o.disabled) return;
    close();
    if (o.value !== current) onChange?.({ target: { value: o.value }, currentTarget: { value: o.value } });
  };
  const seek = (key: string) => {
    const now = Date.now();
    typed.current = { text: (now - typed.current.at < 700 ? typed.current.text : '') + key.toLowerCase(), at: now };
    const from = Math.max(active, 0), q = typed.current.text;
    for (let n = q.length === 1 ? 1 : 0; n <= options.length; n++) {
      const i = (from + n) % options.length;
      if (enabled(i) && options[i]!.text.toLowerCase().startsWith(q)) return i;
    }
    return -1;
  };

  // below the trigger, else above; never wider than the window
  useLayoutEffect(() => {
    if (!open || !trigger.current || !list.current) return;
    const a = trigger.current.getBoundingClientRect(), h = list.current.offsetHeight;
    const up = a.bottom + 6 + h > window.innerHeight - 8 && a.top - 6 - h > 8;
    const w = Math.max(a.width, list.current.scrollWidth);
    setPos({ x: Math.min(Math.max(8, a.left), window.innerWidth - w - 8), y: up ? a.top - h - 6 : a.bottom + 6, w: a.width, up });
  }, [open]);
  useLayoutEffect(() => (open && list.current ? registerOverlay(list.current) : undefined), [open]);
  useLayoutEffect(() => { if (open && pos) report(); }, [open, pos]);
  // only once placed: focusing it off screen (-9999) would scroll its ancestors, and a scroll closes the list
  useEffect(() => { if (open && pos && active >= 0) list.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.focus({ preventScroll: false }); }, [open, active, pos]);
  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => { const n = e.target as Node; if (!list.current?.contains(n) && !trigger.current?.contains(n)) close(false); };
    const away = () => close(false);
    // a scroll closes it only when it moves the trigger (opening may nudge a scroller by 0-1 px: settings' .bx-scroll)
    const at = trigger.current?.getBoundingClientRect();
    const scrolled = (e: Event) => {
      if (list.current?.contains(e.target as Node)) return;
      const now = trigger.current?.getBoundingClientRect();
      if (!at || !now || Math.abs(now.top - at.top) > 1 || Math.abs(now.left - at.left) > 1) close(false);
    };
    window.addEventListener('pointerdown', down, true);
    window.addEventListener('resize', away);
    window.addEventListener('scroll', scrolled, true);
    return () => { window.removeEventListener('pointerdown', down, true); window.removeEventListener('resize', away); window.removeEventListener('scroll', scrolled, true); };
  }, [open]);

  const onTrigger = (e: RKeyboardEvent<HTMLButtonElement>) => {
    onKeyDown?.(e);
    if (e.defaultPrevented || open) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ') { e.preventDefault(); show(); }
    else if (e.key.length === 1 && /\S/.test(e.key)) { const i = seek(e.key); if (i >= 0) show(i); }
  };
  const onList = (e: RKeyboardEvent<HTMLDivElement>) => {
    const keys: Record<string, () => number> = { ArrowDown: () => step(active, 1), ArrowUp: () => step(active, -1), Home: () => step(-1, 1), End: () => step(options.length, -1) };
    if (keys[e.key]) { e.preventDefault(); setActive(keys[e.key]!()); }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(active); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
    else if (e.key === 'Tab') { e.preventDefault(); close(); }
    else if (e.key.length === 1 && /\S/.test(e.key)) { const i = seek(e.key); if (i >= 0) setActive(i); }
  };

  return <>
    <button {...rest} ref={trigger} type="button" className={`ui-select ${open ? 'open' : ''} ${className}`} disabled={disabled}
      aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? `${id}-list` : undefined} data-value={current} data-testid={testid}
      onClick={() => (open ? close() : show())} onKeyDown={onTrigger}>
      <span className="ui-select-value">{selected?.label ?? ' '}</span>
      <IconChevronDown size={13} className="ui-select-chevron" aria-hidden="true" />
    </button>
    {open && createPortal(
      <div ref={list} id={`${id}-list`} role="listbox" aria-label={rest['aria-label']} className={`ui-select-list ${pos?.up ? 'up' : ''}`} onKeyDown={onList}
        style={{ left: pos?.x ?? -9999, top: pos?.y ?? -9999, minWidth: pos?.w }} data-testid={testid ? `${testid}-list` : undefined}>
        {options.map((o, i) => <Fragment key={`${o.group ?? ''}/${o.value}/${i}`}>
          {o.group !== undefined && o.group !== options[i - 1]?.group && <div className="ui-select-group" role="presentation">{o.group}</div>}
          <div role="option" tabIndex={-1} data-index={i} data-value={o.value} aria-selected={o === selected} aria-disabled={o.disabled || undefined}
            className={`ui-select-option ${i === active ? 'active' : ''}`} onPointerMove={() => { if (!o.disabled && i !== active) setActive(i); }} onClick={() => pick(i)}>
            <span className="ui-select-label">{o.label}</span>
            <span className="ui-select-check" aria-hidden="true">{o === selected && <IconCheck size={13} />}</span>
          </div>
        </Fragment>)}
      </div>,
      document.body,
    )}
  </>;
});
