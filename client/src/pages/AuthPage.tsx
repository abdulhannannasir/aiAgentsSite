import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { ArrowLeft, CheckCircle2, MailCheck } from 'lucide-react';
import { Button, LinkButton } from '../components/ui/Button';
import { Card, Spinner } from '../components/ui/Display';
import { Field, Input } from '../components/ui/Form';
import { account, auth } from '../lib/account';
import { authHref, pageHref, type AuthPageId } from '../lib/route';
import type { MetaResponse } from '../../../server/src/contracts';

interface Props {
  page: AuthPageId;
  params: Record<string, string>;
  meta: MetaResponse | null;
  /** Called after a successful sign-in (refreshes the account, then opens the app). */
  onSignedIn: () => Promise<void> | void;
}

function Frame({ title, subtitle, children }: { title: string; subtitle?: ReactNode; children: ReactNode }) {
  return (
    <div className="relative z-10 flex min-h-dvh items-center justify-center px-4 py-10">
      <div className="w-full max-w-md">
        <a href="#/" className="mb-6 inline-flex items-center gap-2 text-sm text-muted transition hover:text-fg"><ArrowLeft size={15} aria-hidden /> AgentVerse home</a>
        <Card className="!p-6 sm:!p-8">
          <div className="mb-6 flex items-center gap-3">
            <span aria-hidden className="flex h-10 w-10 items-center justify-center rounded-xl border border-line-strong bg-gradient-to-br from-neon-cyan/30 to-neon-violet/30 text-xl">🤖</span>
            <div>
              <h1 className="font-display text-xl font-bold">{title}</h1>
              {subtitle && <p className="text-sm text-muted">{subtitle}</p>}
            </div>
          </div>
          {children}
        </Card>
      </div>
    </div>
  );
}

function FormError({ message }: { message: string | null }) {
  return message ? <p role="alert" className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-600 dark:text-rose-300">{message}</p> : null;
}

const errorText = (err: unknown) => (err instanceof Error ? err.message : 'Something went wrong. Please try again.');

export default function AuthPage({ page, params, meta, onSignedIn }: Props) {
  if (meta && !meta.features.auth) {
    return (
      <Frame title="Accounts aren't enabled" subtitle="This server runs in guest mode.">
        <p className="text-sm text-muted">Signing in needs a PostgreSQL database and an auth secret on the server (<code>DATABASE_URL</code>, <code>BETTER_AUTH_SECRET</code>). You can still use every agent and workflow as a guest.</p>
        <LinkButton href={pageHref('chat')} variant="primary" className="mt-5 w-full">Continue as a guest</LinkButton>
      </Frame>
    );
  }
  switch (page) {
    case 'sign-up': return <SignUp onSignedIn={onSignedIn} />;
    case 'forgot-password': return <ForgotPassword emailConfigured={!!meta?.features.email} />;
    case 'reset-password': return <ResetPassword params={params} />;
    case 'verified': return <Verified params={params} onSignedIn={onSignedIn} />;
    default: return <SignIn onSignedIn={onSignedIn} />;
  }
}

function SignIn({ onSignedIn }: { onSignedIn: Props['onSignedIn'] }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unverified, setUnverified] = useState(false);
  const [resent, setResent] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null); setUnverified(false);
    try {
      await auth.signIn(email.trim(), password);
      await onSignedIn();
    } catch (err) {
      const status = (err as { status?: number }).status;
      if (status === 403) { setUnverified(true); setError('Please confirm your email address first. Check your inbox for the link.'); }
      else setError(status === 401 ? 'That email and password don\'t match an account.' : errorText(err));
    } finally { setBusy(false); }
  };

  return (
    <Frame title="Sign in" subtitle="Your agents and chats, saved in your workspace.">
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <FormError message={error} />
        <Field label="Email">{p => <Input {...p} type="email" autoComplete="email" required value={email} onChange={e => setEmail(e.target.value)} data-autofocus />}</Field>
        <Field label="Password">{p => <Input {...p} type="password" autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)} />}</Field>
        <Button type="submit" variant="primary" disabled={busy || !email || !password}>{busy ? <Spinner label="Signing in" /> : 'Sign in'}</Button>
        {unverified && (
          <Button size="sm" disabled={resent} onClick={async () => { try { await auth.resendVerification(email.trim()); setResent(true); } catch (err) { setError(errorText(err)); } }}>
            {resent ? 'Confirmation email sent' : 'Send the confirmation email again'}
          </Button>
        )}
      </form>
      <div className="mt-5 flex flex-wrap justify-between gap-2 text-sm">
        <a className="text-accent underline-offset-2 hover:underline" href={authHref('forgot-password')}>Forgot your password?</a>
        <a className="text-accent underline-offset-2 hover:underline" href={authHref('sign-up')}>Create an account</a>
      </div>
    </Frame>
  );
}

