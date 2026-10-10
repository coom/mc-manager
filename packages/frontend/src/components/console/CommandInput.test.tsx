import { render, screen, fireEvent } from '@testing-library/react';
import { CommandInput } from './CommandInput';

describe('CommandInput', () => {
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
