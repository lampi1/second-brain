// Flow evidence links leave fullscreen before handing navigation to the app's file viewer.
import type { ReactElement } from 'react';
import { expect, it, vi } from 'vitest';
const openFile = vi.hoisted(() => vi.fn());
vi.mock('../../src/renderer/sb', () => ({ sb: { invoke: vi.fn(), on: vi.fn() } }));
vi.mock('../../src/renderer/components/GenUi', () => ({ openFile }));
import { FlowLinks } from '../../src/renderer/components/FlowDefinition';
it('closes the local fullscreen layer before opening a file with its original chat context', () => {
  const order: string[] = [];
  openFile.mockImplementation(() => { order.push('viewer'); return Promise.resolve(); });
  const tree = FlowLinks({ sources: ['[Report](file:///tmp/report.md)'], chatId: 'report-chat', onNavigate: () => order.push('close') })!;
  const button = (tree.props.children as ReactElement<{ onClick: () => void }>[])[0]!;
  button.props.onClick();
  expect(order).toEqual(['close', 'viewer']); expect(openFile).toHaveBeenCalledWith('file:///tmp/report.md', 'report-chat');
});
