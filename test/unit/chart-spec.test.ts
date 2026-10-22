// Unit tests of renderer/lib/chart-spec.ts: the ```chart block of an agent's reply is checked before Chart.js sees it;
// anything odd gives null (the block then shows as code).
import { describe, expect, it } from 'vitest';
import { MAX_POINTS, MAX_SERIES, chartRows, parseChartSpec } from '../../src/renderer/lib/chart-spec';

const spec = (o: unknown) => parseChartSpec(JSON.stringify(o));

describe('parseChartSpec', () => {
  it('reads the format the agents are told', () => {
    expect(spec({ type: 'bar', title: 'Costi', labels: ['lun', 'mar'], series: [{ name: 'Claude', data: [1.5, 2] }], unit: '$' }))
      .toEqual({ type: 'bar', title: 'Costi', labels: ['lun', 'mar'], series: [{ name: 'Claude', data: [1.5, 2] }], unit: '$' });
  });
  it('accepts the Chart.js shape, aliases and numeric strings', () => {
    expect(spec({ type: 'donut', data: { labels: ['a', 'b'], datasets: [{ label: 'x', data: ['3', 4] }] } }))
      .toEqual({ type: 'doughnut', labels: ['a', 'b'], series: [{ name: 'x', data: [3, 4] }] });
    expect(spec({ type: 'area', labels: [1, 2], data: [5, 6] })?.series).toEqual([{ name: '1', data: [5, 6] }]);
    expect(spec({ type: 'bar', labels: ['a'], series: [{ data: [1] }], indexAxis: 'y', stacked: true })).toMatchObject({ horizontal: true, stacked: true });
    expect(spec({ type: 'line', labels: ['a'], series: [{ data: [1] }], stacked: true })).not.toHaveProperty('stacked');
  });
  it('refuses what it cannot draw honestly', () => {
    expect(parseChartSpec('not json')).toBeNull();
    expect(parseChartSpec('[1,2]')).toBeNull();
    expect(spec({ type: 'radar', labels: ['a'], series: [{ data: [1] }] })).toBeNull();
    expect(spec({ type: 'bar', labels: ['a', 'b'], series: [{ data: [1] }] })).toBeNull(); // length mismatch
    expect(spec({ type: 'bar', labels: ['a'], series: [{ data: [null] }] })).toBeNull();
    expect(spec({ type: 'bar', labels: ['a'], series: [{ data: ['1e999'] }] })).toBeNull(); // Infinity
    expect(spec({ type: 'pie', labels: ['a'], series: [{ data: [1] }, { data: [2] }] })).toBeNull();
    expect(spec({ type: 'pie', labels: ['a', 'b'], series: [{ data: [1, -2] }] })).toBeNull();
    expect(spec({ type: 'bar', labels: [], series: [] })).toBeNull();
  });
  it('caps the size and the texts', () => {
    const labels = Array.from({ length: MAX_POINTS + 1 }, (_, i) => `${i}`);
    expect(spec({ type: 'line', labels, series: [{ data: labels.map(Number) }] })).toBeNull();
    expect(spec({ type: 'bar', labels: ['a'], series: Array.from({ length: MAX_SERIES + 1 }, () => ({ data: [1] })) })).toBeNull();
    const long = spec({ type: 'bar', title: `<b>${'x'.repeat(500)}`, labels: ['a'], series: [{ name: { evil: 1 }, data: [1] }] })!;
    expect(long.title!.length).toBe(120);
    expect(long.series[0]!.name).toBe('1');
  });
});

it('chartRows gives the table read by a screen reader', () => {
  expect(chartRows(spec({ type: 'bar', labels: ['a', 'b'], series: [{ name: 'x', data: [1, 2] }, { name: 'y', data: [3, 4] }] })!))
    .toEqual([['', 'x', 'y'], ['a', '1', '3'], ['b', '2', '4']]);
});
