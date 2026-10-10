import { render, screen } from '@testing-library/react';
import { LogView } from './LogView';
const L = (level: 'INFO' | 'WARN' | 'ERROR' | 'RAW', message: string) => ({ ts: '10:00:00', level, thread: 'main', message, raw: message });

describe('LogView', () => {
  it('filters by level and text', () => {
    render(<LogView lines={[L('INFO', 'player joined'), L('WARN', 'lag spike'), L('ERROR', 'boom')]} filter="o" level="all" />);
    expect(screen.getByText('player joined')).toBeInTheDocument();
    expect(screen.getByText('boom')).toBeInTheDocument();
    expect(screen.queryByText('lag spike')).not.toBeInTheDocument();
  });
  it('keeps only warnings and errors when level is warn', () => {
    render(<LogView lines={[L('INFO', 'a'), L('WARN', 'b'), L('ERROR', 'c')]} filter="" level="warn" />);
    expect(screen.queryByText('a')).not.toBeInTheDocument();
    expect(screen.getByText('b')).toBeInTheDocument();
    expect(screen.getByText('c')).toBeInTheDocument();
  });
  it('scrolls on a new last line, but not when paused', () => {
    const spy = vi.fn();
    Element.prototype.scrollIntoView = spy;
    const { rerender } = render(<LogView lines={[L('INFO', 'a')]} filter="" level="all" />);
    spy.mockClear();
    rerender(<LogView lines={[L('INFO', 'a'), L('INFO', 'b')]} filter="" level="all" />);
    expect(spy).toHaveBeenCalled();
    spy.mockClear();
    rerender(<LogView lines={[L('INFO', 'a'), L('INFO', 'b'), L('INFO', 'c')]} filter="" level="all" paused />);
    expect(spy).not.toHaveBeenCalled();
  });
});
