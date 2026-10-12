import React from 'react';
import { Alert, Platform, TextInput } from 'react-native';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

const mockRestoreContacts = jest.fn();
const mockMergeImportedContacts = jest.fn();
const mockRefreshContactsStore = jest.fn();
const mockGetMnemonic = jest.fn();
const mockSessionPin = jest.fn();
const mockGetAllContacts = jest.fn();
const mockGetBiometricPin = jest.fn();
const mockAuthenticateAsync = jest.fn();
const mockDecryptMnemonic = jest.fn();
const mockPinSetupKeypad = jest.fn();
const mockSaveEncryptedBackupToAndroidDownloads = jest.fn();
let mockActiveMasterKey = { id: 'wallet-1', nickname: 'Primary' };
const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(jest.fn());

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
jest.mock('expo-local-authentication', () => ({
  hasHardwareAsync: jest.fn(),
  isEnrolledAsync: jest.fn(),
  authenticateAsync: (...args: unknown[]) => mockAuthenticateAsync(...args),
}));
jest.mock('expo-document-picker', () => ({ getDocumentAsync: jest.fn() }));
jest.mock('expo-file-system', () => ({
  cacheDirectory: 'file:///cache/',
  EncodingType: { UTF8: 'utf8' },
  readAsStringAsync: jest.fn(),
  writeAsStringAsync: jest.fn(),
  deleteAsync: jest.fn(),
}));
jest.mock('expo-sharing', () => ({
  isAvailableAsync: jest.fn(),
  shareAsync: jest.fn(),
}));
jest.mock('../../../utils/saveQrToDevice', () => ({
  saveEncryptedBackupToAndroidDownloads: (...args: unknown[]) => mockSaveEncryptedBackupToAndroidDownloads(...args),
}));
jest.mock('../../../../../hooks/useWallet', () => ({ useWallet: () => ({ getMnemonic: mockGetMnemonic, activeMasterKey: mockActiveMasterKey, importMasterKey: jest.fn(), masterKeys: [mockActiveMasterKey] }) }));
jest.mock('../../../../../hooks/useWalletAuth', () => ({ useWalletAuth: () => ({ selectWallet: jest.fn(), getSessionPin: mockSessionPin }) }));
jest.mock('../../../../../contexts/ThemeContext', () => ({ useAppTheme: () => ({ themeMode: 'dark' }) }));
jest.mock('../../../../../hooks/useLanguage', () => ({ useLanguage: () => ({ t: (key: string) => key }) }));
jest.mock('../../../../../services', () => ({ storageService: { loadMultiWalletStorage: jest.fn().mockResolvedValue({ masterKeys: [{ id: 'wallet-1' }] }), getBiometricPin: (...args: unknown[]) => mockGetBiometricPin(...args) }, settingsService: { getUserSettings: jest.fn().mockResolvedValue({ biometricEnabled: false }) } }));
jest.mock('../../../../../services/googleDriveBackupService', () => ({
  googleDriveBackupService: {
    initialize: jest.fn().mockResolvedValue(undefined), restoreSession: jest.fn().mockResolvedValue(true),
    getUserInfo: jest.fn().mockResolvedValue({ email: 'test@example.com' }),
    listBackups: jest.fn().mockResolvedValue([{ id: 'backup-1', timestamp: 1, seedFingerprint: 'fingerprint-1' }]),
    getLocalFingerprint: jest.fn().mockResolvedValue('fingerprint-1'), restoreContacts: (...args: unknown[]) => mockRestoreContacts(...args),
  },
}));
jest.mock('../../../../addressBook', () => ({
  contactService: { mergeImportedContacts: (...args: unknown[]) => mockMergeImportedContacts(...args), getAllContacts: (...args: unknown[]) => mockGetAllContacts(...args) },
  refreshContactsStore: (...args: unknown[]) => mockRefreshContactsStore(...args),
}));
jest.mock('../../../../addressBook/services/contactService', () => ({ sanitizeImportedContact: jest.fn() }));
jest.mock('../../../../../services/backupEncryption', () => ({
  ...jest.requireActual('../../../../../services/backupEncryption'),
  decryptMnemonic: (...args: unknown[]) => mockDecryptMnemonic(...args),
}));
jest.mock('../../../../../components/StyledTextInput', () => {
  const React = require('react'); const { TextInput } = require('react-native');
  return { StyledTextInput: (props: object) => React.createElement(TextInput, props) };
});
jest.mock('../../../../../components/PinSetupKeypad', () => {
  const React = require('react'); const { Text } = require('react-native');
  return { PinSetupKeypad: (props: object) => { mockPinSetupKeypad(props); return React.createElement(Text, null, 'Pin setup ready'); } };
});

