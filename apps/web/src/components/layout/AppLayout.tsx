import { Outlet, ScrollRestoration } from 'react-router';
import { Toaster } from 'sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { DemoBanner } from './DemoBanner';
import { Footer } from './Footer';
import { Header } from './Header';

export function AppLayout() {
  return (
    <TooltipProvider>
      <div className="flex min-h-dvh flex-col">
        <a
          href="#main"
          className="sr-only z-50 rounded-md bg-primary px-3 py-2 text-primary-foreground focus:not-sr-only focus:fixed focus:left-3 focus:top-3"
        >
          Skip to content
        </a>
        <Header />
        <DemoBanner />
        <main id="main" tabIndex={-1} className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 outline-none sm:py-8">
          <Outlet />
        </main>
        <Footer />
      </div>
      <Toaster theme="light" richColors closeButton position="top-right" />
      <ScrollRestoration />
    </TooltipProvider>
  );
}

export function AppSkeleton() {
  return (
    <div className="flex min-h-dvh items-center justify-center text-sm text-muted-foreground" role="status">
      Loading RailTrack Live…
    </div>
  );
}
