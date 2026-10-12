import { useEffect } from 'react';
import { useUiStore } from '@/stores/ui.store';
import { useMediaQuery } from './use-media-query';

export type SidebarMode = 'mobile' | 'tablet' | 'desktop';

// Mêmes seuils que les préfixes Tailwind `md:` (768 px) et `lg:` (1024 px).
const MOBILE_MAX = '(max-width: 767.98px)';
const TABLET_MAX = '(max-width: 1023.98px)';

/**
 * État du menu latéral selon la largeur d'écran :
 * - desktop : repliable, préférence mémorisée (`sidebarCollapsed`) ;
 * - tablet : replié par défaut, dépliable pour la session (`tabletSidebarExpanded`) ;
 * - mobile : masqué, ouvert en tiroir par-dessus le contenu (`mobileNavOpen`).
 */
export function useSidebar() {
  const isMobile = useMediaQuery(MOBILE_MAX);
  const isTablet = useMediaQuery(TABLET_MAX) && !isMobile;
  const mode: SidebarMode = isMobile ? 'mobile' : isTablet ? 'tablet' : 'desktop';

  const sidebarCollapsed = useUiStore((s) => s.sidebarCollapsed);
  const tabletSidebarExpanded = useUiStore((s) => s.tabletSidebarExpanded);
  const mobileNavOpen = useUiStore((s) => s.mobileNavOpen);
  const toggleSidebar = useUiStore((s) => s.toggleSidebar);
  const setTabletSidebarExpanded = useUiStore((s) => s.setTabletSidebarExpanded);
  const setMobileNavOpen = useUiStore((s) => s.setMobileNavOpen);

  // Le tiroir n'a de sens que sur mobile : s'il reste ouvert quand la fenêtre
  // s'élargit (rotation, redimensionnement), le fond assombri bloquerait la page.
  useEffect(() => {
    if (!isMobile && mobileNavOpen) setMobileNavOpen(false);
  }, [isMobile, mobileNavOpen, setMobileNavOpen]);

  const collapsed = mode === 'desktop' ? sidebarCollapsed : mode === 'tablet' ? !tabletSidebarExpanded : false;

  return {
    mode,
    collapsed,
    navOpen: isMobile && mobileNavOpen,
    toggleCollapsed: () => {
      if (mode === 'tablet') setTabletSidebarExpanded(!tabletSidebarExpanded);
      else toggleSidebar();
    },
    openNav: () => setMobileNavOpen(true),
    closeNav: () => setMobileNavOpen(false),
  };
}
