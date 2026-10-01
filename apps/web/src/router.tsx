import type { ComponentType } from 'react';
import { createBrowserRouter, type RouteObject } from 'react-router';
import { AppLayout, AppSkeleton } from '@/components/layout/AppLayout';
import NotFoundPage, { RouteErrorPage } from '@/pages/NotFoundPage';

/** Code-split page: resolves a module's component for a lazy route. */
const page =
  <M,>(load: () => Promise<M>, pick: (m: M) => ComponentType) =>
  async () => ({ Component: pick(await load()) });

export const routes: RouteObject[] = [
  {
    path: '/',
    Component: AppLayout,
    HydrateFallback: AppSkeleton,
    ErrorBoundary: RouteErrorPage,
    children: [
      {
        ErrorBoundary: RouteErrorPage,
        children: [
          { index: true, lazy: page(() => import('@/pages/TrackPage'), (m) => m.default) },
          { path: 'results', lazy: page(() => import('@/pages/ResultsPage'), (m) => m.default) },
          { path: 'trains/:trainNumber', lazy: page(() => import('@/pages/TrainDetailPage'), (m) => m.default) },
          { path: 'reports/new', lazy: page(() => import('@/pages/ReportComposerPage'), (m) => m.default) },
          { path: 'monitoring', lazy: page(() => import('@/pages/MonitoringPage'), (m) => m.default) },
          { path: 'admin/providers', lazy: page(() => import('@/pages/ProvidersPage'), (m) => m.default) },
          { path: 'login', lazy: page(() => import('@/pages/AuthPages'), (m) => m.LoginPage) },
          { path: 'register', lazy: page(() => import('@/pages/AuthPages'), (m) => m.RegisterPage) },
          { path: 'shared/:token', lazy: page(() => import('@/pages/SharedReportPage'), (m) => m.default) },
          { path: '*', Component: NotFoundPage },
        ],
      },
    ],
  },
];

export function createAppRouter() {
  return createBrowserRouter(routes);
}
