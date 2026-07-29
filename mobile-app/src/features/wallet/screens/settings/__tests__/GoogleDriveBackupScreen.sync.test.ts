import React from 'react';
import { Alert, TextInput } from 'react-native';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

const mockRestoreContacts = jest.fn();
const mockMergeImportedContacts = jest.fn();
const mockRefreshContactsStore = jest.fn();

jest.mock('expo-router', () => ({
  router: { canGoBack: jest.fn(() => false), back: jest.fn(), replace: jest.fn() },
  useFocusEffect: jest.fn((callback: () => void | (() => void)) => callback()),
}));
jest.mock('react-native-safe-area-context', () => {
  const React = require('react');
  const { View } = require('react-native');
  return { SafeAreaView: ({ children }: { children: React.ReactNode }) => React.createElement(View, null, children), useSafeAreaInsets: () => ({ bottom: 0 }) };
});
jest.mock('expo-linear-gradient', () => ({ LinearGradient: ({ children }: { children: React.ReactNode }) => children }));
jest.mock('expo-local-authentication', () => ({ hasHardwareAsync: jest.fn(), isEnrolledAsync: jest.fn() }));
jest.mock('expo-document-picker', () => ({ getDocumentAsync: jest.fn() }));
jest.mock('expo-file-system', () => ({ readAsStringAsync: jest.fn() }));
jest.mock('../../../../../hooks/useWallet', () => ({ useWallet: () => ({ getMnemonic: jest.fn(), activeMasterKey: { id: 'wallet-1' }, importMasterKey: jest.fn(), masterKeys: [{ id: 'wallet-1', nickname: 'Primary' }] }) }));
jest.mock('../../../../../hooks/useWalletAuth', () => ({ useWalletAuth: () => ({ selectWallet: jest.fn(), getSessionPin: jest.fn() }) }));
jest.mock('../../../../../contexts/ThemeContext', () => ({ useAppTheme: () => ({ themeMode: 'dark' }) }));
jest.mock('../../../../../hooks/useLanguage', () => ({ useLanguage: () => ({ t: (key: string) => key }) }));
jest.mock('../../../../../services', () => ({ storageService: { loadMultiWalletStorage: jest.fn().mockResolvedValue({ masterKeys: [{ id: 'wallet-1' }] }) }, settingsService: { getUserSettings: jest.fn().mockResolvedValue({ biometricEnabled: false }) } }));
jest.mock('../../../../../services/googleDriveBackupService', () => ({
  googleDriveBackupService: {
    initialize: jest.fn().mockResolvedValue(undefined), restoreSession: jest.fn().mockResolvedValue(true),
    getUserInfo: jest.fn().mockResolvedValue({ email: 'test@example.com' }),
    listBackups: jest.fn().mockResolvedValue([{ id: 'backup-1', timestamp: 1, seedFingerprint: 'fingerprint-1' }]),
    getLocalFingerprint: jest.fn().mockResolvedValue('fingerprint-1'), restoreContacts: (...args: unknown[]) => mockRestoreContacts(...args),
  },
}));
jest.mock('../../../../addressBook', () => ({
  contactService: { mergeImportedContacts: (...args: unknown[]) => mockMergeImportedContacts(...args) },
  refreshContactsStore: (...args: unknown[]) => mockRefreshContactsStore(...args),
}));
jest.mock('../../../../addressBook/services/contactService', () => ({ sanitizeImportedContact: jest.fn() }));
jest.mock('../../../../../components/StyledTextInput', () => {
  const React = require('react'); const { TextInput } = require('react-native');
  return { StyledTextInput: (props: object) => React.createElement(TextInput, props) };
});
jest.mock('../../../../../components/PinSetupKeypad', () => ({ PinSetupKeypad: () => null }));

import { getContactSyncErrorMessage, GoogleDriveBackupScreen } from '../GoogleDriveBackupScreen';

