jest.mock('expo-router', () => ({ router: {}, useFocusEffect: jest.fn() }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: jest.fn() }));

import { getContactSyncErrorMessage } from '../GoogleDriveBackupScreen';

describe('GoogleDriveBackupScreen contacts Sync feedback', () => {
  const t = (key: string): string => `translated:${key}`;

  it.each([
    ['contacts_wrong_password', 'translated:cloudBackup.contactsSyncWrongPassword'],
    ['contacts_corrupt', 'translated:cloudBackup.contactsSyncCorrupt'],
    [undefined, 'translated:cloudBackup.contactsSyncFailed'],
    ['Network request failed', 'Network request failed'],
  ])('maps %s to the correct user feedback', (error, expected) => {
    expect(getContactSyncErrorMessage(error, t)).toBe(expected);
  });
});
