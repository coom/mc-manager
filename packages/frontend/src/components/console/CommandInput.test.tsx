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
    // Les sélecteurs portent une explication entre parenthèses, affichée seulement.
    expect(screen.getByRole('option', { name: /^@a \(.+\)$/ })).toBeInTheDocument();
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

  it('swallows a space typed right after a completion and collapses space runs on send', () => {
    const onSend = vi.fn().mockResolvedValue('ok');
    render(<CommandInput onSend={onSend} />);
    const input = screen.getByRole('textbox') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'give Al' } });
    fireEvent.keyDown(input, { key: 'Tab' });
    expect(input.value).toBe('give Alice ');
    fireEvent.change(input, { target: { value: 'give Alice  ' } });
    expect(input.value).toBe('give Alice ');
    // L'espace a validé le choix : Tab complète la position suivante au lieu de cycler sur les joueurs.
    fireEvent.keyDown(input, { key: 'Tab' });
    expect(input.value).toMatch(/^give Alice [a-z_]+ $/);
    fireEvent.change(input, { target: { value: ' give  Alice   diamond  4 ' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSend).toHaveBeenCalledWith('give Alice diamond 4');
  });

  it('lets Tab move focus when there is nothing to complete', () => {
    render(<CommandInput onSend={vi.fn()} />);
    const input = screen.getByRole('textbox') as HTMLInputElement;
    expect(fireEvent.keyDown(input, { key: 'Tab' })).toBe(true);
    fireEvent.change(input, { target: { value: 'zzz' } });
    expect(fireEvent.keyDown(input, { key: 'Tab' })).toBe(true);
    expect(input.value).toBe('zzz');
    fireEvent.change(input, { target: { value: 'give ' } });
    expect(fireEvent.keyDown(input, { key: 'Tab' })).toBe(false);
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(fireEvent.keyDown(input, { key: 'Tab' })).toBe(true);
  });

  it('starts from the last candidate on Shift+Tab and keeps the selection visible past the window', () => {
    render(<CommandInput onSend={vi.fn()} />);
    const input = screen.getByRole('textbox') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'give Alice ' } });
    fireEvent.keyDown(input, { key: 'Tab', shiftKey: true });
    const last = input.value.trim().split(' ').pop()!;
    expect(screen.getByRole('option', { name: last })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('…')).toBeInTheDocument();
    expect(screen.getAllByRole('option')).toHaveLength(20);
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
