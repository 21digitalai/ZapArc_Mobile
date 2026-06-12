// useSettings Hook
// Manages app settings, domain settings, and blacklist.
//
// Backed by a single module-level store (see utils/createStore) so every screen
// shares ONE settings object. Updating a setting on one screen immediately
// updates all other consumers — no per-instance copies that drift out of sync
// (e.g. the home balance keeping the old fiat symbol after the Currency screen
// switched it).

import { useCallback, useEffect } from 'react';
import { settingsService } from '../services';
import { createStore } from '../utils/createStore';
import type {
  UserSettings,
  DomainStatus,
  BlacklistData,
  CurrencyCode,
  AutoLockTimeout,
  SocialPlatform,
  ThemeMode,
} from '../features/settings/types';

// =============================================================================
// Types
// =============================================================================

export interface SettingsState {
  // User settings
  settings: UserSettings | null;
  isLoading: boolean;
  error: string | null;

  // App state
  isOnboardingComplete: boolean;
  lastSyncTime: number | null;
}

export interface SettingsActions {
  // Settings management
  loadSettings: () => Promise<void>;
  updateSettings: (updates: Partial<UserSettings>) => Promise<void>;
  resetSettings: () => Promise<void>;

  // Individual setting updates
  setCurrency: (currency: CurrencyCode) => Promise<void>;
  setTheme: (theme: ThemeMode) => Promise<void>;
  setAutoLockTimeout: (timeout: AutoLockTimeout) => Promise<void>;
  setBiometricEnabled: (enabled: boolean) => Promise<void>;
  setNotificationsEnabled: (enabled: boolean) => Promise<void>;
  setCustomLNURL: (lnurl: string | undefined) => Promise<void>;
  setSharingPlatforms: (platforms: SocialPlatform[]) => Promise<void>;

  // Domain settings
  getDomainStatus: (domain: string) => Promise<DomainStatus | null>;
  setDomainStatus: (domain: string, status: DomainStatus) => Promise<void>;
  removeDomainStatus: (domain: string) => Promise<void>;

  // Blacklist
  isBlacklisted: (lnurl: string) => Promise<boolean>;
  addToBlacklist: (lnurl: string) => Promise<void>;
  removeFromBlacklist: (lnurl: string) => Promise<void>;
  clearBlacklist: () => Promise<void>;

  // App state
  completeOnboarding: () => Promise<void>;
  updateSyncTime: () => Promise<void>;

  // Import/Export
  exportSettings: () => Promise<string>;
  importSettings: (json: string) => Promise<boolean>;
}

// =============================================================================
// Shared store + module-level loaders/mutators
// =============================================================================

const store = createStore<SettingsState>({
  settings: null,
  isLoading: true,
  error: null,
  isOnboardingComplete: false,
  lastSyncTime: null,
});

async function loadSettingsStore(): Promise<void> {
  try {
    // Only show the loading state on the FIRST load. A background refresh (e.g.
    // useFocusEffect re-reading settings when a screen regains focus) keeps the
    // existing settings on screen — otherwise consumers that gate on `isLoading`
    // would unmount their content and flash / scroll back to top each focus.
    if (store.getState().settings === null) {
      store.setState({ isLoading: true, error: null });
    } else {
      store.setState({ error: null });
    }
    const userSettings = await settingsService.getUserSettings();
    store.setState({ settings: userSettings, isLoading: false });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to load settings';
    store.setState({ error: message, isLoading: false });
    console.error('❌ [useSettings] Load failed:', err);
  }
}

async function updateSettingsStore(updates: Partial<UserSettings>): Promise<void> {
  try {
    store.setState({ isLoading: true, error: null });
    await settingsService.updateUserSettings(updates);
    const updatedSettings = await settingsService.getUserSettings();
    store.setState({ settings: updatedSettings, isLoading: false });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to update settings';
    store.setState({ error: message, isLoading: false });
    console.error('❌ [useSettings] Update failed:', err);
    throw err;
  }
}

async function resetSettingsStore(): Promise<void> {
  try {
    store.setState({ isLoading: true, error: null });
    await settingsService.resetUserSettings();
    const defaultSettings = await settingsService.getUserSettings();
    store.setState({ settings: defaultSettings, isLoading: false });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to reset settings';
    store.setState({ error: message, isLoading: false });
    console.error('❌ [useSettings] Reset failed:', err);
    throw err;
  }
}

async function loadAppStateStore(): Promise<void> {
  try {
    const [complete, time] = await Promise.all([
      settingsService.isOnboardingComplete(),
      settingsService.getLastSyncTime(),
    ]);
    store.setState({ isOnboardingComplete: complete, lastSyncTime: time });
  } catch (err) {
    console.error('❌ [useSettings] App-state load failed:', err);
  }
}

// First load happens once, when the first consumer mounts.
let initialLoadStarted = false;
function ensureInitialLoad(): void {
  if (initialLoadStarted) return;
  initialLoadStarted = true;
  void loadSettingsStore();
  void loadAppStateStore();
}

