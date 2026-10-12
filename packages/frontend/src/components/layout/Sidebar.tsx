import type React from 'react';
import { useEffect } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { LayoutDashboard, Terminal, Archive, History, Settings, ChevronLeft, ChevronRight, Users, BookOpenText, SlidersHorizontal, Puzzle, Globe, Map, X } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { mapApi } from '@/api/map.api';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { useSidebar } from '@/hooks/use-sidebar';
import { useAuthStore } from '@/stores/auth.store';
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';

type NavItem = { to: string; icon: React.ComponentType<{ className?: string }>; label: string; adminOnly?: boolean; requiresMap?: boolean };
const navSections: { label: string; adminOnly?: boolean; items: NavItem[] }[] = [
  { label: 'nav.server', items: [
    { to: '/dashboard', icon: LayoutDashboard, label: 'nav.dashboard' },
    { to: '/console', icon: Terminal, label: 'nav.console' },
    { to: '/players', icon: Users, label: 'nav.players' },
    { to: '/mods', icon: Puzzle, label: 'nav.mods' },
    { to: '/config', icon: SlidersHorizontal, label: 'nav.config', adminOnly: true },
    { to: '/world', icon: Globe, label: 'nav.world', adminOnly: true },
    // Visible seulement quand une adresse de carte est configurée (Paramètres).
    { to: '/map', icon: Map, label: 'nav.map', requiresMap: true },
  ] },
  { label: 'nav.data', items: [
    { to: '/backups', icon: Archive, label: 'nav.backups' },
    { to: '/journal', icon: BookOpenText, label: 'nav.journal', adminOnly: true },
    { to: '/audit', icon: History, label: 'nav.audit' },
  ] },
];

/**
 * Menu latéral. Sur PC et tablette il fait partie du flux (repliable en icônes,
 * voir `useSidebar`) ; sur téléphone il devient un tiroir fixé par-dessus le
 * contenu, ouvert depuis le bouton du `Header` et fermé au clic sur un lien,
 * sur le fond assombri ou avec Échap.
 */
export function Sidebar() {
  const { mode, collapsed, navOpen, toggleCollapsed, closeNav } = useSidebar();
  const isMobile = mode === 'mobile';
  const isAdmin = useAuthStore((s) => s.isAdmin());
  const location = useLocation();
  const { t } = useTranslation();
  const { data: map } = useQuery({ queryKey: ['map'], queryFn: mapApi.get, staleTime: 5 * 60_000 });
  const hasMap = Boolean(map?.url);

  useEffect(() => {
    if (!navOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeNav(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [navOpen, closeNav]);

  const onNavigate = () => { if (isMobile) closeNav(); };

  return (
    <TooltipProvider delayDuration={0}>
      {isMobile && navOpen && (
        <div data-testid="nav-backdrop" aria-hidden="true" className="fixed inset-0 z-40 bg-black/60" onClick={closeNav} />
      )}
      <aside
        aria-hidden={isMobile && !navOpen ? true : undefined}
        className={cn(
          'flex flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-all duration-300 ease-in-out',
          isMobile
            ? cn('fixed inset-y-0 left-0 z-50 w-64 shadow-2xl', navOpen ? 'translate-x-0' : '-translate-x-full pointer-events-none')
            : cn('relative shrink-0', collapsed ? 'w-16' : 'w-56'),
        )}
      >
        {/* Logo area */}
        <div className={cn('flex items-center h-14 px-4 border-b border-sidebar-border', collapsed && 'justify-center px-0')}>
          <div className="h-7 w-7 rounded-md bg-primary/20 flex items-center justify-center shrink-0">
            <span className="text-primary font-bold text-xs font-mono-data">MC</span>
          </div>
          {!collapsed && (
            <div className="ml-2.5">
              <span className="text-sm font-semibold text-sidebar-accent-foreground">MC</span>
              <span className="text-sm text-sidebar-foreground ml-1">Manager</span>
            </div>
          )}
          {isMobile && (
            <button
              type="button"
              onClick={closeNav}
              aria-label={t('nav.closeMenu')}
              className="ml-auto rounded-md p-1.5 text-sidebar-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        {/* Navigation */}
        <ScrollArea className="flex-1 py-2">
          <nav aria-label={t('nav.mainMenu')} className="space-y-1 px-2">
            {navSections
              .filter((section) => !section.adminOnly || isAdmin)
              .map((section, si) => {
                const visibleItems = section.items.filter((item) => (!item.adminOnly || isAdmin) && (!item.requiresMap || hasMap));
                if (visibleItems.length === 0) return null;
                return (
                  <div key={section.label}>
                    {si > 0 && <Separator className="my-2 bg-sidebar-border" />}
                    {!collapsed && (
                      <p className="px-2 py-1 text-[10px] font-semibold uppercase tracking-widest text-sidebar-foreground/40">
                        {t(section.label)}
                      </p>
                    )}
                    {visibleItems.map((item) => {
                      const isActive = location.pathname === item.to || location.pathname.startsWith(item.to + '/');
                      const link = (
                        <NavLink
                          key={item.to}
                          to={item.to}
                          onClick={onNavigate}
                          aria-label={collapsed ? t(item.label) : undefined}
                          className={cn(
                            'flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm transition-all duration-150',
                            collapsed && 'justify-center px-0 py-2',
                            isActive
                              ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                              : 'text-sidebar-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground',
                          )}
                        >
                          <item.icon className={cn('h-4 w-4 shrink-0', isActive && 'text-primary')} />
                          {!collapsed && <span>{t(item.label)}</span>}
                        </NavLink>
                      );

                      if (collapsed) {
                        return (
                          <Tooltip key={item.to}>
                            <TooltipTrigger asChild>{link}</TooltipTrigger>
                            <TooltipContent side="right" className="font-medium">
                              {t(item.label)}
                            </TooltipContent>
                          </Tooltip>
                        );
                      }
                      return link;
                    })}
                  </div>
                );
              })}
          </nav>
        </ScrollArea>

        {/* Settings + Collapse */}
        <div className="border-t border-sidebar-border p-2 space-y-1">
          <NavLink
            to="/settings"
            onClick={onNavigate}
            aria-label={collapsed ? t('nav.settings') : undefined}
            className={cn(
              'flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm text-sidebar-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground transition-colors',
              collapsed && 'justify-center px-0 py-2',
              location.pathname.startsWith('/settings') && 'bg-sidebar-accent text-sidebar-accent-foreground',
            )}
          >
            <Settings className="h-4 w-4" />
            {!collapsed && <span>{t('nav.settings')}</span>}
          </NavLink>

          {!isMobile && (
            <button
              type="button"
              onClick={toggleCollapsed}
              aria-label={collapsed ? t('nav.expand') : t('nav.collapse')}
              title={collapsed ? t('nav.expand') : t('nav.collapse')}
              className={cn(
                'flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm text-sidebar-foreground hover:bg-sidebar-accent/50 transition-colors w-full',
                collapsed && 'justify-center px-0 py-2',
              )}
            >
              {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
              {!collapsed && <span>{t('nav.collapse')}</span>}
            </button>
          )}
        </div>
      </aside>
    </TooltipProvider>
  );
}
