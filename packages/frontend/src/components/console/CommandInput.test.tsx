import { render, screen, fireEvent } from '@testing-library/react';
import { CommandInput } from './CommandInput';
import { useServerStore } from '@/stores/server.store';

describe('CommandInput', () => {
  beforeEach(() => { useServerStore.setState({ info: { players: { online: 2, max: 20, names: ['Alice', 'Bob'] } } as never }); });

  it('completes with Tab, cycles with Tab / Shift+Tab and closes with Escape', () => {
    render(<CommandInput onSend={vi.fn()} />);
    const input = screen.getByRole('textbox') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'give ' } });
    expect(screen.getByText('Alice')).toBeInTheDocument();
    fireEvent.keyDown(input, { key: 'Tab' });
    expect(input.value).toBe('give @a ');
    fireEvent.keyDown(input, { key: 'Tab' });
    expect(input.value).toBe('give @e ');
    fireEvent.keyDown(input, { key: 'Tab', shiftKey: true });
    expect(input.value).toBe('give @a ');
    fireEvent.change(input, { target: { value: 'give Alice dia' } });
    fireEvent.keyDown(input, { key: 'Tab' });
    expect(input.value).toBe('give Alice diamond ');
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByText('diamond')).not.toBeInTheDocument();
    expect(input.value).toBe('give Alice diamond ');
  });

  it('does nothing on Tab without candidates', () => {
    render(<CommandInput onSend={vi.fn()} />);
    const input = screen.getByRole('textbox') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'zzz' } });
    fireEvent.keyDown(input, { key: 'Tab' });
    expect(input.value).toBe('zzz');
  });

  it('submits on Enter and navigates history with arrows', () => {
    const onSend = vi.fn().mockResolvedValue('ok');
    render(<CommandInput onSend={onSend} />);
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'list' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSend).toHaveBeenCalledWith('list');
    fireEvent.change(input, { target: { value: 'tps' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    expect((input as HTMLInputElement).value).toBe('tps');
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    expect((input as HTMLInputElement).value).toBe('list');
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect((input as HTMLInputElement).value).toBe('tps');
  });
});
