import type { Tool } from './tool';

const KEY_TO_TOOL: Record<string, Tool> = {
  v: 'select',
  r: 'rectangle',
  o: 'circle',
  t: 'text',
  a: 'arrow',
};

export function keyToTool(key: string): Tool | null {
  return KEY_TO_TOOL[key.toLowerCase()] ?? null;
}

type TextEditCandidate = { tagName?: string; isContentEditable?: boolean } | null;

export function isTextEditTarget(target: TextEditCandidate): boolean {
  if (!target) return false;
  if (target.isContentEditable === true) return true;
  const tag = target.tagName ?? '';
  return tag === 'TEXTAREA' || tag === 'INPUT';
}
