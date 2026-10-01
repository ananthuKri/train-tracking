import { useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { LoaderCircle, LogIn, UserPlus } from 'lucide-react';
import { LoginRequestSchema, RegisterRequestSchema } from '@railtrack/shared';
import { isApiError } from '@/api/client';
import { useLogin, useMe, useRegister } from '@/api/hooks';
import { Logo } from '@/components/layout/Header';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { safeNextPath } from '@/lib/utils';

type FieldErrors = Partial<Record<'email' | 'password' | 'name', string>>;

function collectErrors(issues: { path: PropertyKey[]; message: string }[]): FieldErrors {
  const out: FieldErrors = {};
  for (const issue of issues) {
    const key = String(issue.path[0] ?? '') as keyof FieldErrors;
    if (key && !out[key]) out[key] = issue.message;
  }
  return out;
}

function AuthShell({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-md space-y-6 py-4">
      <div className="flex justify-center">
        <Logo />
      </div>
      <Card>
        <CardHeader>
          <h1 className="text-xl font-semibold leading-tight">{title}</h1>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        <CardContent>{children}</CardContent>
      </Card>
    </div>
  );
}

function FieldError({ id, message }: { id: string; message?: string }) {
  return (
    <p id={id} className="text-xs font-medium text-destructive empty:hidden">
      {message}
    </p>
  );
}

export function LoginPage() {
  useDocumentTitle('Sign in');
  const [params] = useSearchParams();
  const next = safeNextPath(params.get('next'));
  const navigate = useNavigate();
  const { data: user } = useMe();
  const login = useLogin();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});

  if (user && !login.isPending && !login.isSuccess) return <Navigate to={next} replace />;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const parsed = LoginRequestSchema.safeParse({ email, password });
    if (!parsed.success) {
      setErrors(collectErrors(parsed.error.issues));
      return;
    }
    setErrors({});
    login.mutate(parsed.data, {
      onSuccess: ({ user: u }) => {
        toast.success(`Signed in as ${u.name ?? u.email}`);
        navigate(next, { replace: true });
      },
    });
  };

  const err = login.error;
  const message = err
    ? isApiError(err) && (err.code === 'UNAUTHENTICATED' || err.status === 401)
      ? 'Email or password is incorrect.'
      : err.message
    : null;

  return (
    <AuthShell title="Sign in" description="Sign in to email reports, monitor trains and see your tracking history.">
      <form onSubmit={submit} noValidate className="space-y-4" data-testid="login-form">
        <div className="space-y-2">
          <Label htmlFor="login-email">Email</Label>
          <Input
            id="login-email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            aria-invalid={!!errors.email || undefined}
            aria-describedby="login-email-error"
            required
          />
          <FieldError id="login-email-error" message={errors.email} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="login-password">Password</Label>
          <Input
            id="login-password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            aria-invalid={!!errors.password || undefined}
            aria-describedby="login-password-error"
            required
          />
          <FieldError id="login-password-error" message={errors.password} />
        </div>
        {message && (
          <Alert tone="danger" role="alert">
            {message}
          </Alert>
        )}
        <Button type="submit" className="w-full" disabled={login.isPending}>
          {login.isPending ? <LoaderCircle aria-hidden className="animate-spin" /> : <LogIn aria-hidden />}
          Sign in
        </Button>
        <p className="text-center text-sm text-muted-foreground">
          New here?{' '}
          <Link to={`/register${params.get('next') ? `?next=${encodeURIComponent(next)}` : ''}`} className="font-medium text-primary underline-offset-4 hover:underline">
            Create an account
          </Link>
        </p>
      </form>
    </AuthShell>
  );
}

export function RegisterPage() {
  useDocumentTitle('Create account');
  const [params] = useSearchParams();
  const next = safeNextPath(params.get('next'));
  const navigate = useNavigate();
  const { data: user } = useMe();
  const register = useRegister();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});

  if (user && !register.isPending && !register.isSuccess) return <Navigate to={next} replace />;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const parsed = RegisterRequestSchema.safeParse({ email, password, name: name.trim() || undefined });
    if (!parsed.success) {
      setErrors(collectErrors(parsed.error.issues));
      return;
    }
    setErrors({});
    register.mutate(parsed.data, {
      onSuccess: () => {
        toast.success('Account created');
        navigate(next, { replace: true });
      },
    });
  };

  const err = register.error;
  const message = err ? (isApiError(err) && err.code === 'CONFLICT' ? 'An account with this email already exists. Try signing in.' : err.message) : null;

  return (
    <AuthShell title="Create an account" description="Free account for email reports, monitoring and history.">
      <form onSubmit={submit} noValidate className="space-y-4" data-testid="register-form">
        <div className="space-y-2">
          <Label htmlFor="reg-name">Name (optional)</Label>
          <Input id="reg-name" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="reg-email">Email</Label>
          <Input
            id="reg-email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            aria-invalid={!!errors.email || undefined}
            aria-describedby="reg-email-error"
            required
          />
          <FieldError id="reg-email-error" message={errors.email} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="reg-password">Password</Label>
          <Input
            id="reg-password"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            aria-invalid={!!errors.password || undefined}
            aria-describedby="reg-password-help reg-password-error"
            minLength={10}
            required
          />
          <p id="reg-password-help" className="text-xs text-muted-foreground">
            At least 10 characters.
          </p>
          <FieldError id="reg-password-error" message={errors.password} />
        </div>
        {message && (
          <Alert tone="danger" role="alert">
            {message}
          </Alert>
        )}
        <Button type="submit" className="w-full" disabled={register.isPending}>
          {register.isPending ? <LoaderCircle aria-hidden className="animate-spin" /> : <UserPlus aria-hidden />}
          Create account
        </Button>
        <p className="text-center text-sm text-muted-foreground">
          Already registered?{' '}
          <Link to={`/login${params.get('next') ? `?next=${encodeURIComponent(next)}` : ''}`} className="font-medium text-primary underline-offset-4 hover:underline">
            Sign in
          </Link>
        </p>
      </form>
    </AuthShell>
  );
}
