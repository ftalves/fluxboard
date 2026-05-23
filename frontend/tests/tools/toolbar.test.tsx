import { fireEvent, render } from '@testing-library/react';
import { describe, expect, test } from 'vitest';

import { Toolbar } from '../../src/tools/Toolbar';
import { ToolProvider } from '../../src/tools/ToolProvider';

function renderToolbar(props: { disabled?: boolean } = {}) {
  return render(
    <ToolProvider>
      <Toolbar {...props} />
    </ToolProvider>,
  );
}

describe('Toolbar', () => {
  test('renders five tool buttons in order', () => {
    const { getByTestId } = renderToolbar();
    ['select', 'rectangle', 'circle', 'text', 'arrow'].forEach((t) => {
      expect(getByTestId(`tool-${t}`)).toBeInTheDocument();
    });
  });

  test('the default tool (select) is marked aria-pressed', () => {
    const { getByTestId } = renderToolbar();
    expect(getByTestId('tool-select').getAttribute('aria-pressed')).toBe('true');
    expect(getByTestId('tool-rectangle').getAttribute('aria-pressed')).toBe('false');
  });

  test('clicking a button switches the active tool', () => {
    const { getByTestId } = renderToolbar();
    fireEvent.click(getByTestId('tool-rectangle'));
    expect(getByTestId('tool-rectangle').getAttribute('aria-pressed')).toBe('true');
    expect(getByTestId('tool-select').getAttribute('aria-pressed')).toBe('false');
  });

  test('disabled prop disables every button', () => {
    const { getByTestId } = renderToolbar({ disabled: true });
    ['select', 'rectangle', 'circle', 'text', 'arrow'].forEach((t) => {
      expect((getByTestId(`tool-${t}`) as HTMLButtonElement).disabled).toBe(true);
    });
  });
});
