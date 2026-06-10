import { useState, useCallback, useRef, useEffect } from 'react';
import { loadSession } from '../../auth/session.ts';
import { checkAuthStatus, type AuthState } from '../../auth/status.ts';
import { loadConfig, saveConfig, loadCredentialsStore } from '../../config/store.ts';
import { startSession, endSession, applyMemoryAccount } from '../../memory/index.ts';
import { setBaseTitle } from '../../output/title.ts';
import type { AuthResponse } from '../../auth/login.ts';
import type { SessionMeta } from '../SelectSession.tsx';

export type ActiveMode = 'login' | 'apikey' | 'select-apikey' | 'variant-builder' | 'select-account' | 'select-copilot' | 'resume-picker' | 'confirm' | null;

export interface ApiKeyPicker {
  names: string[];
  active: string | null;
}

export interface AppStatus {
  user: string;
  account: string;
  accountName: string;
  apiAccount: string;
  connected: boolean;
  theme: 'dark' | 'light';
  /** v2 login state, verified against the API on startup ('checking' until resolved). */
  authState: AuthState | 'checking';
}

export function useAppState() {
  const [ready, setReady] = useState(false);
  const [activeMode, setActiveMode] = useState<ActiveMode>(null);
  const [status, setStatus] = useState<AppStatus>({
    user: '',
    account: '',
    accountName: '',
    apiAccount: '',
    connected: true,
    theme: 'dark',
    authState: 'checking',
  });

  // Chat queue: static (frozen) components + live component
  const [chatComponents, setChatComponents] = useState<React.ReactNode[]>([]);
  const [liveComponent, setLiveComponent] = useState<React.ReactNode>(null);
  const keyCounter = useRef(0);

  // Pending auth for multi-account flow
  const [pendingAuth, setPendingAuth] = useState<AuthResponse | null>(null);

  // Profiles for the live-API account picker
  const [apiKeyPicker, setApiKeyPicker] = useState<ApiKeyPicker | null>(null);

  // Sessions offered by the /resume picker
  const [sessionPicker, setSessionPicker] = useState<SessionMeta[] | null>(null);

  // Copilot mode
  const [copilotActive, setCopilotActive] = useState(false);
  const [copilotProvider, setCopilotProvider] = useState('');

  const getNextKey = useCallback(() => {
    keyCounter.current += 1;
    return keyCounter.current;
  }, []);

  const addToChat = useCallback((component: React.ReactNode) => {
    setChatComponents(prev => [...prev, component]);
  }, []);

  // Bumped by clearChat; ChatHistory keys its <Static> on it to force a remount.
  const [historyEpoch, setHistoryEpoch] = useState(0);

  /**
   * Reset to the fresh-start UI, exactly like app launch: wipe the screen AND
   * scrollback (same escape launchTui uses on startup), drop the committed
   * history, and bump the epoch so ChatHistory's <Static> remounts and
   * re-emits just the welcome banner onto the blank screen.
   *
   * The remount is required: <Static> is append-only (it only renders
   * `items.slice(printedCount)`), so shrinking the array without a remount
   * desyncs that index and new messages stop appearing. Remount re-emission
   * needs ink >= 7.0.5 — earlier 7.x dropped the reconciler's staticNode
   * reference on key-driven remounts and silently emitted nothing.
   */
  const clearChat = useCallback(() => {
    process.stdout.write('\x1b[2J\x1b[3J\x1b[H');
    setChatComponents([]);
    setHistoryEpoch(e => e + 1);
  }, []);

  // Load session + config on mount, start memory session
  useEffect(() => {
    Promise.all([loadSession(), loadConfig(), loadCredentialsStore()]).then(async ([session, config, credentials]) => {
      // Scope memory by the `{accountName}_{apikeyProfile}` bucket key before starting
      // the session log, so per-account data never leaks across accounts. The session
      // index is labeled with the same readable key.
      const bucket = await applyMemoryAccount();
      setStatus(s => ({ ...s, apiAccount: credentials.active ?? '' }));
      if (session) {
        setStatus(s => ({
          ...s,
          user: session.user.email,
          account: session.accountKey,
          accountName: session.accountName ?? '',
        }));
      }
      const sessionId = await startSession(bucket);
      // Set the terminal window/tab title now that the session id exists. OSC 0 is
      // out-of-band, so it doesn't disturb Ink's rendering.
      setBaseTitle(`Synapse - ${sessionId}`);
      if (config.theme) {
        setStatus(s => ({ ...s, theme: config.theme! }));
      }
      setReady(true);

      // Verify the session is actually usable — this catches an expired access token or a
      // rejected refresh token up front, instead of letting the first command fail. Runs
      // after `ready` so it never blocks startup; the banner updates when it resolves.
      const auth = await checkAuthStatus();
      setStatus(s => ({ ...s, authState: auth.state }));
    });
    return () => { endSession(); };
  }, []);

  const updateStatus = useCallback((update: Partial<AppStatus>) => {
    setStatus(s => ({ ...s, ...update }));
  }, []);

  const toggleTheme = useCallback(async () => {
    const config = await loadConfig();
    const newTheme = config.theme === 'dark' ? 'light' : 'dark';
    config.theme = newTheme;
    await saveConfig(config);
    setStatus(s => ({ ...s, theme: newTheme }));
    return newTheme;
  }, []);

  return {
    ready,
    activeMode,
    setActiveMode,
    status,
    updateStatus,
    toggleTheme,
    chatComponents,
    setChatComponents,
    clearChat,
    historyEpoch,
    liveComponent,
    setLiveComponent,
    addToChat,
    getNextKey,
    pendingAuth,
    setPendingAuth,
    apiKeyPicker,
    setApiKeyPicker,
    sessionPicker,
    setSessionPicker,
    copilotActive,
    setCopilotActive,
    copilotProvider,
    setCopilotProvider,
  };
}

export type AppState = ReturnType<typeof useAppState>;
