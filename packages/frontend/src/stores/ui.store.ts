import { create } from 'zustand';
import { persist } from 'zustand/middleware';

function applyTheme(theme: 'dark' | 'light') {
  if (theme === 'dark') {
    document.documentElement.classList.add('dark');
  } else {
    document.documentElement.classList.remove('dark');
  }
}

interface UiStore {
  /** Préférence PC, mémorisée. */
  sidebarCollapsed: boolean;
  /** Tablette : menu déplié pour la session (replié par défaut), non mémorisé. */
  tabletSidebarExpanded: boolean;
  /** Téléphone : tiroir de navigation ouvert, non mémorisé. */
  mobileNavOpen: boolean;
  theme: 'dark' | 'light';
  toggleSidebar: () => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  setTabletSidebarExpanded: (expanded: boolean) => void;
  setMobileNavOpen: (open: boolean) => void;
  toggleTheme: () => void;
  setTheme: (theme: 'dark' | 'light') => void;
}

export const useUiStore = create<UiStore>()(
  persist(
    (set, get) => ({
      sidebarCollapsed: false,
      tabletSidebarExpanded: false,
      mobileNavOpen: false,
      theme: 'dark',
      toggleSidebar: () => set({ sidebarCollapsed: !get().sidebarCollapsed }),
      setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),
      setTabletSidebarExpanded: (expanded) => set({ tabletSidebarExpanded: expanded }),
      setMobileNavOpen: (open) => set({ mobileNavOpen: open }),
      toggleTheme: () => {
        const next = get().theme === 'dark' ? 'light' : 'dark';
        set({ theme: next });
        applyTheme(next);
      },
      setTheme: (theme) => {
        set({ theme });
        applyTheme(theme);
      },
    }),
    {
      name: 'mc-ui',
      partialize: (s) => ({ sidebarCollapsed: s.sidebarCollapsed, theme: s.theme }),
      onRehydrateStorage: () => (state) => {
        if (state?.theme) {
          applyTheme(state.theme);
        }
      },
    },
  ),
);
