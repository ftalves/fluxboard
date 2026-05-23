import { createContext, useContext } from 'react';

export type Tool = 'select' | 'rectangle' | 'circle' | 'text' | 'arrow';

export const DEFAULT_TOOL: Tool = 'select';

export type ToolContextValue = {
  tool: Tool;
  setTool: (t: Tool) => void;
};

export const ToolContext = createContext<ToolContextValue | null>(null);

export function useTool(): ToolContextValue {
  const ctx = useContext(ToolContext);
  if (!ctx) throw new Error('useTool must be used inside <ToolProvider>');
  return ctx;
}
