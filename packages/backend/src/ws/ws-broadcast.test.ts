import { describe, it, expect, vi } from 'vitest';
import { broadcast } from './ws-broadcast.js';

describe('broadcast', () => {
  it('sends the JSON message to every open socket only', () => {
    const open = { readyState: 1, authed: true, send: vi.fn() };
    const pending = { readyState: 1, send: vi.fn() };
    const closed = { readyState: 3, authed: true, send: vi.fn() };
    broadcast({ clients: new Set([open, pending, closed]) } as never, { type: 'backup.list.changed' });
    expect(open.send).toHaveBeenCalledWith('{"type":"backup.list.changed"}');
    expect(pending.send).not.toHaveBeenCalled();
    expect(closed.send).not.toHaveBeenCalled();
  });
});
