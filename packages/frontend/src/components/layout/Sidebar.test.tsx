import { render, screen, fireEvent, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import i18n from '@/i18n';
import { useAuthStore } from '@/stores/auth.store';
import { useUiStore } from '@/stores/ui.store';
import { mapApi } from '@/api/map.api';
import { setViewportWidth } from '@/test-utils/viewport';
import { Sidebar } from './Sidebar';

vi.mock('@/api/map.api', () => ({ mapApi: { get: vi.fn(), set: vi.fn() } }));

function setup() {
  useAuthStore.setState({ accessToken: 't', refreshToken: 'r', user: { id: 1, username: 'u', displayName: 'U', role: 'admin' } });
  vi.mocked(mapApi.get).mockResolvedValue({ url: null });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/dashboard']}>
        <Sidebar />
        <Routes><Route path="*" element={<div>PAGE</div>} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('Sidebar', () => {
  beforeAll(async () => { await i18n.changeLanguage('en'); });
  beforeEach(() => { useUiStore.setState({ sidebarCollapsed: false, tabletSidebarExpanded: false, mobileNavOpen: false }); });

  it('on desktop, shows the labels and hides them once collapsed', () => {
    setViewportWidth(1280);
    setup();
    expect(screen.getByRole('link', { name: 'Console' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Collapse' }));
    expect(screen.queryByText('Console')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Console' })).toBeInTheDocument();
  });

  it('on tablet, starts with icons only and expands with the same button', () => {
    setViewportWidth(900);
    setup();
    expect(screen.queryByText('Console')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Expand' }));
    expect(screen.getByText('Console')).toBeInTheDocument();
    expect(useUiStore.getState().sidebarCollapsed).toBe(false);
  });

  it('on mobile, is a closed drawer that opens from the store and closes when a link is followed', () => {
    setViewportWidth(400);
    setup();
    const nav = screen.getByRole('navigation', { name: 'Main menu', hidden: true });
    expect(nav.closest('aside')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.queryByTestId('nav-backdrop')).not.toBeInTheDocument();

    act(() => useUiStore.getState().setMobileNavOpen(true));
    expect(screen.getByRole('navigation', { name: 'Main menu' }).closest('aside')).not.toHaveAttribute('aria-hidden');
    fireEvent.click(screen.getByRole('link', { name: 'Console' }));
    expect(useUiStore.getState().mobileNavOpen).toBe(false);
  });

  it('on mobile, closes when the backdrop is clicked or Escape is pressed', () => {
    setViewportWidth(400);
    setup();
    act(() => useUiStore.getState().setMobileNavOpen(true));
    fireEvent.click(screen.getByTestId('nav-backdrop'));
    expect(useUiStore.getState().mobileNavOpen).toBe(false);

    act(() => useUiStore.getState().setMobileNavOpen(true));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(useUiStore.getState().mobileNavOpen).toBe(false);
  });

  it('on mobile, never shows the collapse button', () => {
    setViewportWidth(400);
    setup();
    act(() => useUiStore.getState().setMobileNavOpen(true));
    expect(screen.queryByRole('button', { name: 'Collapse' })).not.toBeInTheDocument();
  });
});
