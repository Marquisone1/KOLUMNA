import { useEffect, useRef, useState, type CSSProperties, type FormEvent } from 'react';
import type { Action, GameState, ViewPolicy } from '../game/types';
import { DEFAULT_SETTINGS } from '../game/types';
import { MAX_PLAYERS, TARGET_OPTIONS } from '../game/types';
import { normalizeCode } from '../net/transport';
import { dict, useI18n, type Lang } from '../i18n';
import { Card } from './Card';
import { Icon, Mark } from './Icon';
import { SEAT_COLORS } from './PlayerBoard';

// ---------------- shared bits ----------------

export function LangSwitch() {
  const { lang, setLang, t } = useI18n();
  return (
    <div className="seg" role="group" aria-label={t('language')}>
      {(['de', 'en'] as Lang[]).map((l) => (
        <button key={l} type="button" className={lang === l ? 'is-on' : ''} aria-pressed={lang === l} onClick={() => setLang(l)}>
          {l.toUpperCase()}
        </button>
      ))}
    </div>
  );
}

export function Wordmark() {
  return (
    <span className="wordmark">
      <Mark size={18} />
      Kolumna
    </span>
  );
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Clipboard API is often blocked inside iframes; fall back to a hidden textarea
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

export function inviteLink(code: string) {
  const u = new URL(location.href);
  u.search = '';
  u.hash = '';
  u.searchParams.set('room', code);
  const net = new URLSearchParams(location.search).get('net');
  if (net) u.searchParams.set('net', net);
  return u.toString();
}

export function RulesDialog({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);
  return (
    <dialog ref={ref} className="dialog" onClose={onClose} onClick={(e) => { if (e.target === ref.current) onClose(); }} aria-labelledby="rules-title">
      <div className="dialog-body">
        <header className="dialog-head">
          <h2 id="rules-title" className="display display-sm">{t('rulesTitle')}</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label={t('close')}><Icon name="x" /></button>
        </header>
        <RulesList />
        <div className="rules-cards" aria-hidden="true">
          {[-2, -1, 0, 3, 6, 10].map((v) => <Card key={v} v={v} up w={40} />)}
        </div>
      </div>
    </dialog>
  );
}

function RulesList() {
  const { lang } = useI18n();
  const list = rulesFor(lang);
  return (
    <dl className="rules">
      {list.map(([k, v]) => (
        <div key={k} className="rule">
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

const rulesFor = (lang: Lang) => dict[lang].rulesBody;

// ---------------- home ----------------

interface HomeProps {
  initialName: string;
  initialCode: string;
  error: string | null;
  pending: 'create' | 'join' | null;
  onCreate: (name: string) => void;
  onJoin: (name: string, code: string) => void;
  onRules: () => void;
}

export function Home({ initialName, initialCode, error, pending, onCreate, onJoin, onRules }: HomeProps) {
  const { t } = useI18n();
  const [name, setName] = useState(initialName);
  const [code, setCode] = useState(initialCode);
  const nameRef = useRef<HTMLInputElement>(null);
  const valid = name.trim().length > 0;
  const codeValid = normalizeCode(code).length === 5;

  const need = () => {
    if (!valid) { nameRef.current?.focus(); return false; }
    return true;
  };
  const create = (e: FormEvent) => { e.preventDefault(); if (need()) onCreate(name.trim()); };
  const join = (e: FormEvent) => { e.preventDefault(); if (need() && codeValid) onJoin(name.trim(), normalizeCode(code)); };

  return (
    <div className="home">
      <header className="topbar">
        <Wordmark />
        <span className="spacer" />
        <button type="button" className="btn btn-quiet btn-sm" onClick={onRules}><Icon name="book" size={16} />{t('rules')}</button>
        <LangSwitch />
      </header>

      <main className="hero">
        <div className="hero-copy">
          <h1 className="display display-xl">{t('headline')}</h1>
          <p className="lede">{t('tagline')}</p>

          <form className="entry" onSubmit={initialCode ? join : create}>
            <label className="field">
              <span className="field-label">{t('yourName')}</span>
              <input
                ref={nameRef}
                className="input"
                value={name}
                maxLength={16}
                autoComplete="nickname"
                placeholder={t('namePlaceholder')}
                onChange={(e) => setName(e.target.value)}
                autoFocus={!initialName}
              />
            </label>
            {!initialCode && (
              <button type="submit" className="btn btn-primary btn-lg" disabled={!!pending}>
                {pending === 'create' ? <span className="spinner" /> : <Icon name="plus" size={18} />}
                {pending === 'create' ? t('creating') : t('createRoom')}
              </button>
            )}
          </form>

          <div className="divider"><span>{t('or')}</span></div>

          <form className="join-row" onSubmit={join}>
            <label className="field field-code">
              <span className="sr-only">{t('roomCode')}</span>
              <input
                className="input input-code"
                value={code}
                placeholder={t('roomCode')}
                autoCapitalize="characters"
                spellCheck={false}
                onChange={(e) => setCode(normalizeCode(e.target.value))}
              />
            </label>
            <button type="submit" className={'btn btn-lg ' + (initialCode ? 'btn-primary' : 'btn-secondary')} disabled={!codeValid || !!pending}>
              {pending === 'join' && <span className="spinner" />}
              {pending === 'join' ? t('connecting') : t('join')}
            </button>
          </form>
          {error && <p className="error" role="alert">{error}</p>}
        </div>

        <div className="hero-visual" aria-hidden="true">
          <div className="fan">
            {[[-2, -16, 18], [0, -8, 6], [4, 0, 0], [7, 8, 6], [12, 16, 18]].map(([v, rot, dy], i) => (
              <Card key={i} v={v} up w={132} className="fan-card" style={{ '--rot': rot + 'deg', '--dy': dy + 'px', '--i': i } as CSSProperties} />
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}

// ---------------- lobby ----------------

interface LobbyProps {
  view: GameState;
  code: string;
  me: string;
  isHost: boolean;
  send: (a: Action) => void;
}

const BOT_NAMES = ['Ada', 'Bruno', 'Clara', 'Emil', 'Frieda', 'Gustav', 'Hanna', 'Ivo'];

export function Lobby({ view, code, me, isHost, send }: LobbyProps) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const host = view.players.find((p) => p.id === view.hostId);
  const free = MAX_PLAYERS - view.players.length;

  const copy = async () => {
    if (await copyText(inviteLink(code))) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    }
  };
  const addBot = () => {
    const used = new Set(view.players.map((p) => p.name));
    const name = BOT_NAMES.find((n) => !used.has(n)) ?? 'Bot';
    send({ a: 'addBot', name });
  };

  return (
    <main className="lobby">
      <section className="lobby-card">
        <div className="lobby-code">
          <span className="field-label">{t('roomCode')}</span>
          <span className="code tabular" aria-label={code.split('').join(' ')}>{code}</span>
          <p className="secondary">{t('invite')}</p>
          <button type="button" className="btn btn-secondary btn-sm" onClick={copy}>
            <Icon name={copied ? 'check' : 'link'} size={16} />
            {copied ? t('copied') : t('copyLink')}
          </button>
        </div>

        <div className="lobby-seats">
          <div className="lobby-row-head">
            <span className="field-label">{t('players')}</span>
            <span className="muted tabular">{t('seats', { n: view.players.length })}</span>
          </div>
          <ul className="seats">
            {view.players.map((p) => (
              <li key={p.id} className="seat" style={{ '--seat': SEAT_COLORS[p.seat % 6] } as CSSProperties}>
                <span className="seat-dot" />
                <span className="seat-name">{p.name}{p.id === me && <span className="muted"> · {t('you')}</span>}</span>
                {p.id === view.hostId && <span className="tag">{t('host')}</span>}
                {p.bot && <span className="tag"><Icon name="bot" size={12} />{t('bot')}</span>}
                {isHost && p.id !== view.hostId && (
                  <button type="button" className="icon-btn icon-btn-sm" onClick={() => send({ a: 'remove', id: p.id })} aria-label={t('remove') + ' ' + p.name}>
                    <Icon name="x" size={16} />
                  </button>
                )}
              </li>
            ))}
            {Array.from({ length: free }, (_, i) => (
              <li key={'free' + i} className="seat seat-free">
                {isHost && i === 0 ? (
                  <button type="button" className="seat-add" onClick={addBot}>
                    <Icon name="plus" size={16} /> {t('addBot')}
                  </button>
                ) : <span className="muted seat-open">{t('openSeat')}</span>}
              </li>
            ))}
          </ul>
        </div>

        <LobbySettings view={view} isHost={isHost} send={send} />

        <div className="lobby-foot">
          <div className="target">
            <span className="field-label">{t('gameEndsAt')}</span>
            {isHost ? (
              <div className="seg" role="group" aria-label={t('gameEndsAt')}>
                {TARGET_OPTIONS.map((v) => (
                  <button key={v} type="button" className={view.target === v ? 'is-on' : ''} aria-pressed={view.target === v} onClick={() => send({ a: 'target', value: v })}>
                    <span className="tabular">{v}</span>
                  </button>
                ))}
              </div>
            ) : (
              <span className="tabular">{view.target} {t('points')}</span>
            )}
          </div>
          {isHost ? (
            <button type="button" className="btn btn-primary btn-lg" disabled={view.players.length < 2} onClick={() => send({ a: 'start' })}>
              {view.players.length < 2 ? t('needTwo') : t('start')}
            </button>
          ) : (
            <p className="secondary waiting"><span className="spinner" />{t('waitingFor', { name: host?.name ?? t('host') })}</p>
          )}
        </div>
      </section>
    </main>
  );
}

/** Host-only game settings in the lobby; everyone else sees what is set */
function LobbySettings({ view, isHost, send }: { view: GameState; isHost: boolean; send: (a: Action) => void }) {
  const { t } = useI18n();
  const set = { ...DEFAULT_SETTINGS, ...view.settings };
  const options: [ViewPolicy, string][] = [['both', t('viewBoth')], ['3d', t('view3dOnly')], ['2d', t('view2dOnly')]];
  return (
    <div className="lobby-settings">
      <span className="field-label">{t('settings')}</span>
      <div className="setting-row">
        <span className="setting-name">{t('viewPolicy')}</span>
        {isHost ? (
          <div className="seg" role="group" aria-label={t('viewPolicy')}>
            {options.map(([v, label]) => (
              <button key={v} type="button" className={set.view === v ? 'is-on' : ''} aria-pressed={set.view === v} onClick={() => send({ a: 'settings', view: v })}>
                {label}
              </button>
            ))}
          </div>
        ) : (
          <span className="secondary">{options.find(([v]) => v === set.view)?.[1]}</span>
        )}
      </div>
      <div className="setting-row">
        <span className="setting-text">
          <span className="setting-name">{t('shuffleSeats')}</span>
          <span className="setting-hint muted">{t('shuffleSeatsHint')}</span>
        </span>
        {isHost ? (
          <button
            type="button"
            role="switch"
            aria-checked={set.shuffleSeats}
            aria-label={t('shuffleSeats')}
            className={'switch' + (set.shuffleSeats ? ' is-on' : '')}
            onClick={() => send({ a: 'settings', shuffleSeats: !set.shuffleSeats })}
          >
            <span />
          </button>
        ) : (
          <span className="secondary">{set.shuffleSeats ? t('on') : t('off')}</span>
        )}
      </div>
    </div>
  );
}
