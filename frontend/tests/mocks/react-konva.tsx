import * as React from 'react';

type AnyProps = Record<string, unknown> & { children?: React.ReactNode };

function serializeProp(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'function') return '[fn]';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function isEventHandlerKey(key: string): boolean {
  return /^on[A-Z]/.test(key);
}

function konvaStub(tag: string, role: string) {
  const Component = React.forwardRef<HTMLDivElement, AnyProps>(function KonvaStub(props, ref) {
    const { children, ...rest } = props;
    const passthrough: Record<string, unknown> = { 'data-konva': role, ref };
    for (const [key, value] of Object.entries(rest)) {
      if (typeof value === 'function' && isEventHandlerKey(key)) {
        passthrough[key] = value;
        continue;
      }
      passthrough[`data-${key.toLowerCase()}`] = serializeProp(value);
    }
    return React.createElement(tag, passthrough, children as React.ReactNode);
  });
  Component.displayName = `KonvaStub(${role})`;
  return Component;
}

export const Stage = konvaStub('div', 'Stage');
export const Layer = konvaStub('div', 'Layer');
export const Group = konvaStub('div', 'Group');
export const Rect = konvaStub('div', 'Rect');
export const Ellipse = konvaStub('div', 'Ellipse');
export const Text = konvaStub('div', 'Text');
export const Line = konvaStub('div', 'Line');
export const Arrow = konvaStub('div', 'Arrow');
export const Transformer = konvaStub('div', 'Transformer');