// =============================================================================
// Hook Implementation
// =============================================================================

export function useSettings(): SettingsState & SettingsActions {
  const state = store.useStore();

  useEffect(() => {
    ensureInitialLoad();
  }, []);

  const loadSettings = useCallback((): Promise<void> => loadSettingsStore(), []);
  const updateSettings = useCallback(
    (updates: Partial<UserSettings>): Promise<void> => updateSettingsStore(updates),
    []
  );
  const resetSettings = useCallback((): Promise<void> => resetSettingsStore(), []);

  // ---- Individual setting updates (all funnel through updateSettingsStore) ----
  const setCurrency = useCallback(
    (currency: CurrencyCode): Promise<void> => updateSettingsStore({ currency }),
    []
  );
  const setAutoLockTimeout = useCallback(
    (timeout: AutoLockTimeout): Promise<void> => updateSettingsStore({ autoLockTimeout: timeout }),
    []
  );
  const setTheme = useCallback(
    (theme: ThemeMode): Promise<void> => updateSettingsStore({ theme }),
    []
  );
  const setBiometricEnabled = useCallback(
    (enabled: boolean): Promise<void> => updateSettingsStore({ biometricEnabled: enabled }),
    []
  );
  const setNotificationsEnabled = useCallback(
    (enabled: boolean): Promise<void> => updateSettingsStore({ notificationsEnabled: enabled }),
    []
  );
  const setCustomLNURL = useCallback(
    (lnurl: string | undefined): Promise<void> =>
      updateSettingsStore({ customLNURL: lnurl, useBuiltInWallet: !lnurl }),
    []
  );
  const setSharingPlatforms = useCallback(
    (platforms: SocialPlatform[]): Promise<void> =>
      updateSettingsStore({ preferredSharingPlatforms: platforms }),
    []
  );

  // ---- Domain settings (stateless pass-through to the service) ----
  const getDomainStatus = useCallback(
    (domain: string): Promise<DomainStatus | null> => settingsService.getDomainStatus(domain),
    []
  );
  const setDomainStatus = useCallback(
    async (domain: string, status: DomainStatus): Promise<void> => {
      await settingsService.setDomainStatus(domain, status);
    },
    []
  );
  const removeDomainStatus = useCallback(
    async (domain: string): Promise<void> => {
      await settingsService.removeDomainStatus(domain);
    },
    []
  );

  // ---- Blacklist (stateless pass-through) ----
  const isBlacklisted = useCallback(
    (lnurl: string): Promise<boolean> => settingsService.isBlacklisted(lnurl),
    []
  );
  const addToBlacklist = useCallback(async (lnurl: string): Promise<void> => {
    await settingsService.addToBlacklist(lnurl);
  }, []);
  const removeFromBlacklist = useCallback(async (lnurl: string): Promise<void> => {
    await settingsService.removeFromBlacklist(lnurl);
  }, []);
  const clearBlacklist = useCallback(async (): Promise<void> => {
    await settingsService.clearBlacklist();
  }, []);

  // ---- App state ----
  const completeOnboarding = useCallback(async (): Promise<void> => {
    await settingsService.setOnboardingComplete(true);
    store.setState({ isOnboardingComplete: true });
  }, []);

  const updateSyncTime = useCallback(async (): Promise<void> => {
    try {
      await settingsService.setLastSyncTime(Date.now());
      const time = await settingsService.getLastSyncTime();
      store.setState({ lastSyncTime: time });
    } catch (err) {
      console.error('❌ [useSettings] Update sync time failed:', err);
    }
  }, []);

  // ---- Import/Export ----
  const exportSettings = useCallback(async (): Promise<string> => {
    const exported = await settingsService.exportSettings();
    return JSON.stringify(exported, null, 2);
  }, []);

  const importSettings = useCallback(async (json: string): Promise<boolean> => {
    try {
      const parsed = JSON.parse(json) as {
        userSettings?: UserSettings;
        domainSettings?: Record<string, DomainStatus>;
        blacklist?: BlacklistData;
      };
      await settingsService.importSettings(parsed);
      await loadSettingsStore();
      return true;
    } catch (err) {
      console.error('❌ [useSettings] Import failed:', err);
      return false;
    }
  }, []);

  return {
    // State
    settings: state.settings,
    isLoading: state.isLoading,
    error: state.error,
    isOnboardingComplete: state.isOnboardingComplete,
    lastSyncTime: state.lastSyncTime,

    // Settings Management
    loadSettings,
    updateSettings,
    resetSettings,

    // Individual Settings
    setCurrency,
    setTheme,
    setAutoLockTimeout,
    setBiometricEnabled,
    setNotificationsEnabled,
    setCustomLNURL,
    setSharingPlatforms,

    // Domain Settings
    getDomainStatus,
    setDomainStatus,
    removeDomainStatus,

    // Blacklist
    isBlacklisted,
    addToBlacklist,
    removeFromBlacklist,
    clearBlacklist,

    // App State
    completeOnboarding,
    updateSyncTime,

    // Import/Export
    exportSettings,
    importSettings,
  };
}
