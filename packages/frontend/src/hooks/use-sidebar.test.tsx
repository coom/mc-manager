import { act, renderHook } from '@testing-library/react';
import { setViewportWidth } from '@/test-utils/viewport';
import { useUiStore } from '@/stores/ui.store';
import { useSidebar } from './use-sidebar';

describe('useSidebar', () => {
  beforeEach(() => {
    useUiStore.setState({ sidebarCollapsed: false, tabletSidebarExpanded: false, mobileNavOpen: false });
    setViewportWidth(1280);
  });

  it('on desktop, follows the persisted preference and toggles it', () => {
    const { result } = renderHook(() => useSidebar());
    expect(result.current.mode).toBe('desktop');
    expect(result.current.collapsed).toBe(false);
    act(() => result.current.toggleCollapsed());
    expect(result.current.collapsed).toBe(true);
    expect(useUiStore.getState().sidebarCollapsed).toBe(true);
  });

  it('on tablet, starts collapsed regardless of the preference and expands without touching it', () => {
    setViewportWidth(900);
    const { result } = renderHook(() => useSidebar());
    expect(result.current.mode).toBe('tablet');
    expect(result.current.collapsed).toBe(true);
    act(() => result.current.toggleCollapsed());
    expect(result.current.collapsed).toBe(false);
    expect(useUiStore.getState().sidebarCollapsed).toBe(false);
  });

  it('on mobile, exposes a closed drawer that opens and closes', () => {
    setViewportWidth(400);
    const { result } = renderHook(() => useSidebar());
    expect(result.current.mode).toBe('mobile');
    expect(result.current.collapsed).toBe(false);
    expect(result.current.navOpen).toBe(false);
    act(() => result.current.openNav());
    expect(result.current.navOpen).toBe(true);
    act(() => result.current.closeNav());
    expect(result.current.navOpen).toBe(false);
  });

  it('closes the drawer when the viewport grows past the mobile breakpoint', () => {
    setViewportWidth(400);
    const { result } = renderHook(() => useSidebar());
    act(() => result.current.openNav());
    act(() => setViewportWidth(1280));
    expect(result.current.mode).toBe('desktop');
    expect(result.current.navOpen).toBe(false);
  });

  it('does not persist the drawer or tablet state', () => {
    const persisted = JSON.parse(localStorage.getItem('mc-ui') ?? '{}') as { state?: Record<string, unknown> };
    useUiStore.setState({ mobileNavOpen: true, tabletSidebarExpanded: true, sidebarCollapsed: true });
    const after = JSON.parse(localStorage.getItem('mc-ui') ?? '{}') as { state?: Record<string, unknown> };
    expect(after.state).toMatchObject({ sidebarCollapsed: true });
    expect(after.state).not.toHaveProperty('mobileNavOpen');
    expect(after.state).not.toHaveProperty('tabletSidebarExpanded');
    void persisted;
  });
});
