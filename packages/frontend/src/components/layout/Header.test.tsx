import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import i18n from '@/i18n';
import { useAuthStore } from '@/stores/auth.store';
import { useUiStore } from '@/stores/ui.store';
import { setViewportWidth } from '@/test-utils/viewport';
import { Header } from './Header';

vi.mock('@/hooks/use-auth', () => ({ useLogout: () => vi.fn() }));

function setup() {
  useAuthStore.setState({ accessToken: 't', refreshToken: 'r', user: { id: 1, username: 'u', displayName: 'U', role: 'admin' } });
  render(<MemoryRouter><Header /></MemoryRouter>);
}

describe('Header', () => {
  beforeAll(async () => { await i18n.changeLanguage('en'); });
  beforeEach(() => { useUiStore.setState({ sidebarCollapsed: false, tabletSidebarExpanded: false, mobileNavOpen: false }); });

  it('on mobile, offers a menu button that opens the navigation drawer', () => {
    setViewportWidth(400);
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Open menu' }));
    expect(useUiStore.getState().mobileNavOpen).toBe(true);
    expect(screen.queryByRole('button', { name: 'Collapse' })).not.toBeInTheDocument();
  });

  it('on desktop, offers a button that collapses the sidebar instead', () => {
    setViewportWidth(1280);
    setup();
    expect(screen.queryByRole('button', { name: 'Open menu' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Collapse' }));
    expect(useUiStore.getState().sidebarCollapsed).toBe(true);
    expect(screen.getByRole('button', { name: 'Expand' })).toBeInTheDocument();
  });
});
