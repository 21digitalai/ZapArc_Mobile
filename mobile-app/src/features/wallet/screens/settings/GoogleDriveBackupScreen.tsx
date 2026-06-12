// Google Drive Backup Settings Screen
// Manage encrypted seed phrase backups to Google Drive

import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  Alert,
  Modal,
  TouchableOpacity,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import {
  Text,
  Button,
  IconButton,
  ProgressBar,
  Switch,
} from 'react-native-paper';
import { TextInput } from 'react-native-paper'; // Only for TextInput.Icon
import { StyledTextInput } from '../../../../components/StyledTextInput';
import { PinSetupKeypad } from '../../../../components/PinSetupKeypad';
import { KeyboardDoneAccessory, keyboardDoneAccessoryId } from '../../../../components/KeyboardDoneAccessory';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import * as LocalAuthentication from 'expo-local-authentication';
import { useWallet } from '../../../../hooks/useWallet';
import { useWalletAuth } from '../../../../hooks/useWalletAuth';
import { storageService, settingsService } from '../../../../services';
import { useAppTheme } from '../../../../contexts/ThemeContext';
import { generateMasterKeyNickname } from '../../../../utils/mnemonic';
import { WALLET_PIN_LENGTH } from '../../constants/security';
import { useLanguage } from '../../../../hooks/useLanguage';
import {
  getGradientColors,
  getPrimaryTextColor,
  getSecondaryTextColor,
  BRAND_COLOR,
} from '../../../../utils/theme-helpers';
import {
  googleDriveBackupService,
  type GoogleUser,
  type BackupMetadata,
} from '../../../../services/googleDriveBackupService';
import { contactService, refreshContactsStore } from '../../../addressBook';
import type { Contact } from '../../../addressBook/types';
import { CONTACTS_BACKUP_ENABLED } from '../../../../config/features';
import {
  validatePasswordStrength,
  validateBackupStructure,
  decryptMnemonic,
  decryptStringBlob,
  type PasswordStrength,
} from '../../../../services/backupEncryption';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';

// =============================================================================
// Component
// =============================================================================

