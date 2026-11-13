// A page's ErrorBoundary (ADR 0192, renderer/components/ErrorBoundary.tsx) without a DOM: a render error turns its page
// into the Italian card with «Ricarica la pagina» and the details, is reported once to the `renderer` log with the
// page's name and the component stack, and the reload mounts the children again (a new key).
import { describe, expect, it, vi } from 'vitest';
import { createElement, isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const reportUiError = vi.hoisted(() => vi.fn());
vi.mock('../../src/renderer/lib/ui-errors', () => ({ reportUiError }));
vi.mock('../../src/renderer/i18n', async () => {
  const { it: dict } = await import('../../src/renderer/i18n/it');
  return { t: (k: string) => (dict as Record<string, unknown>)[k] ?? k };
});
const { ErrorBoundary } = await import('../../src/renderer/components/ErrorBoundary');

const child = createElement('p', null, 'contenuto');
const make = (where = 'memoria') => {
  const b = new ErrorBoundary({ where, children: child });
  b.setState = ((u: unknown) => { const next = typeof u === 'function' ? (u as (s: typeof b.state) => Partial<typeof b.state>)(b.state) : u; b.state = { ...b.state, ...(next as object) }; }) as typeof b.setState;
  return b;
};

describe('ErrorBoundary', () => {
  it('renders its children while nothing failed', () => {
    const b = make();
    expect(renderToStaticMarkup(b.render() as ReactElement)).toBe('<p>contenuto</p>');
  });

  it('shows the card with reload and details after a render error, and reports it once', () => {
    const b = make();
    b.state = { ...b.state, ...ErrorBoundary.getDerivedStateFromError(new TypeError('x is undefined')) };
    b.componentDidCatch(new TypeError('x is undefined'), { componentStack: '\n    at MemoryPage' });
    expect(reportUiError).toHaveBeenCalledWith('render', expect.any(TypeError), { where: 'memoria', componentStack: '\n    at MemoryPage' });
    const html = renderToStaticMarkup(b.render() as ReactElement);
    expect(html).toContain('Questa pagina ha avuto un errore');
    expect(html).toContain('Ricarica la pagina');
    expect(html).toContain('TypeError: x is undefined');
    expect(html).toContain('data-testid="error-boundary-memoria"');
    expect(html).toContain('role="alert"');
  });

  it('«Ricarica la pagina» mounts the children again with a new key', () => {
    const b = make();
    const first = b.render() as ReactElement;
    b.state = { ...b.state, ...ErrorBoundary.getDerivedStateFromError('a string thrown') };
    expect(b.state.error?.message).toBe('a string thrown');
    const card = b.render() as ReactElement;
    const button = find(card, e => (e.props as Record<string, unknown>)['data-testid'] === 'error-boundary-reload')!;
    (button.props as { onClick: () => void }).onClick();
    const again = b.render() as ReactElement;
    expect(b.state.error).toBeNull();
    expect(again.key).not.toBe(first.key);
    expect(renderToStaticMarkup(again)).toBe('<p>contenuto</p>');
  });
});

function find(node: ReactNode, ok: (e: ReactElement) => boolean): ReactElement | null {
  if (Array.isArray(node)) { for (const n of node) { const f = find(n, ok); if (f) return f; } return null; }
  if (!isValidElement(node)) return null;
  if (ok(node)) return node;
  return find((node.props as { children?: ReactNode }).children, ok);
}