describe('GoogleDriveBackupScreen Restore Contacts feedback', () => {
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

describe('GoogleDriveBackupScreen Restore Contacts flow', () => {
  const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(jest.fn());

  beforeEach(() => {
    jest.clearAllMocks();
    mockMergeImportedContacts.mockResolvedValue({ added: 1, skipped: 1 });
    mockRestoreContacts.mockResolvedValue({ success: true, contacts: [{ id: 'contact-1' }] });
  });

  afterAll(() => alertSpy.mockRestore());

  async function startRestoreContacts(): Promise<void> {
    render(React.createElement(GoogleDriveBackupScreen));
    await waitFor(() => expect(screen.getByText('cloudBackup.manageBackup')).toBeTruthy());
    fireEvent.press(screen.getByText('cloudBackup.manageBackup'));
    await waitFor(() => expect(screen.getByText('cloudBackup.restoreContacts')).toBeTruthy());
    fireEvent.press(screen.getByText('cloudBackup.restoreContacts'));
    fireEvent.changeText(screen.UNSAFE_getAllByType(TextInput)[0], 'backup-password');
    await act(async () => {
      fireEvent.press(screen.getByText('cloudBackup.restoreContacts'));
    });
  }

  it('merges new cloud contacts, refreshes the store, and reports result counts', async () => {
    await startRestoreContacts();
    await waitFor(() => expect(mockMergeImportedContacts).toHaveBeenCalledWith([{ id: 'contact-1' }]));
    expect(mockRefreshContactsStore).toHaveBeenCalled();
    expect(alertSpy).toHaveBeenCalledWith('cloudBackup.contactsSyncTitle', 'cloudBackup.mergeContactsResult');
  });

  it.each([
    [{ success: true, contacts: [] }, 'cloudBackup.noContactsInBackup'],
    [{ success: false, error: 'contacts_wrong_password' }, 'cloudBackup.contactsSyncWrongPassword'],
    [{ success: false, error: 'contacts_corrupt' }, 'cloudBackup.contactsSyncCorrupt'],
  ])('reports no-op and classified sync failures', async (result, expected) => {
    mockRestoreContacts.mockResolvedValue(result);
    await startRestoreContacts();
    await waitFor(() => expect(alertSpy).toHaveBeenCalledWith(expect.any(String), expected));
    expect(mockMergeImportedContacts).not.toHaveBeenCalled();
    expect(mockRefreshContactsStore).not.toHaveBeenCalled();
  });

  it('reports offline fetch failures without mutating the address book', async () => {
    mockRestoreContacts.mockRejectedValue(new Error('offline'));
    await startRestoreContacts();
    await waitFor(() => expect(alertSpy).toHaveBeenCalledWith('common.error', 'cloudBackup.contactsSyncFailed'));
    expect(mockMergeImportedContacts).not.toHaveBeenCalled();
  });
});

describe('GoogleDriveBackupScreen protected replacement flow', () => {
  it('renders a current-password gate and delete-then-recreate recovery path', async () => {
    render(React.createElement(GoogleDriveBackupScreen));
    await waitFor(() => expect(screen.getByText('cloudBackup.manageBackup')).toBeTruthy());
    fireEvent.press(screen.getByText('cloudBackup.manageBackup'));
    await waitFor(() => expect(screen.getByText('cloudBackup.replaceBackup')).toBeTruthy());
    fireEvent.press(screen.getByText('cloudBackup.replaceBackup'));
    await waitFor(() => expect(screen.getByText('cloudBackup.verifyCurrentBackupPassword')).toBeTruthy());
    expect(screen.getByText('cloudBackup.replaceBackupPasswordRecovery')).toBeTruthy();
    expect(screen.getByText('cloudBackup.replaceBackup')).toBeTruthy();
  });
});

describe('GoogleDriveBackupScreen backup management layout', () => {
  it('renders a single no-backup action and the explained management actions', async () => {
    const backupService = require('../../../../../services/googleDriveBackupService').googleDriveBackupService;
    backupService.listBackups.mockResolvedValueOnce([]);

    render(React.createElement(GoogleDriveBackupScreen));

    await waitFor(() => expect(screen.getByText('cloudBackup.backUpNow')).toBeTruthy());
    expect(screen.queryByText('cloudBackup.manageBackup')).toBeNull();

    backupService.listBackups.mockResolvedValue([{ id: 'backup-1', timestamp: 1, seedFingerprint: 'fingerprint-1' }]);
    render(React.createElement(GoogleDriveBackupScreen));
    await waitFor(() => expect(screen.getByText('cloudBackup.manageBackup')).toBeTruthy());
    fireEvent.press(screen.getByText('cloudBackup.manageBackup'));

    expect(screen.getByText('cloudBackup.replaceBackupDescription')).toBeTruthy();
    expect(screen.getByText('cloudBackup.restoreContactsDescription')).toBeTruthy();
    expect(screen.getByText('cloudBackup.changeBackupPasswordDescription')).toBeTruthy();
    expect(screen.getByText('cloudBackup.deleteBackupDescription')).toBeTruthy();

    const scrollSheet = screen.getByTestId('manage-backup-scroll');
    expect(scrollSheet.props.showsVerticalScrollIndicator).toBe(true);
    expect(scrollSheet.props.contentContainerStyle).toEqual(expect.objectContaining({ paddingBottom: 12 }));
  });
});
