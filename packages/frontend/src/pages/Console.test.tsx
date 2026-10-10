import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18n from '@/i18n';
import { useServerStore } from '@/stores/server.store';
import Console from './Console';

const L = (message: string) => ({ ts: '10:00:00', level: 'INFO' as const, thread: 'main', message, raw: message });

describe('Console pause/resume', () => {
  beforeAll(async () => { await i18n.changeLanguage('en'); });

  it('freezes the view while paused and catches up on resume', async () => {
    const user = userEvent.setup();
    useServerStore.setState({ logs: [L('one'), L('two')] });
    render(<Console />);
    await user.click(screen.getByRole('button', { name: 'Pause' }));
    act(() => { useServerStore.getState().apply({ type: 'log.line', line: L('three') }); });
    expect(screen.queryByText('three')).not.toBeInTheDocument();
    expect(screen.getByText('two')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Resume' }));
    expect(screen.getByText('three')).toBeInTheDocument();
  });
});