export function GoogleDriveBackupScreen(): React.JSX.Element {
  const { getMnemonic, activeMasterKey, importMasterKey, masterKeys } = useWallet();
  const { selectWallet, getSessionPin } = useWalletAuth();
  const { themeMode } = useAppTheme();
  const { t } = useLanguage();

  // Get theme colors
  const gradientColors = getGradientColors(themeMode);
  const primaryText = getPrimaryTextColor(themeMode);
  const secondaryText = getSecondaryTextColor(themeMode);

  // State
  const [isLoading, setIsLoading] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [userInfo, setUserInfo] = useState<GoogleUser | null>(null);
  const [backups, setBackups] = useState<BackupMetadata[]>([]);
  const [lastBackupTimestamp, setLastBackupTimestamp] = useState<number | null>(null);
  const [localFingerprints, setLocalFingerprints] = useState<Record<string, string>>({});

  // Modal state
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [modalMode, setModalMode] = useState<'create' | 'restore'>('create');
  const [selectedBackup, setSelectedBackup] = useState<BackupMetadata | null>(null);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [passwordStrength, setPasswordStrength] = useState<PasswordStrength | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  // Whether to include the address book in this backup, and the contacts
  // pulled out of a restored backup awaiting a merge decision.
  const [includeContacts, setIncludeContacts] = useState(true);
  const [restoredContacts, setRestoredContacts] = useState<Contact[] | null>(null);

  // Restore flow: PIN setup after decryption
  const [restoredMnemonic, setRestoredMnemonic] = useState<string | null>(null);
  const [restoredWalletName, setRestoredWalletName] = useState<string | null>(null);
  const [showPinModal, setShowPinModal] = useState(false);
  const [restorePin, setRestorePin] = useState('');
  const [confirmRestorePin, setConfirmRestorePin] = useState('');
  const [isImporting, setIsImporting] = useState(false);

  // Backup flow: manual PIN entry fallback (when session + biometric storage are empty)
  const [backupPinPromptVisible, setBackupPinPromptVisible] = useState(false);
  const [backupManualPin, setBackupManualPin] = useState('');
  const [pendingBackupContext, setPendingBackupContext] = useState<{
    targetKeyId: string;
    password: string;
  } | null>(null);

  // ==========================================================================
  // Effects
  // ==========================================================================

  // Initialize service and check connection status
  useEffect(() => {
    initializeService();
  }, []);

  // Update password strength when password changes
  useEffect(() => {
    if (password) {
      setPasswordStrength(validatePasswordStrength(password));
    } else {
      setPasswordStrength(null);
    }
  }, [password]);

  // ==========================================================================
  // Service Initialization
  // ==========================================================================

  const initializeService = async (): Promise<void> => {
    setIsLoading(true);
    try {
      await googleDriveBackupService.initialize();
      // Silently restore a previously-connected Google session so the user
      // doesn't have to reconnect every time they open the backup menu.
      const connected = await googleDriveBackupService.restoreSession();
      setIsConnected(connected);

      if (connected) {
        const user = await googleDriveBackupService.getUserInfo();
        setUserInfo(user);
        await refreshBackups();
      }
    } catch (error) {
      console.error('Failed to initialize:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const refreshBackups = useCallback(async (): Promise<void> => {
    try {
      const backupList = await googleDriveBackupService.listBackups();
      setBackups(backupList);
      if (backupList.length > 0) {
        setLastBackupTimestamp(backupList[0].timestamp);
      }

      // Load wallet data fresh from storage to avoid stale masterKeys closure
      const storage = await storageService.loadMultiWalletStorage();
      const keys = storage?.masterKeys ?? [];
      const fingerprintPairs = await Promise.all(
        keys.map(async (key) => {
          const fingerprint = await googleDriveBackupService.getLocalFingerprint(key.id);
          return [key.id, fingerprint] as const;
        })
      );

      const nextLocalFingerprints: Record<string, string> = {};
      for (const [walletId, fingerprint] of fingerprintPairs) {
        if (fingerprint) {
          nextLocalFingerprints[walletId] = fingerprint;
        }
      }
      setLocalFingerprints(nextLocalFingerprints);
    } catch (error) {
      console.warn('⚠️ [GoogleDriveBackupScreen] Failed to refresh backups:', error);
    }
  }, []);

  // ==========================================================================
  // Authentication
  // ==========================================================================

  const handleConnect = async (): Promise<void> => {
    setIsLoading(true);
    try {
      const result = await googleDriveBackupService.signIn();
      if (result.success) {
        setIsConnected(true);
        const user = await googleDriveBackupService.getUserInfo();
        setUserInfo(user);
        await refreshBackups();
      } else {
        Alert.alert(t('common.error'), result.error || 'Failed to connect');
      }
    } catch (error) {
      Alert.alert(t('common.error'), 'Failed to connect to Google Drive');
    } finally {
      setIsLoading(false);
    }
  };

  const handleDisconnect = async (): Promise<void> => {
    Alert.alert(
      t('cloudBackup.disconnectTitle'),
      t('cloudBackup.disconnectMessage'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('cloudBackup.disconnect'),
          style: 'destructive',
          onPress: async () => {
            setIsLoading(true);
            try {
              await googleDriveBackupService.signOut();
              setIsConnected(false);
              setUserInfo(null);
              setBackups([]);
              setLastBackupTimestamp(null);
            } catch (error) {
              Alert.alert(t('common.error'), 'Failed to disconnect');
            } finally {
              setIsLoading(false);
            }
          },
        },
      ]
    );
  };

  // ==========================================================================
  // Biometric Authentication
  // ==========================================================================

  const authenticateUser = async (): Promise<boolean> => {
    try {
      // Check app-level biometric setting first
      const settings = await settingsService.getUserSettings();
      if (!settings.biometricEnabled) {
        return true; // Biometric disabled in app settings, skip
      }

      const biometricAvailable = await LocalAuthentication.hasHardwareAsync();
      const isEnrolled = await LocalAuthentication.isEnrolledAsync();

      if (biometricAvailable && isEnrolled) {
        const result = await LocalAuthentication.authenticateAsync({
          promptMessage: t('cloudBackup.authenticateToBackup'),
          fallbackLabel: t('settings.usePin'),
        });
        return result.success;
      }
      return true; // No biometric available, allow proceed
    } catch (error) {
      console.warn('[GoogleDriveBackup] Auth error:', error);
      return false;
    }
  };

  const authenticateSensitiveSeedAccess = useCallback(async (): Promise<boolean> => {
    try {
      // Only re-prompt for biometric if the user has enabled biometric in app
      // settings. Otherwise the seed access is already gated by the PIN they'll
      // use to decrypt the mnemonic, and an unconditional OS prompt here is
      // both redundant and confusing (the user never opted into biometric).
      const settings = await settingsService.getUserSettings();
      if (!settings.biometricEnabled) {
        return true;
      }

      const biometricAvailable = await LocalAuthentication.hasHardwareAsync();
      const isEnrolled = await LocalAuthentication.isEnrolledAsync();

      if (!biometricAvailable || !isEnrolled) {
        return true;
      }

      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: t('cloudBackup.authenticateToBackup'),
        fallbackLabel: t('settings.usePin'),
      });

      return result.success;
    } catch (error) {
      console.warn('[GoogleDriveBackup] Sensitive auth error:', error);
      return false;
    }
  }, [t]);

  // ==========================================================================
  // Backup Operations
  // ==========================================================================

  // Which master key to back up
  const [selectedMasterKeyId, setSelectedMasterKeyId] = useState<string | null>(null);

  const getSelectedMasterKey = () => {
    if (selectedMasterKeyId) {
      return masterKeys.find((k) => k.id === selectedMasterKeyId) || activeMasterKey;
    }
    return activeMasterKey;
  };

  const getWalletBackupById = useCallback((walletId: string): BackupMetadata | undefined => {
    const fingerprint = localFingerprints[walletId];
    if (!fingerprint) return undefined;
    return backups.find((backup) => backup.seedFingerprint === fingerprint);
  }, [backups, localFingerprints]);

  const handleCreateBackup = async (masterKeyId?: string): Promise<void> => {
    const targetId = masterKeyId || activeMasterKey?.id;

    if (!targetId) {
      Alert.alert(t('common.error'), 'No wallet found');
      return;
    }

    setSelectedMasterKeyId(targetId);

    // Authenticate first
    const authenticated = await authenticateUser();
    if (!authenticated) {
      return;
    }

    // Show password modal
    setModalMode('create');
    setPassword('');
    setConfirmPassword('');
    setShowPasswordModal(true);
  };

  // Resolve the PIN needed to decrypt the master seed for backup.
  // Priority (each step is silent when it works):
  //   1. Session PIN — already in memory from the active unlock. We try this
  //      FIRST regardless of which wallet is active; in the common case where
  //      the user reuses the same PIN across their wallets, this is a silent
  //      hit and skips the prompt entirely. If the wrong PIN is returned,
  //      performBackup's decrypt attempt surfaces the mismatch and we fall
  //      back to the manual prompt.
  //   2. Biometric-stored PIN — only populated if the user opted into
  //      biometric unlock for this specific master key.
  //   3. null → caller should prompt the user to enter their PIN manually.
  const resolveBackupPin = useCallback(
    async (_targetKeyId: string): Promise<string | null> => {
      const sessionPin = getSessionPin();
      if (sessionPin) return sessionPin;
      try {
        const biometricPin = await storageService.getBiometricPin(_targetKeyId);
        if (biometricPin) return biometricPin;
      } catch {
        // Ignore — fall through to manual entry.
      }
      return null;
    },
    [getSessionPin]
  );

  // Performs the actual backup once we have a PIN. Split out so it can be
  // called from both the happy path (session/biometric) and the manual PIN
  // prompt fallback.
  const performBackup = useCallback(
    async (targetKeyId: string, backupPassword: string, pin: string): Promise<void> => {
      const targetKey = masterKeys.find((k) => k.id === targetKeyId);
      if (!targetKey) {
        Alert.alert(t('common.error'), 'No wallet found');
        return;
      }

      setIsProcessing(true);
      try {
        // Decrypt the master seed with the resolved PIN. A wrong PIN surfaces
        // here and gives the user a chance to re-enter.
        let mnemonic: string;
        try {
          mnemonic = await getMnemonic(targetKeyId, pin);
        } catch {
          Alert.alert(t('common.error'), 'Incorrect PIN');
          // Re-open manual prompt so the user can try again.
          setPendingBackupContext({ targetKeyId, password: backupPassword });
          setBackupManualPin('');
          setBackupPinPromptVisible(true);
          return;
        }
        if (!mnemonic) {
          Alert.alert(t('common.error'), 'Could not retrieve seed phrase');
          return;
        }

        // Optionally bundle the address book (encrypted with the same password).
        // Gated off for now — the feature stays in code but ships disabled.
        let contactsToBackup: Contact[] | undefined;
        if (CONTACTS_BACKUP_ENABLED && includeContacts) {
          try {
            contactsToBackup = await contactService.getAllContacts();
          } catch (contactsErr) {
            console.warn('⚠️ [GoogleDriveBackupScreen] Could not load contacts for backup:', contactsErr);
          }
        }

        const result = await googleDriveBackupService.createBackup(
          mnemonic,
          backupPassword,
          targetKey.id,
          targetKey.nickname,
          { contacts: contactsToBackup }
        );

        if (result.success) {
          Alert.alert(t('common.success'), t('cloudBackup.backupCreated'));
          setShowPasswordModal(false);
          setPassword('');
          setConfirmPassword('');

          const mnemonicFingerprint = await googleDriveBackupService.getSeedFingerprint(mnemonic);
          await googleDriveBackupService.saveLocalFingerprint(targetKey.id, mnemonicFingerprint);

          await refreshBackups();
        } else {
          Alert.alert(t('common.error'), result.error || 'Failed to create backup');
        }
      } catch (error) {
        console.warn('⚠️ [GoogleDriveBackupScreen] Failed to create backup:', error);
        Alert.alert(t('common.error'), 'Failed to create backup');
      } finally {
        setIsProcessing(false);
      }
    },
    [masterKeys, getMnemonic, includeContacts, t]
  );

  const handleConfirmCreateBackup = async (): Promise<void> => {
    const targetKey = getSelectedMasterKey();
    if (!targetKey) return;

    // Validate password
    if (!passwordStrength?.isValid) {
      Alert.alert(t('common.error'), t('cloudBackup.passwordTooWeak'));
      return;
    }

    if (password !== confirmPassword) {
      Alert.alert(t('common.error'), t('cloudBackup.passwordMismatch'));
      return;
    }

    // Gate sensitive seed access on biometric (only if user enabled it).
    const sensitiveAuthOk = await authenticateSensitiveSeedAccess();
    if (!sensitiveAuthOk) {
      Alert.alert(t('common.error'), t('cloudBackup.authenticateToBackup'));
      return;
    }

    // Try to resolve the PIN silently. If neither the session nor biometric
    // storage has it (common right after an import, before biometric is
    // enabled), fall back to asking the user to enter their PIN.
    const pin = await resolveBackupPin(targetKey.id);
    if (!pin) {
      setPendingBackupContext({ targetKeyId: targetKey.id, password });
      setBackupManualPin('');
      setBackupPinPromptVisible(true);
      return;
    }

    await performBackup(targetKey.id, password, pin);
  };

  const handleBackupPinSubmit = useCallback(async (): Promise<void> => {
    if (!pendingBackupContext) {
      setBackupPinPromptVisible(false);
      return;
    }
    if (backupManualPin.length !== WALLET_PIN_LENGTH) {
      Alert.alert(t('common.error'), `PIN must be ${WALLET_PIN_LENGTH} digits`);
      return;
    }
    const { targetKeyId, password: backupPassword } = pendingBackupContext;
    setBackupPinPromptVisible(false);
    setPendingBackupContext(null);
    const pin = backupManualPin;
    setBackupManualPin('');
    await performBackup(targetKeyId, backupPassword, pin);
  }, [pendingBackupContext, backupManualPin, performBackup, t]);

  const handleBackupPinCancel = useCallback((): void => {
    setBackupPinPromptVisible(false);
    setPendingBackupContext(null);
    setBackupManualPin('');
  }, []);

  const handleRestoreBackup = (backup: BackupMetadata): void => {
    setSelectedBackup(backup);
    setModalMode('restore');
    setPassword('');
    setShowPasswordModal(true);
  };

  const handleConfirmRestore = async (): Promise<void> => {
    if (!selectedBackup) return;

    setIsProcessing(true);
    try {
      const result = await googleDriveBackupService.restoreBackup(
        selectedBackup.id,
        password
      );

      if (result.success && result.mnemonic) {
        setShowPasswordModal(false);
        setPassword('');
        setRestoredMnemonic(result.mnemonic);
        setRestoredWalletName(result.walletName || null);
        // Hold any contacts found in the backup until after the wallet import,
        // then offer to merge them (see handleConfirmImport).
        setRestoredContacts(result.contacts && result.contacts.length > 0 ? result.contacts : null);
        setRestorePin('');
        setConfirmRestorePin('');
        setShowPinModal(true);
      } else {
        const errorMsg = result.error || 'Failed to restore backup';
        const isPasswordError = errorMsg.toLowerCase().includes('password') || errorMsg.toLowerCase().includes('decrypt');
        Alert.alert(
          t('common.error'),
          isPasswordError ? 'Incorrect password. Please try again.' : errorMsg
        );
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Failed to restore backup';
      const isPasswordError = msg.toLowerCase().includes('password') || msg.toLowerCase().includes('decrypt');
      Alert.alert(
        t('common.error'),
        isPasswordError ? 'Incorrect password. Please try again.' : msg
      );
    } finally {
      setIsProcessing(false);
    }
  };

  // File-based restore flow state
  const [fileBackupData, setFileBackupData] = useState<unknown>(null);

  const handleRestoreFromFile = async (): Promise<void> => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: 'application/json',
        copyToCacheDirectory: true,
      });

      if (result.canceled || !result.assets || result.assets.length === 0) {
        return;
      }

      const fileUri = result.assets[0].uri;
      const content = await FileSystem.readAsStringAsync(fileUri);
      let parsed: unknown;
      try {
        parsed = JSON.parse(content);
      } catch {
        Alert.alert(t('common.error'), 'Invalid file format. Please select a valid backup JSON file.');
        return;
      }

      if (!validateBackupStructure(parsed)) {
        Alert.alert(t('common.error'), 'This file is not a valid ZapArc backup. Please select a backup file created by ZapArc.');
        return;
      }

      // Store backup data and show password modal
      setFileBackupData(parsed);
      setModalMode('restore');
      setSelectedBackup(null);
      setPassword('');
      setShowPasswordModal(true);
    } catch (error) {
      console.error('❌ [RestoreFromFile] Failed:', error);
      Alert.alert(t('common.error'), 'Failed to read backup file.');
    }
  };

  const handleConfirmFileRestore = async (): Promise<void> => {
    if (!fileBackupData) return;

    setIsProcessing(true);
    try {
      const mnemonic = await decryptMnemonic(fileBackupData as any, password);

      // Decrypt the optional contacts section (non-fatal on failure).
      let fileContacts: Contact[] | null = null;
      const contactsBlob = (fileBackupData as any).contacts;
      if (contactsBlob) {
        try {
          const json = await decryptStringBlob(contactsBlob, password);
          const parsed = JSON.parse(json);
          if (Array.isArray(parsed) && parsed.length > 0) fileContacts = parsed as Contact[];
        } catch (contactsErr) {
          console.warn('⚠️ [Restore] Could not decrypt contacts from file:', contactsErr);
        }
      }

      setShowPasswordModal(false);
      setPassword('');
      setFileBackupData(null);
      setRestoredMnemonic(mnemonic);
      setRestoredWalletName((fileBackupData as any).walletName || null);
      setRestoredContacts(fileContacts);
      setRestorePin('');
      setConfirmRestorePin('');
      setShowPinModal(true);
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Failed to decrypt backup';
      const isPasswordError = msg.toLowerCase().includes('password') || msg.toLowerCase().includes('decrypt');
      Alert.alert(
        t('common.error'),
        isPasswordError ? 'Incorrect password. Please try again.' : msg
      );
    } finally {
      setIsProcessing(false);
    }
  };

  // Ask whether to merge contacts found in a restored backup. Dedup is by
  // lightning address (existing wins), so it's safe and idempotent. `done`
  // runs after the user's choice (used to continue navigation either way).
  const promptMergeContacts = useCallback(
    (contacts: Contact[], done: () => void): void => {
      Alert.alert(
        t('cloudBackup.mergeContactsTitle'),
        t('cloudBackup.mergeContactsBody').replace('{{count}}', String(contacts.length)),
        [
          { text: t('cloudBackup.mergeContactsSkip'), style: 'cancel', onPress: done },
          {
            text: t('cloudBackup.mergeContactsConfirm'),
            onPress: async () => {
              try {
                const { added, skipped } = await contactService.mergeImportedContacts(contacts);
                await refreshContactsStore();
                Alert.alert(
                  t('common.success'),
                  t('cloudBackup.mergeContactsResult')
                    .replace('{{added}}', String(added))
                    .replace('{{skipped}}', String(skipped))
                );
              } catch (mergeErr) {
                console.warn('⚠️ [Restore] Contact merge failed:', mergeErr);
              } finally {
                done();
              }
            },
          },
        ]
      );
    },
    [t]
  );

  const handleConfirmImport = async (pinFromKeypad: string): Promise<void> => {
    if (!restoredMnemonic) return;

    if (pinFromKeypad.length !== WALLET_PIN_LENGTH) {
      Alert.alert(t('common.error'), `PIN must be exactly ${WALLET_PIN_LENGTH} digits`);
      return;
    }

    setIsImporting(true);
    try {
      const nickname = restoredWalletName || generateMasterKeyNickname(masterKeys.length + 1);
      console.log('🔄 [Restore] Importing wallet...', { nickname });
      const masterKeyId = await importMasterKey(restoredMnemonic, pinFromKeypad, nickname);
      console.log('✅ [Restore] Wallet imported:', masterKeyId);

      // Make the newly restored wallet the active one. This matters most for
      // Flow B (restore from settings while another wallet is already active)
      // but is also safe for Flow A (first install).
      try {
        await selectWallet(masterKeyId, 0, pinFromKeypad);
      } catch (selectError) {
        console.warn('⚠️ [Restore] selectWallet failed (non-fatal):', selectError);
      }

      // Clear modal + state; biometric/notification onboarding is deferred
      // to a dismissable banner on the wallet home screen.
      setShowPinModal(false);
      setRestoredMnemonic(null);
      setRestorePin('');
      setConfirmRestorePin('');

      // If the backup carried contacts, offer to merge them before leaving.
      // Gated off for now along with the rest of the contacts-backup feature.
      const contactsToMerge = restoredContacts;
      setRestoredContacts(null);
      if (CONTACTS_BACKUP_ENABLED && contactsToMerge && contactsToMerge.length > 0) {
        promptMergeContacts(contactsToMerge, () => router.replace('/wallet/home'));
        return;
      }

      // Skip unlock screen — user literally just set this PIN.
      router.replace('/wallet/home');
    } catch (error) {
      console.error('❌ [Restore] Import failed:', error);
      const message = error instanceof Error ? error.message : 'Failed to import wallet';
      Alert.alert(t('common.error'), message);
    } finally {
      setIsImporting(false);
    }
  };

  const handleDeleteBackup = (backup: BackupMetadata): void => {
    Alert.alert(
      t('cloudBackup.deleteBackup'),
      t('cloudBackup.deleteConfirmation'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.delete'),
          style: 'destructive',
          onPress: async () => {
            setIsLoading(true);
            try {
              const result = await googleDriveBackupService.deleteBackup(backup.id);
              if (result.success) {
                await refreshBackups();
              } else {
                Alert.alert(t('common.error'), result.error || 'Failed to delete');
              }
            } catch {
              Alert.alert(t('common.error'), 'Failed to delete backup');
            } finally {
              setIsLoading(false);
            }
          },
        },
      ]
    );
  };

  // ==========================================================================
  // Helpers
  // ==========================================================================

  const formatDate = (timestamp: number): string => {
    return new Date(timestamp).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const getStrengthColor = (score: number): string => {
    const colors = ['#ff4444', '#ff8800', '#ffcc00', '#88cc00', '#00cc44'];
    return colors[score] || colors[0];
  };

  // ==========================================================================
  // Render
  // ==========================================================================

  const getWalletLabel = (walletId: string): string => {
    const wallet = (masterKeys || []).find((key) => key.id === walletId);
    return wallet?.nickname || wallet?.id.substring(0, 8) || walletId.substring(0, 8);
  };

  const renderPasswordModal = (): React.JSX.Element => (
    <Modal
      visible={showPasswordModal}
      transparent
      animationType="slide"
      onRequestClose={() => {
        setShowPasswordModal(false);
        setPassword('');
        setConfirmPassword('');
        setFileBackupData(null);
      }}
    >
      <KeyboardAvoidingView
        style={styles.modalOverlay}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={[styles.modalContent, { backgroundColor: gradientColors[0] }]}>
          <ScrollView
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.modalScrollContent}
          >
          <Text style={[styles.modalTitle, { color: primaryText }]}>
            {modalMode === 'create'
              ? t('cloudBackup.enterBackupPassword')
              : t('cloudBackup.enterRestorePassword')}
          </Text>

          {modalMode === 'create' && (
            <View style={styles.warningBanner}>
              <Text style={styles.warningIcon}>⚠️</Text>
              <Text style={[styles.warningText, { color: secondaryText }]}>
                {t('cloudBackup.passwordWarning')}
              </Text>
            </View>
          )}

          <StyledTextInput
            label={t('cloudBackup.password')}
            value={password}
            onChangeText={setPassword}
            secureTextEntry={!showPassword}
            inputAccessoryViewID={keyboardDoneAccessoryId}
            style={styles.input}
            right={
              <TextInput.Icon
                icon={showPassword ? 'eye-off' : 'eye'}
                onPress={() => setShowPassword(!showPassword)}
              />
            }
          />

          {modalMode === 'create' && (
            <>
              {passwordStrength && (
                <View style={styles.strengthContainer}>
                  <ProgressBar
                    progress={(passwordStrength.score + 1) / 5}
                    color={getStrengthColor(passwordStrength.score)}
                    style={styles.strengthBar}
                  />
                  <Text
                    style={[
                      styles.strengthLabel,
                      { color: getStrengthColor(passwordStrength.score) },
                    ]}
                  >
                    {t(`cloudBackup.strength.${passwordStrength.label}`)}
                  </Text>
                </View>
              )}

              {passwordStrength && passwordStrength.feedback.length > 0 && (
                <View style={styles.feedbackContainer}>
                  {passwordStrength.feedback.map((feedback, index) => (
                    <Text
                      key={index}
                      style={[styles.feedbackText, { color: secondaryText }]}
                    >
                      • {feedback}
                    </Text>
                  ))}
                </View>
              )}

              <StyledTextInput
                label={t('cloudBackup.confirmPassword')}
                value={confirmPassword}
                onChangeText={setConfirmPassword}
                secureTextEntry={!showPassword}
                inputAccessoryViewID={keyboardDoneAccessoryId}
                style={styles.input}
              />

              {/* Optional: include the address book in this backup.
                  Hidden behind CONTACTS_BACKUP_ENABLED until we ship it. */}
              {CONTACTS_BACKUP_ENABLED && (
              <TouchableOpacity
                style={styles.includeContactsRow}
                activeOpacity={0.7}
                onPress={() => setIncludeContacts((v) => !v)}
              >
                <View style={styles.includeContactsText}>
                  <Text style={[styles.includeContactsTitle, { color: primaryText }]}>
                    {t('cloudBackup.includeContacts')}
                  </Text>
                  <Text style={[styles.includeContactsHint, { color: secondaryText }]}>
                    {t('cloudBackup.includeContactsHint')}
                  </Text>
                </View>
                <Switch
                  value={includeContacts}
                  onValueChange={setIncludeContacts}
                  color={BRAND_COLOR}
                />
              </TouchableOpacity>
              )}
            </>
          )}
          </ScrollView>

          <View style={styles.modalButtons}>
            <Button
              mode="outlined"
              onPress={() => {
                setShowPasswordModal(false);
                setPassword('');
                setConfirmPassword('');
                setFileBackupData(null);
              }}
              style={styles.modalButton}
              textColor={secondaryText}
            >
              {t('common.cancel')}
            </Button>
            <Button
              mode="contained"
              onPress={
                modalMode === 'create'
                  ? handleConfirmCreateBackup
                  : fileBackupData
                    ? handleConfirmFileRestore
                    : handleConfirmRestore
              }
              loading={isProcessing}
              disabled={
                isProcessing ||
                !password ||
                (modalMode === 'create' && !confirmPassword)
              }
              style={[styles.modalButton, { backgroundColor: BRAND_COLOR }]}
              labelStyle={{ color: '#1a1a2e' }}
            >
              {modalMode === 'create' ? t('cloudBackup.createBackup') : t('cloudBackup.restore')}
            </Button>
          </View>
        </View>
      </KeyboardAvoidingView>
      <KeyboardDoneAccessory />
    </Modal>
  );

  const renderPinModal = (): React.JSX.Element => (
    <Modal
      visible={showPinModal}
      transparent
      animationType="slide"
      onRequestClose={() => {
        if (isImporting) return;
        setShowPinModal(false);
        setRestoredMnemonic(null);
      }}
    >
      <View style={styles.modalOverlay}>
        <View style={[styles.modalContent, { backgroundColor: gradientColors[0] }]}>
          <PinSetupKeypad
            primaryText={primaryText}
            secondaryText={secondaryText}
            isProcessing={isImporting}
            processingLabel="Restoring wallet…"
            enterLabel="Create a wallet PIN"
            confirmLabel="Confirm PIN"
            cancelLabel={t('common.cancel')}
            onCancel={() => {
              setShowPinModal(false);
              setRestoredMnemonic(null);
            }}
            onComplete={(pin) => {
              void handleConfirmImport(pin);
            }}
          />
        </View>
      </View>
    </Modal>
  );

  return (
    <LinearGradient colors={gradientColors} style={styles.gradient}>
      <SafeAreaView style={styles.container}>
        {/* Header */}
        <View style={styles.header}>
          <IconButton
            icon="arrow-left"
            iconColor={primaryText}
            size={24}
            onPress={() => router.back()}
          />
          <Text style={[styles.headerTitle, { color: primaryText }]}>
            {t('cloudBackup.title')}
          </Text>
          <View style={styles.headerSpacer} />
        </View>

        <ScrollView style={styles.scrollView}>
          <View style={styles.content}>
            {/* Warning Banner */}
            <View style={styles.securityBanner}>
              <Text style={styles.securityIcon}>🔐</Text>
              <Text style={[styles.securityTitle, { color: primaryText }]}>
                {t('cloudBackup.encryptedBackup')}
              </Text>
              <Text style={[styles.securityText, { color: secondaryText }]}>
                {t('cloudBackup.securityInfo')}
              </Text>
            </View>

            {/* Google Account Section */}
            <View style={styles.section}>
              <Text style={[styles.sectionTitle, { color: primaryText }]}>
                {t('cloudBackup.googleAccount')}
              </Text>

              {isLoading ? (
                <ActivityIndicator color={BRAND_COLOR} style={styles.loader} />
              ) : isConnected && userInfo ? (
                <View style={styles.accountRow}>
                  <View style={styles.accountInfo}>
                    <Text style={[styles.accountEmail, { color: primaryText }]}>
                      {userInfo.email}
                    </Text>
                    <Text style={[styles.accountStatus, { color: '#4CAF50' }]}>
                      {t('cloudBackup.connected')}
                    </Text>
                  </View>
                  <Button
                    mode="outlined"
                    onPress={handleDisconnect}
                    textColor="#ff5252"
                    style={styles.disconnectButton}
                  >
                    {t('cloudBackup.disconnect')}
                  </Button>
                </View>
              ) : (
                <Button
                  mode="contained"
                  onPress={handleConnect}
                  icon="google"
                  style={[styles.connectButton, { backgroundColor: BRAND_COLOR }]}
                  labelStyle={{ color: '#1a1a2e' }}
                >
                  {t('cloudBackup.connectGoogle')}
                </Button>
              )}
            </View>

            {/* Your Wallets */}
            {isConnected && (
              <>
                <View style={styles.section}>
                  <Text style={[styles.sectionTitle, { color: primaryText }]}>
                    Your Wallets
                  </Text>

                  {(masterKeys || []).length === 0 ? (
                    <Text style={[styles.noBackups, { color: secondaryText }]}>
                      No wallets found
                    </Text>
                  ) : (
                    (masterKeys || []).map((key) => {
                      const matchedBackup = getWalletBackupById(key.id);
                      const isActive = activeMasterKey?.id === key.id;
                      return (
                        <View key={key.id} style={[styles.walletCard, { borderColor: isActive ? BRAND_COLOR : 'rgba(255, 255, 255, 0.1)' }]}>
                          <View style={styles.walletCardHeader}>
                            <View style={styles.walletCardNameRow}>
                              <Text style={[styles.backupWalletName, { color: primaryText }]}>
                                {key.nickname || key.id.substring(0, 8)}
                              </Text>
                              {isActive && (
                                <View style={[styles.activeBadge, { backgroundColor: BRAND_COLOR }]}>
                                  <Text style={styles.activeBadgeText}>Active</Text>
                                </View>
                              )}
                            </View>
                            {matchedBackup ? (
                              <View style={styles.backupStatusRow}>
                                <Text style={[styles.walletStatusText, { color: '#4CAF50' }]}>
                                  ✅ Backed up
                                </Text>
                                <Text style={[styles.backupDate, { color: secondaryText }]}>
                                  {formatDate(matchedBackup.timestamp)}
                                </Text>
                              </View>
                            ) : (
                              <Text style={[styles.walletStatusText, { color: '#ffb74d' }]}>
                                ⚠️ Not backed up
                              </Text>
                            )}
                          </View>
                          <View style={styles.walletActionRow}>
                            <Button
                              mode={matchedBackup ? 'outlined' : 'contained'}
                              onPress={() => handleCreateBackup(key.id)}
                              icon={matchedBackup ? 'cloud-sync' : 'cloud-upload'}
                              compact
                              style={matchedBackup ? [styles.walletActionBtn, { borderColor: BRAND_COLOR, flex: 1 }] : [styles.walletActionBtn, { backgroundColor: BRAND_COLOR, flex: 1 }]}
                              textColor={matchedBackup ? BRAND_COLOR : '#1a1a2e'}
                              labelStyle={matchedBackup ? undefined : { color: '#1a1a2e' }}
                            >
                              {matchedBackup ? 'Update Backup' : 'Back Up Now'}
                            </Button>
                            {matchedBackup && (
                              <Button
                                mode="outlined"
                                onPress={() => handleDeleteBackup(matchedBackup)}
                                icon="delete-outline"
                                compact
                                style={[styles.walletActionBtn, { borderColor: '#ef5350', marginLeft: 8 }]}
                                textColor="#ef5350"
                              >
                                Delete
                              </Button>
                            )}
                          </View>
                        </View>
                      );
                    })
                  )}
                </View>

                {/* Cloud Backups (orphaned — not linked to any local wallet) */}
                {(() => {
                  const linkedFingerprints = new Set(Object.values(localFingerprints));
                  const orphanedBackups = backups.filter(
                    (b) => !b.seedFingerprint || !linkedFingerprints.has(b.seedFingerprint)
                  );
                  if (orphanedBackups.length === 0) return null;
                  return (
                    <View style={styles.section}>
                      <Text style={[styles.sectionTitle, { color: primaryText }]}>
                        Cloud Backups
                      </Text>
                      <Text style={[styles.sectionSubtitle, { color: secondaryText }]}>
                        These backups aren't linked to any wallet on this device
                      </Text>

                      {orphanedBackups.map((backup) => (
                        <View key={backup.id} style={styles.backupItem}>
                          <View style={styles.backupInfo}>
                            <Text style={[styles.backupWalletName, { color: primaryText }]}>
                              {backup.walletName || 'Unknown Wallet'}
                            </Text>
                            <Text style={[styles.backupDate, { color: secondaryText }]}>
                              {formatDate(backup.timestamp)}
                            </Text>
                          </View>
                          <View style={styles.backupActions}>
                            <TouchableOpacity
                              onPress={() => handleRestoreBackup(backup)}
                              style={styles.backupActionButton}
                            >
                              <IconButton
                                icon="download"
                                iconColor={BRAND_COLOR}
                                size={20}
                              />
                            </TouchableOpacity>
                            <TouchableOpacity
                              onPress={() => handleDeleteBackup(backup)}
                              style={styles.backupActionButton}
                            >
                              <IconButton
                                icon="delete"
                                iconColor="#ff5252"
                                size={20}
                              />
                            </TouchableOpacity>
                          </View>
                        </View>
                      ))}
                    </View>
                  );
                })()}
              </>
            )}

            {/* Restore from File */}
            <View style={styles.section}>
              <Text style={[styles.sectionTitle, { color: primaryText }]}>
                Restore from File
              </Text>
              <Text style={[styles.sectionSubtitle, { color: secondaryText }]}>
                Restore a wallet from a backup file saved on your device
              </Text>
              <Button
                mode="outlined"
                onPress={handleRestoreFromFile}
                icon="file-upload"
                style={[styles.actionButton, { borderColor: BRAND_COLOR }]}
                textColor={BRAND_COLOR}
              >
                Choose Backup File
              </Button>
            </View>

            {/* Security Tips */}
            <View style={styles.tipsSection}>
              <Text style={[styles.tipsTitle, { color: primaryText }]}>
                {t('cloudBackup.securityTips')}
              </Text>

              <View style={styles.tipItem}>
                <Text style={styles.tipIcon}>✅</Text>
                <Text style={[styles.tipText, { color: secondaryText }]}>
                  {t('cloudBackup.tip1')}
                </Text>
              </View>

              <View style={styles.tipItem}>
                <Text style={styles.tipIcon}>✅</Text>
                <Text style={[styles.tipText, { color: secondaryText }]}>
                  {t('cloudBackup.tip2')}
                </Text>
              </View>

              <View style={styles.tipItem}>
                <Text style={styles.tipIcon}>❌</Text>
                <Text style={[styles.tipText, { color: secondaryText }]}>
                  {t('cloudBackup.tip3')}
                </Text>
              </View>
            </View>
          </View>
        </ScrollView>

        {renderPasswordModal()}
        {renderPinModal()}
        {renderBackupPinPromptModal()}
      </SafeAreaView>
    </LinearGradient>
  );

  function renderBackupPinPromptModal(): React.JSX.Element {
    return (
      <Modal visible={backupPinPromptVisible} transparent animationType="fade">
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.modalOverlay}
        >
          <View style={[styles.modalContent, { backgroundColor: gradientColors[0] }]}>
            <Text style={[styles.modalTitle, { color: primaryText }]}>
              Enter your wallet PIN
            </Text>
            <Text style={[styles.modalDescription, { color: secondaryText }]}>
              We need your PIN to unlock the seed phrase for backup. It never leaves this device.
            </Text>
            <StyledTextInput
              value={backupManualPin}
              onChangeText={(text) =>
                setBackupManualPin(text.replace(/[^0-9]/g, '').slice(0, WALLET_PIN_LENGTH))
              }
              keyboardType="numeric"
              secureTextEntry
              maxLength={WALLET_PIN_LENGTH}
              placeholder={`Enter ${WALLET_PIN_LENGTH}-digit PIN`}
              style={styles.input}
              autoFocus
            />
            <View style={styles.modalActions}>
              <Button
                mode="outlined"
                onPress={handleBackupPinCancel}
                style={styles.modalButton}
                disabled={isProcessing}
              >
                {t('common.cancel')}
              </Button>
              <Button
                mode="contained"
                onPress={handleBackupPinSubmit}
                disabled={isProcessing || backupManualPin.length !== WALLET_PIN_LENGTH}
                style={[styles.modalButton, { backgroundColor: BRAND_COLOR }]}
                labelStyle={{ color: '#1a1a2e' }}
              >
                {t('common.confirm')}
              </Button>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    );
  }
}

