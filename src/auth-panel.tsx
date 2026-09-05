import React, { useEffect, useState } from 'react';
import { LogIn, LogOut, UserRound, X } from 'lucide-react';
import { authApi, type AuthUser } from './auth';
import './auth-panel.css';

type Mode = 'login' | 'register';

export function AuthPanel() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [profileMode, setProfileMode] = useState(false);

  useEffect(() => {
    authApi.me().then(({ user: current }) => setUser(current)).catch(() => undefined);
  }, []);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setMessage('');
    try {
      const result = mode === 'login'
        ? await authApi.login(email, password)
        : await authApi.register(email, password, displayName);
      setUser(result.user);
      setOpen(false);
      setEmail('');
      setPassword('');
      setDisplayName('');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Authentication failed.');
    } finally {
      setBusy(false);
    }
  };

  const logout = async () => {
    setBusy(true);
    try {
      await authApi.logout();
      setUser(null);
      setProfileMode(false);
    } finally {
      setBusy(false);
    }
  };

  const saveProfile = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!displayName.trim()) return;
    setBusy(true);
    setMessage('');
    try {
      const result = await authApi.updateProfile(displayName.trim());
      setUser(result.user);
      setProfileMode(false);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not update profile.');
    } finally {
      setBusy(false);
    }
  };

  return <>
    <button
      className="authProfileButton"
      onClick={() => {
        setOpen(true);
        setProfileMode(Boolean(user));
        setDisplayName(user?.displayName || '');
        setMessage('');
      }}
      aria-label={user ? `Open profile for ${user.displayName}` : 'Open account'}
    >
      <span className="authAvatar">{user ? user.displayName.slice(0, 2).toUpperCase() : <UserRound size={17} />}</span>
      <span>{user?.displayName || 'Guest listener'}</span>
    </button>

    {open && <div className="authShade" onClick={() => setOpen(false)}>
      <section className="authDialog" onClick={(event) => event.stopPropagation()}>
        <button className="authClose" onClick={() => setOpen(false)} aria-label="Close"><X /></button>
        {user && profileMode ? <>
          <div className="authHeader"><span className="authKicker">YOUR ACCOUNT</span><h2>Profile</h2><p>{user.email}</p></div>
          <form onSubmit={saveProfile} className="authForm">
            <label>Display name<input value={displayName} onChange={(event) => setDisplayName(event.target.value)} maxLength={80} /></label>
            {message && <div className="authMessage">{message}</div>}
            <button className="authSubmit" disabled={busy}>{busy ? 'Saving…' : 'Save profile'}</button>
          </form>
          <button className="authSecondary" onClick={logout} disabled={busy}><LogOut size={17}/> Sign out</button>
        </> : <>
          <div className="authHeader"><span className="authKicker">SONG NOTE</span><h2>{mode === 'login' ? 'Welcome back' : 'Create your account'}</h2><p>{mode === 'login' ? 'Sign in to keep your library and profile connected.' : 'Start your personal Song Note library.'}</p></div>
          <form onSubmit={submit} className="authForm">
            {mode === 'register' && <label>Display name<input value={displayName} onChange={(event) => setDisplayName(event.target.value)} maxLength={80} required placeholder="Your name" /></label>}
            <label>Email<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required autoComplete="email" placeholder="you@example.com" /></label>
            <label>Password<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} minLength={8} required autoComplete={mode === 'login' ? 'current-password' : 'new-password'} placeholder="At least 8 characters" /></label>
            {message && <div className="authMessage">{message}</div>}
            <button className="authSubmit" disabled={busy}><LogIn size={17}/>{busy ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'}</button>
          </form>
          <button className="authLink" onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setMessage(''); }}>
            {mode === 'login' ? 'New to Song Note? Create an account' : 'Already have an account? Sign in'}
          </button>
        </>}
      </section>
    </div>}
  </>;
}
