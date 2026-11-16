import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { I18n, initialLang, makeT, type Lang } from './i18n';
import { ClientSession, HostSession, rememberedId, savedHost, type Session } from './net/session';
import { normalizeCode } from './net/transport';
import { useGame } from './useGame';
import { setSound, soundOn } from './audio';
import { Home, Lobby, LangSwitch, RulesDialog, Wordmark, copyText, inviteLink } from './components/Screens';
import { Table } from './components/Table';
import { Scoreboard } from './components/Scoreboard';
import { Icon } from './components/Icon';
import type { Action, PeerHover } from './game/types';

const read = (k: string) => { try { return localStorage.getItem(k) ?? ''; } catch { return ''; } };
const write = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } };

function setRoomInUrl(code: string | null) {
  try {
    const u = new URL(location.href);
    if (code) u.searchParams.set('room', code);
    else u.searchParams.delete('room');
    history.replaceState(null, '', u.toString());
  } catch { /* sandboxed iframes may refuse */ }
}

export default function App() {
  const [lang, setLangState] = useState<Lang>(initialLang);
  const t = useMemo(() => makeT(lang), [lang]);
  const setLang = useCallback((l: Lang) => { setLangState(l); write('kolumna:lang', l); }, []);
  useEffect(() => { document.documentElement.lang = lang; }, [lang]);

  const urlCode = useMemo(() => normalizeCode(new URLSearchParams(location.search).get('room') ?? ''), []);
  const [session, setSession] = useState<Session | null>(null);
  const [pending, setPending] = useState<'create' | 'join' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rules, setRules] = useState(false);
  const [sound, setSoundState] = useState(soundOn());
  const [copied, setCopied] = useState(false);
  const { view, lastEv, hovers, status, busy } = useGame(session);
  const hadView = useRef(false);
  if (view) hadView.current = true;

  const create = useCallback(async (name: string) => {
    write('kolumna:name', name);
    setError(null);
    setPending('create');
    const s = new HostSession(name);
    try {
      await s.open();
      setSession(s);
      setRoomInUrl(s.code);
    } catch {
      setError(t(s.reason === 'timeout' ? 'reason.timeout' : 'reason.network'));
    } finally {
      setPending(null);
    }
  }, [t]);

  const join = useCallback(async (name: string, code: string) => {
    write('kolumna:name', name);
    setError(null);
    setPending('join');
    const s = new ClientSession(code, name);
    await s.open();
    setPending(null);
    if (s.status === 'rejected') {
      setError(t(('reason.' + (s.reason ?? 'network')) as 'reason.network'));
      return;
    }
    hadView.current = false;
    setSession(s);
    setRoomInUrl(code);
  }, [t]);

  // Pick up a running game after a reload: as host from the saved state, as guest with the remembered seat
  useEffect(() => {
    if (!urlCode) return;
    const saved = savedHost(urlCode);
    if (saved) {
      const s = new HostSession('', saved);
      setPending('create');
      s.open().then(() => setSession(s)).catch(() => setError(t('reason.network'))).finally(() => setPending(null));
      return;
    }
    const name = read('kolumna:name');
    if (name && rememberedId(urlCode)) join(name, urlCode);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // A guest that gets turned away or loses the host for good goes back to the start screen
  useEffect(() => {
    if (!session || status !== 'rejected') return;
    setError(hadView.current ? t('hostLost') : t(('reason.' + (session.reason ?? 'network')) as 'reason.network'));
    session.close();
    setSession(null);
    setRoomInUrl(null);
  }, [status, session, t]);

  const leave = useCallback(() => {
    if (view && view.phase !== 'lobby' && view.phase !== 'gameOver' && !confirm(t('leaveConfirm'))) return;
    session?.close();
    setSession(null);
    setRoomInUrl(null);
  }, [session, view, t]);

  const send = useCallback((a: Action) => session?.send(a), [session]);
  const sendHover = useCallback((h: PeerHover | null) => session?.sendHover(h), [session]);
  const toggleSound = () => { setSound(!sound); setSoundState(!sound); };
  const copyInvite = async () => {
    if (session && (await copyText(inviteLink(session.code)))) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    }
  };

  const ctx = useMemo(() => ({ lang, t, setLang }), [lang, t, setLang]);

  let body;
  if (!session) {
    body = (
      <Home
        initialName={read('kolumna:name')}
        initialCode={urlCode}
        error={error}
        pending={pending}
        onCreate={create}
        onJoin={join}
        onRules={() => setRules(true)}
      />
    );
  } else if (!view || (!session.isHost && !session.pid)) {
    body = (
      <div className="connecting">
        <span className="spinner spinner-lg" />
        <p className="secondary">{t('connecting')}</p>
        <button type="button" className="btn btn-quiet btn-sm" onClick={leave}>{t('back')}</button>
      </div>
    );
  } else {
    body = (
      <div className="game">
        <header className="topbar topbar-game">
          <Wordmark />
          <button type="button" className="code-chip" onClick={copyInvite} title={t('copyLink')}>
            <span className="tabular">{session.code}</span>
            <Icon name={copied ? 'check' : 'copy'} size={14} />
          </button>
          {view.phase !== 'lobby' && <span className="muted round-label">{t('roundN', { n: view.round })}</span>}
          <span className="spacer" />
          <button type="button" className="icon-btn" onClick={() => setRules(true)} aria-label={t('rules')} title={t('rules')}><Icon name="book" /></button>
          <button type="button" className="icon-btn" onClick={toggleSound} aria-label={t('sound')} aria-pressed={sound} title={t('sound')}><Icon name={sound ? 'volume' : 'mute'} /></button>
          <LangSwitch />
          <button type="button" className="icon-btn" onClick={leave} aria-label={t('leave')} title={t('leave')}><Icon name="leave" /></button>
        </header>
        {status === 'lost' && <div className="banner" role="status"><span className="spinner" />{t('reconnecting')}</div>}
        {view.phase === 'lobby' ? (
          <Lobby view={view} code={session.code} me={session.pid} isHost={session.isHost} send={send} />
        ) : (
          <>
            <Table view={view} me={session.pid} isHost={session.isHost} busy={busy} lastEv={lastEv} hovers={hovers} send={send} onHover={sendHover} />
            {(view.phase === 'roundEnd' || view.phase === 'gameOver') && !busy && (
              <Scoreboard key={view.round} view={view} me={session.pid} isHost={session.isHost} send={send} onLeave={leave} />
            )}
          </>
        )}
      </div>
    );
  }

  return (
    <I18n.Provider value={ctx}>
      {body}
      {rules && <RulesDialog onClose={() => setRules(false)} />}
    </I18n.Provider>
  );
}
