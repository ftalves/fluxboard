import type { Tool } from './tool';
import { useTool } from './tool';

const TOOLS: Array<{ tool: Tool; key: string; label: string; aria: string }> = [
  { tool: 'select', key: 'V', label: '↖', aria: 'Select tool' },
  { tool: 'rectangle', key: 'R', label: '▭', aria: 'Rectangle tool' },
  { tool: 'circle', key: 'O', label: '◯', aria: 'Circle tool' },
  { tool: 'text', key: 'T', label: 'T', aria: 'Text tool' },
  { tool: 'arrow', key: 'A', label: '→', aria: 'Arrow tool' },
];

export type ToolbarProps = { disabled?: boolean };

export function Toolbar({ disabled = false }: ToolbarProps) {
  const { tool, setTool } = useTool();
  return (
    <div
      data-testid="toolbar"
      role="toolbar"
      aria-label="Drawing tools"
      style={{
        position: 'absolute',
        top: 8,
        left: '50%',
        transform: 'translateX(-50%)',
        display: 'flex',
        gap: 4,
        padding: 4,
        background: 'white',
        border: '1px solid #d1d5db',
        borderRadius: 6,
        boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
        pointerEvents: disabled ? 'none' : 'auto',
        opacity: disabled ? 0.5 : 1,
        zIndex: 2,
      }}
    >
      {TOOLS.map((t) => {
        const active = t.tool === tool;
        return (
          <button
            key={t.tool}
            type="button"
            data-testid={`tool-${t.tool}`}
            aria-label={t.aria}
            aria-pressed={active}
            disabled={disabled}
            onClick={() => setTool(t.tool)}
            style={{
              minWidth: 32,
              height: 32,
              border: active ? '2px solid #3b82f6' : '1px solid #d1d5db',
              borderRadius: 4,
              background: active ? '#eff6ff' : 'white',
              cursor: disabled ? 'not-allowed' : 'pointer',
              fontSize: 16,
            }}
            title={`${t.aria} (${t.key})`}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}