// =============================================================================
// Styles
// =============================================================================

const styles = StyleSheet.create({
  gradient: {
    flex: 1,
  },
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
    paddingVertical: 8,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: 'bold',
  },
  headerSpacer: {
    width: 48,
  },
  scrollView: {
    flex: 1,
  },
  content: {
    padding: 16,
  },
  securityBanner: {
    backgroundColor: 'rgba(76, 175, 80, 0.15)',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    alignItems: 'center',
  },
  securityIcon: {
    fontSize: 32,
    marginBottom: 8,
  },
  securityTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  securityText: {
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 20,
  },
  section: {
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 12,
  },
  loader: {
    paddingVertical: 20,
  },
  accountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  accountInfo: {
    flex: 1,
  },
  accountEmail: {
    fontSize: 14,
    fontWeight: '500',
  },
  accountStatus: {
    fontSize: 12,
    marginTop: 2,
  },
  disconnectButton: {
    borderColor: '#ff5252',
  },
  connectButton: {
    marginTop: 8,
  },
  lastBackup: {
    fontSize: 13,
    marginBottom: 12,
  },
  actionButton: {
    marginTop: 8,
    marginBottom: 8,
  },
  walletCard: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    marginBottom: 12,
  },
  walletCardHeader: {
    marginBottom: 10,
  },
  walletCardNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  activeBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  activeBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#1a1a2e',
  },
  backupStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  walletActionRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  walletActionBtn: {
    borderRadius: 8,
  },
  walletStatusText: {
    fontSize: 12,
    marginTop: 2,
  },
  sectionSubtitle: {
    fontSize: 13,
    marginBottom: 12,
    marginTop: -4,
  },
  noBackups: {
    fontSize: 14,
    textAlign: 'center',
    paddingVertical: 16,
  },
  backupItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.1)',
  },
  backupInfo: {
    flex: 1,
  },
  backupWalletName: {
    fontSize: 15,
    fontWeight: '600',
  },
  backupDate: {
    fontSize: 12,
    marginTop: 2,
  },
  backupWallet: {
    fontSize: 12,
    marginTop: 2,
  },
  backupActions: {
    flexDirection: 'row',
  },
  backupActionButton: {
    marginLeft: 4,
  },
  tipsSection: {
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
  },
  tipsTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 16,
  },
  tipItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 12,
    gap: 12,
  },
  tipIcon: {
    fontSize: 16,
  },
  tipText: {
    flex: 1,
    fontSize: 14,
    lineHeight: 20,
  },
  // Modal styles
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'center',
    padding: 20,
  },
  modalContent: {
    borderRadius: 16,
    padding: 20,
    // Bound the height so the inner ScrollView can scroll when the keyboard is
    // up, and so a growing password-strength hint scrolls instead of resizing
    // (and re-centering) the whole modal — which read as flashing.
    maxHeight: '85%',
  },
  modalScrollContent: {
    paddingBottom: 4,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: 16,
  },
  warningBanner: {
    backgroundColor: 'rgba(255, 152, 0, 0.2)',
    borderRadius: 8,
    padding: 12,
    marginBottom: 16,
    flexDirection: 'row',
    alignItems: 'center',
  },
  warningIcon: {
    fontSize: 20,
    marginRight: 12,
  },
  warningText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 18,
  },
  input: {
    marginBottom: 12,
    backgroundColor: 'transparent',
  },
  includeContactsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 4,
    marginBottom: 8,
  },
  includeContactsText: {
    flex: 1,
    paddingRight: 12,
  },
  includeContactsTitle: {
    fontSize: 15,
    fontWeight: '600',
  },
  includeContactsHint: {
    fontSize: 12,
    marginTop: 2,
  },
  strengthContainer: {
    marginBottom: 12,
  },
  strengthBar: {
    height: 4,
    borderRadius: 2,
  },
  strengthLabel: {
    fontSize: 12,
    marginTop: 4,
    textAlign: 'right',
  },
  feedbackContainer: {
    marginBottom: 12,
  },
  feedbackText: {
    fontSize: 12,
    lineHeight: 18,
  },
  modalButtons: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
    marginTop: 16,
  },
  modalButton: {
    flex: 1,
  },
  modalDescription: {
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 16,
    textAlign: 'center',
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
    marginTop: 8,
  },
  restoreHint: {
    fontSize: 13,
    textAlign: 'center',
    marginBottom: 16,
  },
  doneButton: {
    marginTop: 8,
  },
});
