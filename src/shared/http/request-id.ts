import type { IncomingMessage } from 'node:http';

export function requestIdOf(req: IncomingMessage): string {
  return typeof req.id === 'string' ? req.id : '';
}
