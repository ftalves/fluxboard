import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';

import { DEFAULT_TOOL, ToolContext } from './tool';
import type { Tool } from './tool';

export type ToolProviderProps = { children: ReactNode; initialTool?: Tool };

export function ToolProvider({ children, initialTool = DEFAULT_TOOL }: ToolProviderProps) {
  const [tool, setTool] = useState<Tool>(initialTool);
  const value = useMemo(() => ({ tool, setTool }), [tool]);
  return <ToolContext.Provider value={value}>{children}</ToolContext.Provider>;
}