function SignUp({ onSignedIn }: { onSignedIn: Props['onSignedIn'] }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checkEmail, setCheckEmail] = useState(false);
  const short = password.length > 0 && password.length < 8;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (password.length < 8) { setError('Use at least 8 characters for your password.'); return; }
    setBusy(true); setError(null);
    try {
      await auth.signUp(name.trim(), email.trim(), password);
      // When the server requires email confirmation there is no session yet.
      try { await account.me(); await onSignedIn(); } catch { setCheckEmail(true); }
    } catch (err) {
      const msg = errorText(err);
      setError(/exist/i.test(msg) ? 'An account with this email already exists. Try signing in.' : msg);
    } finally { setBusy(false); }
  };

  if (checkEmail) {
    return (
      <Frame title="Check your email" subtitle={email}>
        <div className="flex items-start gap-3 text-sm"><MailCheck size={20} aria-hidden className="mt-0.5 shrink-0 text-accent" /><p>We sent a confirmation link. Open it to activate your account; it works for 24 hours.</p></div>
        <LinkButton href={authHref('sign-in')} className="mt-5 w-full">Back to sign in</LinkButton>
      </Frame>
    );
  }
  return (
    <Frame title="Create your account" subtitle="You get your own workspace straight away.">
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <FormError message={error} />
        <Field label="Name">{p => <Input {...p} autoComplete="name" required maxLength={80} value={name} onChange={e => setName(e.target.value)} data-autofocus />}</Field>
        <Field label="Email">{p => <Input {...p} type="email" autoComplete="email" required value={email} onChange={e => setEmail(e.target.value)} />}</Field>
        <Field label="Password" hint="At least 8 characters." error={short ? 'Too short' : undefined}>
          {p => <Input {...p} type="password" autoComplete="new-password" required minLength={8} maxLength={128} value={password} onChange={e => setPassword(e.target.value)} />}
        </Field>
        <Button type="submit" variant="primary" disabled={busy || !name.trim() || !email || !password}>{busy ? <Spinner label="Creating your account" /> : 'Create account'}</Button>
      </form>
      <p className="mt-5 text-sm text-muted">Already have an account? <a className="text-accent underline-offset-2 hover:underline" href={authHref('sign-in')}>Sign in</a></p>
    </Frame>
  );
}

function ForgotPassword({ emailConfigured }: { emailConfigured: boolean }) {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try { await auth.requestReset(email.trim()); setSent(true); } catch (err) { setError(errorText(err)); } finally { setBusy(false); }
  };
  return (
    <Frame title="Reset your password" subtitle="We'll email you a link to choose a new one.">
      {!emailConfigured && (
        <p className="mb-4 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs">This server has no email delivery configured (<code>SMTP_URL</code>). In development the reset link is written to the server log; in production ask an administrator.</p>
      )}
      {sent ? (
        <div className="flex items-start gap-3 text-sm" role="status"><MailCheck size={20} aria-hidden className="mt-0.5 shrink-0 text-accent" /><p>If an account exists for <strong>{email}</strong>, a reset link is on its way. It works for one hour.</p></div>
      ) : (
        <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
          <FormError message={error} />
          <Field label="Email">{p => <Input {...p} type="email" autoComplete="email" required value={email} onChange={e => setEmail(e.target.value)} data-autofocus />}</Field>
          <Button type="submit" variant="primary" disabled={busy || !email}>{busy ? <Spinner label="Sending" /> : 'Send reset link'}</Button>
        </form>
      )}
      <a className="mt-5 inline-block text-sm text-accent underline-offset-2 hover:underline" href={authHref('sign-in')}>Back to sign in</a>
    </Frame>
  );
}

function ResetPassword({ params }: { params: Record<string, string> }) {
  // Better Auth puts the token in the query string before the hash: /?token=…#/auth/reset-password
  const [token] = useState(() => new URLSearchParams(location.search).get('token') ?? params.token ?? '');
  const linkError = new URLSearchParams(location.search).get('error') ?? params.error;
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Keep the one-time token out of the address bar and history.
    if (location.search) history.replaceState(null, '', `${location.pathname}${location.hash}`);
  }, []);

  if (linkError || !token) {
    return (
      <Frame title="This link doesn't work" subtitle="It may have expired or already been used.">
        <LinkButton href={authHref('forgot-password')} variant="primary" className="w-full">Send a new link</LinkButton>
      </Frame>
    );
  }
  if (done) {
    return (
      <Frame title="Password changed">
        <p className="flex items-center gap-2 text-sm"><CheckCircle2 size={18} aria-hidden className="text-emerald-500" /> You've been signed out everywhere. Sign in with your new password.</p>
        <LinkButton href={authHref('sign-in')} variant="primary" className="mt-5 w-full">Sign in</LinkButton>
      </Frame>
    );
  }
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (password.length < 8) { setError('Use at least 8 characters.'); return; }
    setBusy(true); setError(null);
    try { await auth.resetPassword(token, password); setDone(true); } catch (err) { setError(errorText(err)); } finally { setBusy(false); }
  };
  return (
    <Frame title="Choose a new password">
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <FormError message={error} />
        <Field label="New password" hint="At least 8 characters.">{p => <Input {...p} type="password" autoComplete="new-password" required minLength={8} maxLength={128} value={password} onChange={e => setPassword(e.target.value)} data-autofocus />}</Field>
        <Button type="submit" variant="primary" disabled={busy || !password}>{busy ? <Spinner label="Saving" /> : 'Save new password'}</Button>
      </form>
    </Frame>
  );
}

function Verified({ params, onSignedIn }: { params: Record<string, string>; onSignedIn: Props['onSignedIn'] }) {
  if (params.error) {
    return (
      <Frame title="We couldn't confirm your email" subtitle="The link may have expired or already been used.">
        <p className="text-sm text-muted">Sign in and choose "Send the confirmation email again".</p>
        <LinkButton href={authHref('sign-in')} variant="primary" className="mt-5 w-full">Sign in</LinkButton>
      </Frame>
    );
  }
  return (
    <Frame title="Email confirmed">
      <p className="flex items-center gap-2 text-sm"><CheckCircle2 size={18} aria-hidden className="text-emerald-500" /> Your account is active.</p>
      <Button variant="primary" className="mt-5 w-full" onClick={() => void onSignedIn()}>Open AgentVerse</Button>
    </Frame>
  );
}