import {
  getContactSyncErrorMessage,
  GoogleDriveBackupScreen,
  restoreContactsIfAddressBookEmpty,
} from '../GoogleDriveBackupScreen';

describe('wallet restore contact policy', () => {
  const cloudContacts = [{
    id: 'cloud-1',
    name: 'Alice',
    lightningAddress: 'alice@example.com',
    createdAt: 1,
    updatedAt: 1,
  }];

  it('automatically restores contacts when the local address book is empty', async () => {
    const dependencies = {
      getAllContacts: jest.fn().mockResolvedValue([]),
      mergeImportedContacts: jest.fn().mockResolvedValue({ added: 1, skipped: 0 }),
      refreshContactsStore: jest.fn().mockResolvedValue(undefined),
    };

    await expect(restoreContactsIfAddressBookEmpty(cloudContacts, dependencies)).resolves.toBe(true);
    expect(dependencies.mergeImportedContacts).toHaveBeenCalledWith(cloudContacts);
    expect(dependencies.refreshContactsStore).toHaveBeenCalledTimes(1);
  });

  it('leaves restoration to the merge prompt when local contacts exist', async () => {
    const dependencies = {
      getAllContacts: jest.fn().mockResolvedValue([{ ...cloudContacts[0], id: 'local-1' }]),
      mergeImportedContacts: jest.fn(),
      refreshContactsStore: jest.fn(),
    };

    await expect(restoreContactsIfAddressBookEmpty(cloudContacts, dependencies)).resolves.toBe(false);
    expect(dependencies.mergeImportedContacts).not.toHaveBeenCalled();
    expect(dependencies.refreshContactsStore).not.toHaveBeenCalled();
  });
});

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
  beforeEach(() => {
    jest.clearAllMocks();
    mockMergeImportedContacts.mockResolvedValue({ added: 1, skipped: 1 });
    mockRestoreContacts.mockResolvedValue({ success: true, contacts: [{ id: 'contact-1' }] });
  });

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

