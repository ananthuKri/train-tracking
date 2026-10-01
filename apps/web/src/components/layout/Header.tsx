import { useState } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router';
import { toast } from 'sonner';
import { Activity, LayoutDashboard, LogIn, LogOut, Mail, Menu, Search, Server, UserRound } from 'lucide-react';
import { useLogout, useMe } from '@/api/hooks';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { cn } from '@/lib/utils';
import { useDashboardStore } from '@/stores/dashboard';
import { ThemeToggle } from './ThemeToggle';

export const NAV_ITEMS = [
  { to: '/', label: 'Track', icon: Search, end: true },
  { to: '/results', label: 'Dashboard', icon: LayoutDashboard, end: false },
  { to: '/reports/new', label: 'Reports', icon: Mail, end: false },
  { to: '/monitoring', label: 'Monitoring', icon: Activity, end: false },
  { to: '/admin/providers', label: 'Providers', icon: Server, end: false },
] as const;

export function Logo({ className }: { className?: string }) {
  return (
    <Link to="/" className={cn('flex items-center gap-2 rounded-md font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring', className)}>
      <img src="/favicon.svg" alt="" className="size-7" />
      <span className="text-base tracking-tight">
        RailTrack <span className="text-primary">Live</span>
      </span>
    </Link>
  );
}

function UserMenu() {
  const { data: user, isLoading } = useMe();
  const logout = useLogout();
  const navigate = useNavigate();
  const location = useLocation();

  if (isLoading) return <span className="h-9 w-20 animate-pulse rounded-md bg-muted" aria-hidden />;
  if (!user) {
    const next = `${location.pathname}${location.search}`;
    const href = location.pathname === '/login' || location.pathname === '/register' ? '/login' : `/login?next=${encodeURIComponent(next)}`;
    return (
      <Button asChild variant="outline" size="sm" data-testid="sign-in-link">
        <Link to={href}>
          <LogIn aria-hidden />
          Sign in
        </Link>
      </Button>
    );
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="max-w-48" data-testid="user-menu" aria-label={`Account menu for ${user.name ?? user.email}`}>
          <UserRound aria-hidden />
          <span className="hidden truncate md:inline">{user.name ?? user.email}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="space-y-0.5">
          <p className="truncate">{user.name ?? 'Signed in'}</p>
          <p className="truncate text-xs font-normal text-muted-foreground">{user.email}</p>
          {user.role === 'ADMIN' && <p className="text-xs font-normal text-primary">Administrator</p>}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => navigate('/monitoring')}>
          <Activity aria-hidden /> My monitoring
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => navigate('/reports/new')}>
          <Mail aria-hidden /> Email reports
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          data-testid="sign-out"
          onSelect={() =>
            logout.mutate(undefined, {
              onSuccess: () => toast.success('Signed out'),
              onSettled: () => navigate('/'),
            })
          }
        >
          <LogOut aria-hidden /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function NavItems({ onNavigate, vertical }: { onNavigate?: () => void; vertical?: boolean }) {
  const count = useDashboardStore((s) => s.results.length);
  return (
    <>
      {NAV_ITEMS.map(({ to, label, icon: Icon, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          onClick={onNavigate}
          className={({ isActive }) =>
            cn(
              'inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring',
              isActive ? 'bg-accent text-accent-foreground' : 'text-muted-foreground',
              vertical && 'w-full py-2.5 text-base',
            )
          }
        >
          <Icon aria-hidden className="size-4" />
          {label}
          {to === '/results' && count > 0 && (
            <span className="rounded-full bg-primary px-1.5 font-mono text-[11px] leading-5 text-primary-foreground tabular-nums">
              <span className="sr-only">, </span>
              {count}
              <span className="sr-only"> trains</span>
            </span>
          )}
        </NavLink>
      ))}
    </>
  );
}

export function Header() {
  const [open, setOpen] = useState(false);
  return (
    <header className="sticky top-0 z-40 border-b bg-background/90 backdrop-blur supports-[backdrop-filter]:bg-background/75">
      <div className="mx-auto flex h-14 max-w-7xl items-center gap-3 px-4">
        <Logo />
        <nav aria-label="Main" className="ml-4 hidden items-center gap-1 lg:flex">
          <NavItems />
        </nav>
        <div className="ml-auto flex items-center gap-1">
          <ThemeToggle />
          <UserMenu />
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden"
            aria-label="Open menu"
            aria-expanded={open}
            onClick={() => setOpen(true)}
            data-testid="mobile-menu"
          >
            <Menu aria-hidden />
          </Button>
        </div>
      </div>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="left" className="w-72">
          <SheetHeader className="border-b">
            <SheetTitle>
              <Logo />
            </SheetTitle>
            <SheetDescription className="sr-only">Site navigation</SheetDescription>
          </SheetHeader>
          <nav aria-label="Main" className="flex flex-col gap-1 px-3">
            <NavItems vertical onNavigate={() => setOpen(false)} />
          </nav>
        </SheetContent>
      </Sheet>
    </header>
  );
}
