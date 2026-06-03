import { useState, useCallback, useRef, useEffect } from 'react';
import { loadSession } from '../../auth/session.ts';
import { loadConfig, saveConfig } from '../../config/store.ts';
import { startSession, endSession, applyMemoryAccount } from '../../memory/index.ts';
import type { AuthResponse } from '../../auth/login.ts';

export type ActiveMode = 'login' | 'apikey' | 'select-apikey' | 'variant-builder' | 'select-account' | 'select-copilot' | null;

export interface ApiKeyPicker {
  names: string[];
  active: string | null;
}

export interface AppStatus {
  user: string;
  account: string;
  connected: boolean;
  theme: 'dark' | 'light';
}

export function useAppState() {
  const [ready, setReady] = useState(false);
  const [activeMode, setActiveMode] = useState<ActiveMode>(null);
  const [status, setStatus] = useState<AppStatus>({
    user: '',
    account: '',
    connected: true,
    theme: 'dark',
  });

  // Chat queue: static (frozen) components + live component
  const [chatComponents, setChatComponents] = useState<React.ReactNode[]>([]);
  const [liveComponent, setLiveComponent] = useState<React.ReactNode>(null);
  const keyCounter = useRef(0);

  // Pending auth for multi-account flow
  const [pendingAuth, setPendingAuth] = useState<AuthResponse | null>(null);

  // Profiles for the live-API account picker
  const [apiKeyPicker, setApiKeyPicker] = useState<ApiKeyPicker | null>(null);

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

  // Load session + config on mount, start memory session
  useEffect(() => {
    Promise.all([loadSession(), loadConfig()]).then(async ([session, config]) => {
      // Scope memory by the composite (v2 session + active apikey profile) key before
      // starting the session log, so per-account data never leaks across accounts.
      await applyMemoryAccount();
      if (session) {
        setStatus(s => ({
          ...s,
          user: session.user.email,
          account: session.accountKey,
        }));
        startSession(session.accountKey);
      } else {
        startSession();
      }
      if (config.theme) {
        setStatus(s => ({ ...s, theme: config.theme! }));
      }
      setReady(true);
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
    liveComponent,
    setLiveComponent,
    addToChat,
    getNextKey,
    pendingAuth,
    setPendingAuth,
    apiKeyPicker,
    setApiKeyPicker,
    copilotActive,
    setCopilotActive,
    copilotProvider,
    setCopilotProvider,
  };
}

export type AppState = ReturnType<typeof useAppState>;