describe('GoogleDriveBackupScreen local backup entry', () => {
  const originalPlatform = Platform.OS;

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetMnemonic.mockReset();
    mockSessionPin.mockReset();
    mockGetAllContacts.mockReset();
    mockGetAllContacts.mockResolvedValue([]);
    mockGetBiometricPin.mockReset();
    mockAuthenticateAsync.mockReset();
    mockDecryptMnemonic.mockReset();
    mockPinSetupKeypad.mockReset();
    mockSaveEncryptedBackupToAndroidDownloads.mockReset();
    mockActiveMasterKey = { id: 'wallet-1', nickname: 'Primary' };
    require('../../../../../services').settingsService.getUserSettings.mockResolvedValue({ biometricEnabled: false });
    Object.defineProperty(Platform, 'OS', { configurable: true, value: originalPlatform });
  });

  afterAll(() => {
    Object.defineProperty(Platform, 'OS', { configurable: true, value: originalPlatform });
  });

  it('offers a local encrypted backup without requiring Google connection', async () => {
    const backupService = require('../../../../../services/googleDriveBackupService').googleDriveBackupService;
    backupService.restoreSession.mockResolvedValueOnce(false);

    render(React.createElement(GoogleDriveBackupScreen));
    await waitFor(() => expect(screen.getByText('Save Encrypted Backup')).toBeTruthy());
    fireEvent.press(screen.getByText('Save Encrypted Backup'));

    await waitFor(() => expect(screen.getByText('cloudBackup.enterBackupPassword')).toBeTruthy());
  });

  it('opens local save without either biometric confirmation gate', async () => {
    const services = require('../../../../../services');
    services.settingsService.getUserSettings.mockResolvedValue({ biometricEnabled: true });
    mockAuthenticateAsync.mockResolvedValue({ success: false });

    render(React.createElement(GoogleDriveBackupScreen));
    await waitFor(() => expect(screen.getByText('Save Encrypted Backup')).toBeTruthy());
    fireEvent.press(screen.getByText('Save Encrypted Backup'));

    await waitFor(() => expect(screen.getByText('cloudBackup.enterBackupPassword')).toBeTruthy());
    expect(mockAuthenticateAsync).not.toHaveBeenCalled();
  });

  it('keeps save and load actions together in the Local Backup section', async () => {
    render(React.createElement(GoogleDriveBackupScreen));

    await waitFor(() => expect(screen.getByText('Local Backup')).toBeTruthy());
    expect(screen.getByText('Save Encrypted Backup')).toBeTruthy();
    expect(screen.getByText('Load from File')).toBeTruthy();
    expect(screen.queryByText('Restore from File')).toBeNull();
  });

  it('uses the iOS share fallback for an encrypted temporary file without Google auth', async () => {
    const fileSystem = require('expo-file-system');
    const sharing = require('expo-sharing');
    fileSystem.writeAsStringAsync.mockResolvedValue(undefined);
    fileSystem.deleteAsync.mockResolvedValue(undefined);
    sharing.isAvailableAsync.mockResolvedValue(true);
    sharing.shareAsync.mockResolvedValue(undefined);
    mockSessionPin.mockReturnValue('123456');
    mockGetMnemonic.mockResolvedValue(
      'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
    );

    render(React.createElement(GoogleDriveBackupScreen));
    await waitFor(() => expect(screen.getByText('Save Encrypted Backup')).toBeTruthy());
    fireEvent.press(screen.getByText('Save Encrypted Backup'));
    await waitFor(() => expect(screen.getByText('cloudBackup.enterBackupPassword')).toBeTruthy());
    const inputs = screen.UNSAFE_getAllByType(TextInput);
    fireEvent.changeText(inputs[0], 'Backup passphrase 123!');
    fireEvent.changeText(inputs[1], 'Backup passphrase 123!');
    fireEvent.press(screen.getByText('cloudBackup.createBackup'));

    await waitFor(() => expect(fileSystem.writeAsStringAsync).toHaveBeenCalled());
    expect(mockGetMnemonic).toHaveBeenCalledWith('wallet-1', '123456');
    expect(sharing.shareAsync).toHaveBeenCalledWith(
      expect.stringContaining('zaparc-backup-'),
      expect.objectContaining({ mimeType: 'application/json' })
    );
    expect(fileSystem.deleteAsync).toHaveBeenCalled();
  });

  it('saves an encrypted Android backup directly to Downloads without opening the share sheet', async () => {
    const fileSystem = require('expo-file-system');
    const sharing = require('expo-sharing');
    Object.defineProperty(Platform, 'OS', { configurable: true, value: 'android' });
    fileSystem.writeAsStringAsync.mockResolvedValue(undefined);
    fileSystem.deleteAsync.mockResolvedValue(undefined);
    mockSaveEncryptedBackupToAndroidDownloads.mockResolvedValue({
      status: 'saved',
      fileName: 'ignored.json',
      uri: 'content://media/external/downloads/1',
    });
    mockSessionPin.mockReturnValue('123456');
    mockGetMnemonic.mockResolvedValue('abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about');

    render(React.createElement(GoogleDriveBackupScreen));
    await waitFor(() => expect(screen.getByText('Save Encrypted Backup')).toBeTruthy());
    fireEvent.press(screen.getByText('Save Encrypted Backup'));
    const inputs = screen.UNSAFE_getAllByType(TextInput);
    fireEvent.changeText(inputs[0], 'Backup passphrase 123!');
    fireEvent.changeText(inputs[1], 'Backup passphrase 123!');
    fireEvent.press(screen.getByText('cloudBackup.createBackup'));

    await waitFor(() => expect(mockSaveEncryptedBackupToAndroidDownloads).toHaveBeenCalled());
    const [sourceUri, filename] = mockSaveEncryptedBackupToAndroidDownloads.mock.calls[0];
    expect(sourceUri).toContain('zaparc-backup-');
    expect(filename).toMatch(/^zaparc-backup-.*\.json$/);
    expect(sharing.shareAsync).not.toHaveBeenCalled();
    expect(fileSystem.deleteAsync).toHaveBeenCalledWith(sourceUri, { idempotent: true });
    expect(alertSpy).toHaveBeenCalledWith('common.success', 'Encrypted backup saved to Downloads/ZapArc.');
  });

  it('does not report Android backup success when the Downloads adapter rejects', async () => {
    const fileSystem = require('expo-file-system');
    const sharing = require('expo-sharing');
    Object.defineProperty(Platform, 'OS', { configurable: true, value: 'android' });
    fileSystem.writeAsStringAsync.mockResolvedValue(undefined);
    fileSystem.deleteAsync.mockResolvedValue(undefined);
    mockSaveEncryptedBackupToAndroidDownloads.mockRejectedValue(new Error('Downloads write was not committed'));
    mockSessionPin.mockReturnValue('123456');
    mockGetMnemonic.mockResolvedValue('abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about');

    render(React.createElement(GoogleDriveBackupScreen));
    await waitFor(() => expect(screen.getByText('Save Encrypted Backup')).toBeTruthy());
    fireEvent.press(screen.getByText('Save Encrypted Backup'));
    const inputs = screen.UNSAFE_getAllByType(TextInput);
    fireEvent.changeText(inputs[0], 'Backup passphrase 123!');
    fireEvent.changeText(inputs[1], 'Backup passphrase 123!');
    fireEvent.press(screen.getByText('cloudBackup.createBackup'));

    await waitFor(() => expect(mockSaveEncryptedBackupToAndroidDownloads).toHaveBeenCalled());
    await waitFor(() => expect(alertSpy).toHaveBeenCalledWith('common.error', 'Failed to create backup'));
    expect(alertSpy).not.toHaveBeenCalledWith('common.success', 'Encrypted backup saved to Downloads/ZapArc.');
    expect(sharing.shareAsync).not.toHaveBeenCalled();
    expect(fileSystem.deleteAsync).toHaveBeenCalled();
  });

  it('includes contacts by default in a local encrypted backup', async () => {
    const fileSystem = require('expo-file-system');
    const sharing = require('expo-sharing');
    fileSystem.writeAsStringAsync.mockResolvedValue(undefined);
    fileSystem.deleteAsync.mockResolvedValue(undefined);
    sharing.isAvailableAsync.mockResolvedValue(true);
    sharing.shareAsync.mockResolvedValue(undefined);
    mockSessionPin.mockReturnValue('123456');
    mockGetMnemonic.mockResolvedValue('abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about');
    mockGetAllContacts.mockResolvedValue([{ id: 'contact-1', name: 'Alice' }]);

    render(React.createElement(GoogleDriveBackupScreen));
    await waitFor(() => expect(screen.getByText('Save Encrypted Backup')).toBeTruthy());
    fireEvent.press(screen.getByText('Save Encrypted Backup'));
    const inputs = screen.UNSAFE_getAllByType(TextInput);
    fireEvent.changeText(inputs[0], 'Backup passphrase 123!');
    fireEvent.changeText(inputs[1], 'Backup passphrase 123!');
    fireEvent.press(screen.getByText('cloudBackup.createBackup'));

    await waitFor(() => expect(fileSystem.writeAsStringAsync).toHaveBeenCalled());
    expect(mockGetAllContacts).toHaveBeenCalledTimes(1);
    const lastWrite = fileSystem.writeAsStringAsync.mock.calls.at(-1);
    expect(JSON.parse(lastWrite[1]).contacts).toBeTruthy();
  });

  it('allows the user to turn off contacts for a local backup', async () => {
    const fileSystem = require('expo-file-system');
    const sharing = require('expo-sharing');
    fileSystem.writeAsStringAsync.mockResolvedValue(undefined);
    fileSystem.deleteAsync.mockResolvedValue(undefined);
    sharing.isAvailableAsync.mockResolvedValue(true);
    sharing.shareAsync.mockResolvedValue(undefined);
    mockSessionPin.mockReturnValue('123456');
    mockGetMnemonic.mockResolvedValue('abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about');

    render(React.createElement(GoogleDriveBackupScreen));
    await waitFor(() => expect(screen.getByText('Save Encrypted Backup')).toBeTruthy());
    fireEvent.press(screen.getByText('Save Encrypted Backup'));
    fireEvent.press(screen.getByText('cloudBackup.includeContacts'));
    const inputs = screen.UNSAFE_getAllByType(TextInput);
    fireEvent.changeText(inputs[0], 'Backup passphrase 123!');
    fireEvent.changeText(inputs[1], 'Backup passphrase 123!');
    fireEvent.press(screen.getByText('cloudBackup.createBackup'));

    await waitFor(() => expect(fileSystem.writeAsStringAsync).toHaveBeenCalled());
    expect(mockGetAllContacts).not.toHaveBeenCalled();
    const lastWrite = fileSystem.writeAsStringAsync.mock.calls.at(-1);
    expect(JSON.parse(lastWrite[1]).contacts).toBeUndefined();
  });

  it('does not save a local backup when requested contacts cannot be loaded', async () => {
    const fileSystem = require('expo-file-system');
    const sharing = require('expo-sharing');
    fileSystem.writeAsStringAsync.mockResolvedValue(undefined);
    sharing.isAvailableAsync.mockResolvedValue(true);
    mockSessionPin.mockReturnValue('123456');
    mockGetMnemonic.mockResolvedValue('abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about');
    mockGetAllContacts.mockRejectedValue(new Error('address book unavailable'));

    render(React.createElement(GoogleDriveBackupScreen));
    await waitFor(() => expect(screen.getByText('Save Encrypted Backup')).toBeTruthy());
    fireEvent.press(screen.getByText('Save Encrypted Backup'));
    const inputs = screen.UNSAFE_getAllByType(TextInput);
    fireEvent.changeText(inputs[0], 'Backup passphrase 123!');
    fireEvent.changeText(inputs[1], 'Backup passphrase 123!');
    fireEvent.press(screen.getByText('cloudBackup.createBackup'));

    await waitFor(() => expect(alertSpy).toHaveBeenCalledWith('common.error', 'Could not load contacts for backup. Your backup was not created.'));
    expect(fileSystem.writeAsStringAsync).not.toHaveBeenCalled();
    expect(sharing.shareAsync).not.toHaveBeenCalled();
  });

  it('uses the manual PIN fallback for local save and reports an incorrect PIN', async () => {
    mockGetBiometricPin.mockResolvedValue('biometric-pin');
    mockGetMnemonic.mockRejectedValue(new Error('wrong pin'));

    render(React.createElement(GoogleDriveBackupScreen));
    await waitFor(() => expect(screen.getByText('Save Encrypted Backup')).toBeTruthy());
    fireEvent.press(screen.getByText('Save Encrypted Backup'));
    const passwordInputs = screen.UNSAFE_getAllByType(TextInput);
    fireEvent.changeText(passwordInputs[0], 'Backup passphrase 123!');
    fireEvent.changeText(passwordInputs[1], 'Backup passphrase 123!');
    fireEvent.press(screen.getByText('cloudBackup.createBackup'));

    await waitFor(() => expect(screen.getByText('Enter your wallet PIN')).toBeTruthy());
    expect(mockGetBiometricPin).not.toHaveBeenCalled();
    fireEvent.changeText(screen.UNSAFE_getAllByType(TextInput)[2], '654321');
    fireEvent.press(screen.getByText('common.confirm'));

    await waitFor(() => expect(alertSpy).toHaveBeenCalledWith('common.error', 'Incorrect PIN'));
    expect(mockGetMnemonic).toHaveBeenCalledWith('wallet-1', '654321');
  });

  it('leaves wallet state untouched when local-file selection is cancelled', async () => {
    const documentPicker = require('expo-document-picker');
    const fileSystem = require('expo-file-system');
    documentPicker.getDocumentAsync.mockResolvedValue({ canceled: true, assets: [] });

    render(React.createElement(GoogleDriveBackupScreen));
    await waitFor(() => expect(screen.getByText('Load from File')).toBeTruthy());
    fireEvent.press(screen.getByText('Load from File'));

    await waitFor(() => expect(documentPicker.getDocumentAsync).toHaveBeenCalled());
    expect(fileSystem.readAsStringAsync).not.toHaveBeenCalled();
    expect(mockGetMnemonic).not.toHaveBeenCalled();
  });

  it('rejects an oversized local backup before reading it', async () => {
    const documentPicker = require('expo-document-picker');
    const fileSystem = require('expo-file-system');
    documentPicker.getDocumentAsync.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file:///backup.json', name: 'backup.json', size: 1024 * 1024 + 1 }],
    });

    render(React.createElement(GoogleDriveBackupScreen));
    await waitFor(() => expect(screen.getByText('Load from File')).toBeTruthy());
    fireEvent.press(screen.getByText('Load from File'));

    await waitFor(() => expect(documentPicker.getDocumentAsync).toHaveBeenCalled());
    expect(fileSystem.readAsStringAsync).not.toHaveBeenCalled();
  });

  it('rejects malformed local files and read failures before opening restore', async () => {
    const documentPicker = require('expo-document-picker');
    const fileSystem = require('expo-file-system');
    documentPicker.getDocumentAsync.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file:///backup.json', name: 'backup.json', size: 128 }],
    });
    fileSystem.readAsStringAsync.mockResolvedValue('{not-json');

    render(React.createElement(GoogleDriveBackupScreen));
    await waitFor(() => expect(screen.getByText('Load from File')).toBeTruthy());
    fireEvent.press(screen.getByText('Load from File'));
    await waitFor(() => expect(fileSystem.readAsStringAsync).toHaveBeenCalled());
    expect(screen.queryByText('cloudBackup.enterBackupPassword')).toBeNull();
  });

  async function openLocalRestore(backup = {
    version: 3,
    format: 'aes-256-gcm',
    salt: 'salt',
    iv: 'iv',
    ciphertext: 'ciphertext',
    authTag: 'tag',
    timestamp: 1,
  }): Promise<void> {
    const documentPicker = require('expo-document-picker');
    const fileSystem = require('expo-file-system');
    documentPicker.getDocumentAsync.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file:///backup.json', name: 'backup.json', size: 128 }],
    });
    fileSystem.readAsStringAsync.mockResolvedValue(JSON.stringify(backup));

    fireEvent.press(screen.getByText('Load from File'));
    await waitFor(() => expect(screen.getByText('cloudBackup.enterRestorePassword')).toBeTruthy());
    fireEvent.changeText(screen.UNSAFE_getAllByType(TextInput)[0], 'backup-password');
  }

  it('opens PIN setup after decrypting a local backup for the matching active master', async () => {
    mockDecryptMnemonic.mockResolvedValue('abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about');

    render(React.createElement(GoogleDriveBackupScreen));
    await waitFor(() => expect(screen.getByText('Load from File')).toBeTruthy());
    await openLocalRestore();
    fireEvent.press(screen.getByText('cloudBackup.restore'));

    await waitFor(() => expect(mockDecryptMnemonic).toHaveBeenCalledWith(expect.objectContaining({ version: 3 }), 'backup-password'));
    await waitFor(() => expect(screen.getByText('Pin setup ready')).toBeTruthy());
    expect(mockPinSetupKeypad).toHaveBeenCalled();
  });

  it('keeps restore state closed when the local backup password is wrong', async () => {
    mockDecryptMnemonic.mockRejectedValue(new Error('Failed to decrypt backup. Please check your password.'));

    render(React.createElement(GoogleDriveBackupScreen));
    await waitFor(() => expect(screen.getByText('Load from File')).toBeTruthy());
    await openLocalRestore();
    fireEvent.press(screen.getByText('cloudBackup.restore'));

    await waitFor(() => expect(alertSpy).toHaveBeenCalledWith('common.error', 'Incorrect password. Please try again.'));
    expect(mockPinSetupKeypad).not.toHaveBeenCalled();
  });

  it('blocks duplicate local restore submissions while decryption is pending', async () => {
    let finishDecryption: ((mnemonic: string) => void) | undefined;
    mockDecryptMnemonic.mockImplementation(() => new Promise((resolve) => { finishDecryption = resolve; }));

    render(React.createElement(GoogleDriveBackupScreen));
    await waitFor(() => expect(screen.getByText('Load from File')).toBeTruthy());
    await openLocalRestore();
    fireEvent.press(screen.getByText('cloudBackup.restore'));
    fireEvent.press(screen.getByText('cloudBackup.restore'));

    expect(mockDecryptMnemonic).toHaveBeenCalledTimes(1);
    await act(async () => {
      finishDecryption?.('abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about');
    });
    await waitFor(() => expect(screen.getByText('Pin setup ready')).toBeTruthy());
  });

  it('fails closed if the selected master changes during local restore decryption', async () => {
    let finishDecryption: ((mnemonic: string) => void) | undefined;
    mockDecryptMnemonic.mockImplementation(() => new Promise((resolve) => { finishDecryption = resolve; }));

    const view = render(React.createElement(GoogleDriveBackupScreen));
    await waitFor(() => expect(screen.getByText('Load from File')).toBeTruthy());
    await openLocalRestore();
    fireEvent.press(screen.getByText('cloudBackup.restore'));

    mockActiveMasterKey = { id: 'wallet-2', nickname: 'Secondary' };
    view.rerender(React.createElement(GoogleDriveBackupScreen));
    await act(async () => {
      finishDecryption?.('abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about');
    });

    await waitFor(() => expect(alertSpy).toHaveBeenCalledWith('common.error', 'The selected wallet changed. Please choose the backup file again.'));
    expect(mockPinSetupKeypad).not.toHaveBeenCalled();
  });
});
