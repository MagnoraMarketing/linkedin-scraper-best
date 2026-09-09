'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { Alert, Button } from '@/components/ui';
import { createClient } from '@/lib/supabase/client';
import { loginSchema } from '@/lib/validation/schemas';

type Mode = 'signin' | 'signup';

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextPath = searchParams.get('next') ?? '/search';

  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setNotice(null);

    const parsed = loginSchema.safeParse({ email, password });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Check your details and try again.');
      return;
    }

    setLoading(true);
    try {
      const supabase = createClient();

      if (mode === 'signup') {
        const { error: signUpError } = await supabase.auth.signUp(parsed.data);
        if (signUpError) {
          setError(signUpError.message);
          return;
        }
        setNotice(
          'Account created. If email confirmation is enabled on your Supabase project, confirm the address before signing in.',
        );
        setMode('signin');
        return;
      }

      const { error: signInError } = await supabase.auth.signInWithPassword(parsed.data);
      if (signInError) {
        // Supabase returns a deliberately vague message here; don't add detail.
        setError('Those credentials did not work. Check your email and password.');
        return;
      }

      router.push(nextPath);
      router.refresh();
    } catch {
      setError('Could not reach the authentication service. Check your connection and try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {error && <Alert tone="error">{error}</Alert>}
      {notice && <Alert tone="success">{notice}</Alert>}

      <div>
        <label htmlFor="email" className="field-label">
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="field-input"
          placeholder="you@company.com"
        />
      </div>

      <div>
        <label htmlFor="password" className="field-label">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="field-input"
          placeholder="••••••••"
        />
      </div>

      <Button type="submit" loading={loading} className="w-full">
        {mode === 'signup' ? 'Create account' : 'Sign in'}
      </Button>

      <p className="text-center text-xs text-slate-500">
        {mode === 'signup' ? 'Already have an account?' : 'No account yet?'}{' '}
        <button
          type="button"
          onClick={() => {
            setMode(mode === 'signup' ? 'signin' : 'signup');
            setError(null);
            setNotice(null);
          }}
          className="font-medium text-brand-600 hover:text-brand-700"
        >
          {mode === 'signup' ? 'Sign in' : 'Create one'}
        </button>
      </p>
    </form>
  );
}
