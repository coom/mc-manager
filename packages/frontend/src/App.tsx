import { lazy, Suspense, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AppLayout } from '@/components/layout/AppLayout';
import { PageLoader } from '@/components/shared/LoadingSpinner';
import { useAuthStore } from '@/stores/auth.store';
import { applyUserLanguage } from '@/hooks/use-auth';

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 30_000 } } });

const Login = lazy(() => import('@/pages/Login'));
const SetupPage = lazy(() => import('@/pages/SetupPage'));
const Dashboard = lazy(() => import('@/pages/Dashboard'));
const Console = lazy(() => import('@/pages/Console'));
const Backups = lazy(() => import('@/pages/Backups'));
const Players = lazy(() => import('@/pages/Players'));
const PlayerSheet = lazy(() => import('@/pages/PlayerSheet'));
const Mods = lazy(() => import('@/pages/Mods'));
const Journal = lazy(() => import('@/pages/Journal'));
const Config = lazy(() => import('@/pages/Config'));
const Audit = lazy(() => import('@/pages/Audit'));
const Settings = lazy(() => import('@/pages/Settings'));
const NotFound = lazy(() => import('@/pages/NotFound'));

export function App() {
  useEffect(() => { applyUserLanguage(useAuthStore.getState().user); }, []);
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Suspense fallback={<PageLoader />}>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/setup" element={<SetupPage />} />
            <Route element={<AppLayout />}>
              <Route path="/" element={<Navigate to="/dashboard" replace />} />
              <Route path="/dashboard" element={<Dashboard />} />
              <Route path="/console" element={<Console />} />
              <Route path="/players" element={<Players />} />
              <Route path="/players/:uuid" element={<PlayerSheet />} />
              <Route path="/mods" element={<Mods />} />
              <Route path="/journal" element={<Journal />} />
              <Route path="/config" element={<Config />} />
              <Route path="/backups" element={<Backups />} />
              <Route path="/audit" element={<Audit />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="*" element={<NotFound />} />
            </Route>
          </Routes>
        </Suspense>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
