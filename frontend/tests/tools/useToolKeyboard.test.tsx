import { act, fireEvent, render } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import { fluxStore } from '../../src/store/instance';
import { useTool } from '../../src/tools/tool';
import { ToolProvider } from '../../src/tools/ToolProvider';
import { useToolKeyboard } from '../../src/tools/useToolKeyboard';

function Probe({ cancelGesture }: { cancelGesture: () => void }) {
  useToolKeyboard({ cancelGesture });
  const { tool } = useTool();
  return <div data-testid="active-tool">{tool}</div>;
}

function renderProbe(cancelGesture = vi.fn()) {
  const utils = render(
    <ToolProvider>
      <Probe cancelGesture={cancelGesture} />
    </ToolProvider>,
  );
  return { ...utils, cancelGesture };
}

beforeEach(() => {
  act(() => {
    fluxStore.getState().hydrateFromSync('r', { elements: {}, arrows: {} });
    fluxStore.getState().setConnection({ kind: 'connected' });
  });
});

describe('useToolKeyboard — tool letter shortcuts', () => {
  test.each([
    ['v', 'select'],
    ['r', 'rectangle'],
    ['o', 'circle'],
    ['t', 'text'],
    ['a', 'arrow'],
  ])('"%s" → switches to %s', (key, expected) => {
    const { getByTestId, cancelGesture } = renderProbe();
    fireEvent.keyDown(window, { key });
    expect(getByTestId('active-tool').textContent).toBe(expected);
    expect(cancelGesture).toHaveBeenCalled();
  });

  test('letter shortcuts ignored when a textarea is focused', () => {
    const { getByTestId } = renderProbe();
    const textarea = document.createElement('textarea');
    document.body.appendChild(textarea);
    textarea.focus();
    fireEvent.keyDown(textarea, { key: 'r' });
    expect(getByTestId('active-tool').textContent).toBe('select');
    document.body.removeChild(textarea);
  });
});

describe('useToolKeyboard — Escape', () => {
  test('calls cancelGesture without switching tools', () => {
    const { getByTestId, cancelGesture } = renderProbe();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(cancelGesture).toHaveBeenCalled();
    expect(getByTestId('active-tool').textContent).toBe('select');
  });
});

describe('useToolKeyboard — Delete / Backspace', () => {
  test('Delete with element selection submits ElementDeleted and clears selection', () => {
    act(() => {
      fluxStore.getState().submitEvent({
        id: 'e1',
        timestamp: 0,
        userId: 'u',
        type: 'ElementCreated',
        payload: { id: 'r1', type: 'rectangle', x: 0, y: 0, width: 10, height: 10 },
      });
      fluxStore.getState().setSelection({ kind: 'element', id: 'r1' });
    });
    renderProbe();
    act(() => {
      fireEvent.keyDown(window, { key: 'Delete' });
    });
    expect(fluxStore.getState().diagram.elements['r1']).toBeUndefined();
    expect(fluxStore.getState().selection).toEqual({ kind: 'none' });
  });

  test('Delete is a no-op while disconnected', () => {
    act(() => {
      fluxStore.getState().submitEvent({
        id: 'e1',
        timestamp: 0,
        userId: 'u',
        type: 'ElementCreated',
        payload: { id: 'r1', type: 'rectangle', x: 0, y: 0, width: 10, height: 10 },
      });
      fluxStore.getState().setSelection({ kind: 'element', id: 'r1' });
      fluxStore.getState().setConnection({ kind: 'reconnecting', attempt: 1, retryAt: 0 });
    });
    renderProbe();
    fireEvent.keyDown(window, { key: 'Delete' });
    expect(fluxStore.getState().diagram.elements['r1']).toBeDefined();
  });

  test('Delete ignored when textarea has focus', () => {
    act(() => {
      fluxStore.getState().submitEvent({
        id: 'e1',
        timestamp: 0,
        userId: 'u',
        type: 'ElementCreated',
        payload: { id: 'r1', type: 'rectangle', x: 0, y: 0, width: 10, height: 10 },
      });
      fluxStore.getState().setSelection({ kind: 'element', id: 'r1' });
    });
    renderProbe();
    const textarea = document.createElement('textarea');
    document.body.appendChild(textarea);
    textarea.focus();
    fireEvent.keyDown(textarea, { key: 'Delete' });
    expect(fluxStore.getState().diagram.elements['r1']).toBeDefined();
    document.body.removeChild(textarea);
  });
});
