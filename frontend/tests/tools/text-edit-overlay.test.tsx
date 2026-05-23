import { act, fireEvent, render } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import { fluxStore } from '../../src/store/instance';
import { TEXT_DEBOUNCE_MS } from '../../src/tools/constants';
import { TextEditOverlay } from '../../src/tools/TextEditOverlay';

const VP = { scale: 1, offset: { x: 0, y: 0 } };

beforeEach(() => {
  vi.useFakeTimers();
  act(() => {
    fluxStore.getState().hydrateFromSync('r', { elements: {}, arrows: {} });
    fluxStore.getState().setConnection({ kind: 'connected' });
    fluxStore.getState().submitEvent({
      id: 'e1',
      timestamp: 0,
      userId: 'u',
      type: 'ElementCreated',
      payload: { id: 't1', type: 'text', x: 10, y: 20, width: 100, height: 24, text: '' },
    });
  });
});

describe('TextEditOverlay', () => {
  test('renders nothing while no element is in edit mode', () => {
    const { queryByTestId } = render(<TextEditOverlay vp={VP} />);
    expect(queryByTestId('text-edit-overlay')).toBeNull();
    vi.useRealTimers();
  });

  test('renders a textarea anchored to the element bbox when editing is active', () => {
    act(() => fluxStore.getState().beginTextEdit('t1'));
    const { getByTestId } = render(<TextEditOverlay vp={VP} />);
    const ta = getByTestId('text-edit-overlay') as HTMLTextAreaElement;
    expect(ta.style.left).toBe('10px');
    expect(ta.style.top).toBe('20px');
    expect(ta.style.width).toBe('100px');
    vi.useRealTimers();
  });

  test('typing schedules a debounced ElementTextUpdated emit', () => {
    act(() => fluxStore.getState().beginTextEdit('t1'));
    const { getByTestId } = render(<TextEditOverlay vp={VP} />);
    const ta = getByTestId('text-edit-overlay');
    fireEvent.change(ta, { target: { value: 'hello' } });
    expect(fluxStore.getState().diagram.elements['t1']?.text).toBe('');
    act(() => {
      vi.advanceTimersByTime(TEXT_DEBOUNCE_MS);
    });
    expect(fluxStore.getState().diagram.elements['t1']?.text).toBe('hello');
    vi.useRealTimers();
  });

  test('blur flushes the pending emit and ends edit mode', () => {
    act(() => fluxStore.getState().beginTextEdit('t1'));
    const { getByTestId } = render(<TextEditOverlay vp={VP} />);
    const ta = getByTestId('text-edit-overlay');
    fireEvent.change(ta, { target: { value: 'fast' } });
    act(() => {
      fireEvent.blur(ta);
    });
    expect(fluxStore.getState().diagram.elements['t1']?.text).toBe('fast');
    expect(fluxStore.getState().textEditingElementId).toBeNull();
    vi.useRealTimers();
  });

  test('Escape blurs the textarea (which commits and ends edit)', () => {
    act(() => fluxStore.getState().beginTextEdit('t1'));
    const { getByTestId } = render(<TextEditOverlay vp={VP} />);
    const ta = getByTestId('text-edit-overlay') as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: 'esc' } });
    act(() => {
      fireEvent.keyDown(ta, { key: 'Escape' });
    });
    expect(fluxStore.getState().textEditingElementId).toBeNull();
    vi.useRealTimers();
  });
});
