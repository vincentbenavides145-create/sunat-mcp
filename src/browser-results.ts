/** Shapes of the MCP tool results produced by browser batches. */

import { compactBrowserResults } from './native-browser.js';
import { session } from './session-state.js';

export function browserError(message: string) {
  return { content: [{ type: 'text' as const, text: message }], isError: true as const };
}

export function browserBatchResponse(outputs: unknown[]) {
  const steps = compactBrowserResults(outputs);
  const job = session.activeJobId && session.workStore ? session.workStore.get(session.activeJobId) : undefined;
  return { content: [{ type: 'text' as const, text: JSON.stringify(steps) }], structuredContent: { steps, ...(job ? { job } : {}) }, ...(hasBrowserActionError(outputs) ? { isError: true as const } : {}) };
}

export function hasBrowserActionError(result: unknown): boolean {
  const items = Array.isArray(result) ? result : [result];
  return items.some((item) => Boolean(item && typeof item === 'object' && ('error' in item || ('success' in item && item.success === false))));
}
