import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const settingsScreens = [
  'AppPreferencesScreen.tsx',
  'BackupScreen.tsx',
  'SecuritySettingsScreen.tsx',
  'CurrencySettingsScreen.tsx',
  'WalletConfigScreen.tsx',
  'NotificationsSettingsScreen.tsx',
  'GoogleDriveBackupScreen.tsx',
  'DomainManagementScreen.tsx',
  'LightningAddressScreen.tsx',
  'SwapSettingsScreen.tsx',
  'BlacklistScreen.tsx',
  'LanguageSettingsScreen.tsx',
];

describe('wallet settings Android safe-back bindings', () => {
  it.each(settingsScreens)('%s registers the shared handler while focused', (screen) => {
    const source = readFileSync(resolve('src', 'features', 'wallet', 'screens', 'settings', screen), 'utf8');

    expect(source).toContain("from '../../utils/safeBack'");
    expect(source).toContain('useFocusEffect');
    expect(source).toContain("BackHandler.addEventListener('hardwareBackPress', safeBack)");
  });
});
