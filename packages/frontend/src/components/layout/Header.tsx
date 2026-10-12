import { LogOut, Menu, PanelLeftClose, PanelLeftOpen, User } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { ThemeToggle } from '@/components/shared/ThemeToggle';
import { LanguageSwitcher } from '@/components/shared/LanguageSwitcher';
import { useAuthStore } from '@/stores/auth.store';
import { useSidebar } from '@/hooks/use-sidebar';
import { useLogout } from '@/hooks/use-auth';
import { useTranslation } from 'react-i18next';

export function Header() {
  const { user } = useAuthStore();
  const logout = useLogout();
  const { t } = useTranslation();
  const { mode, collapsed, toggleCollapsed, openNav } = useSidebar();
  const toggleLabel = collapsed ? t('nav.expand') : t('nav.collapse');

  return (
    <header className="flex items-center justify-between gap-2 h-14 px-3 sm:px-5 border-b border-border bg-card/50 backdrop-blur-sm">
      <div className="flex items-center gap-2 min-w-0">
        {mode === 'mobile' ? (
          <>
            <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={t('nav.openMenu')} onClick={openNav}>
              <Menu className="h-5 w-5" />
            </Button>
            <span className="truncate text-sm font-semibold">MC<span className="ml-1 font-normal text-muted-foreground">Manager</span></span>
          </>
        ) : (
          <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground" aria-label={toggleLabel} title={toggleLabel} onClick={toggleCollapsed}>
            {collapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
          </Button>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-1 sm:gap-2">
        <LanguageSwitcher />
        <ThemeToggle />

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="h-8 gap-2 px-2">
              <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/20">
                <User className="h-3 w-3 text-primary" />
              </div>
              <span className="hidden text-xs sm:inline">{user?.displayName}</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuLabel className="font-normal">
              <p className="text-sm font-medium">{user?.displayName}</p>
              <p className="text-xs text-muted-foreground capitalize">{user?.role}</p>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={logout} className="text-destructive focus:text-destructive">
              <LogOut className="mr-2 h-4 w-4" />
              <span>{t('nav.logout')}</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
