// Wallet Import Screen
// Import existing wallet using 12 or 24-word mnemonic phrase

import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TouchableWithoutFeedback,
  Keyboard,
} from 'react-native';
import { useKeyboardAwareScroll } from '../../../hooks/useKeyboardAwareScroll';
import { Button, Text, ProgressBar } from 'react-native-paper';
import { StyledTextInput, PinSetupKeypad } from '../../../components';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import {
  validateMnemonicForImport,
  normalizeMnemonic,
  getWordCount,
  generateMasterKeyNickname,
} from '../../../utils/mnemonic';
import { useWallet } from '../../../hooks/useWallet';
import { useWalletAuth } from '../../../hooks/useWalletAuth';
import { useAppTheme } from '../../../contexts/ThemeContext';
import { getGradientColors, getPrimaryTextColor, getSecondaryTextColor, BRAND_COLOR } from '../../../utils/theme-helpers';
import { createSafeBackHandler } from '../utils/safeBack';

// =============================================================================
// Types
// =============================================================================

type ImportStep = 'input' | 'pin';

// =============================================================================
// Component
// =============================================================================

export function WalletImportScreen(): React.JSX.Element {
  const safeBack = useMemo(() => createSafeBackHandler({ canGoBack: () => router.canGoBack(), back: () => router.back(), replace: (route) => router.replace(route) }, '/wallet/home'), []);
  const { importMasterKey, masterKeys } = useWallet();
  const { selectWallet } = useWalletAuth();
  const { themeMode } = useAppTheme();

  // Theme colors
  const gradientColors = getGradientColors(themeMode);
  const primaryText = getPrimaryTextColor(themeMode);
  const secondaryText = getSecondaryTextColor(themeMode);

  // State
  const [currentStep, setCurrentStep] = useState<ImportStep>('input');
  const [mnemonic, setMnemonic] = useState('');
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [walletName, setWalletName] = useState(generateMasterKeyNickname(masterKeys.length + 1));
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Progress calculation
  const progress = useMemo(() => {
    const steps: ImportStep[] = ['input', 'pin'];
    return (steps.indexOf(currentStep) + 1) / steps.length;
  }, [currentStep]);

  // Mnemonic validation
  const mnemonicValidation = useMemo(() => {
    return validateMnemonicForImport(mnemonic);
  }, [mnemonic]);

  const wordCount = useMemo(() => {
    return getWordCount(mnemonic);
  }, [mnemonic]);

  // Handle wallet name update when masterKeys load (if name hasn't been changed yet)
  const nameChangedRef = useRef(false);
  useEffect(() => {
    if (!nameChangedRef.current && masterKeys.length > 0) {
      setWalletName(generateMasterKeyNickname(masterKeys.length + 1));
    }
  }, [masterKeys.length]);

  // PIN validation (kept for backwards-compat with existing error messages)
  const pinValid = useMemo(() => {
    return pin.length >= 6 && pin === confirmPin;
  }, [pin, confirmPin]);
  void pinValid;
  void setConfirmPin;

  // ========================================
  // Step 1: Mnemonic Input
  // ========================================

  const handleValidateMnemonic = useCallback(() => {
    setError(null);

    if (!mnemonic.trim()) {
      setError('Please paste or type your 12-word recovery phrase above.');
      return;
    }

    if (!mnemonicValidation.isValid) {
      setError(mnemonicValidation.error || 'Invalid recovery phrase');
      return;
    }

    setCurrentStep('pin');
  }, [mnemonic, mnemonicValidation]);

  // ========================================
  // Step 2: PIN Setup
  // ========================================

  const handleImportWallet = useCallback(async (finalPin: string) => {
    if (finalPin.length < 6) {
      setError('PIN must be 6 digits');
      return;
    }

    try {
      setIsLoading(true);
      setError(null);

      const normalizedMnemonic = normalizeMnemonic(mnemonic);
      const masterKeyId = await importMasterKey(normalizedMnemonic, finalPin, walletName.trim() || undefined);

      // Make the newly imported wallet active (relevant for multi-wallet users).
      try {
        await selectWallet(masterKeyId, 0, finalPin);
      } catch (selectError) {
        console.warn('⚠️ [Import] selectWallet failed (non-fatal):', selectError);
      }

      // Skip success screen + onboarding prompts — navigate directly.
      // Biometric/notification setup is offered as a dismissable banner on home.
      router.replace('/wallet/home');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to import wallet';
      if (message.toLowerCase().includes('already')) {
        setError('This wallet has already been imported');
      } else {
        setError(message);
      }
    } finally {
      setIsLoading(false);
    }
  }, [mnemonic, walletName, importMasterKey, selectWallet]);

  // Manual cross-platform keyboard avoidance for the input step.
  const kb = useKeyboardAwareScroll();

  // ========================================
  // Render Steps
  // ========================================

  const renderInputStep = () => (
    <ScrollView
      ref={kb.scrollRef}
      style={styles.scrollView}
      // Manual keyboard avoidance (see useKeyboardAwareScroll) — keeps the
      // recovery-phrase field and Import button above the keyboard on both
      // platforms (Android edge-to-edge ignores adjustResize).
      contentContainerStyle={[styles.scrollContent, kb.contentPadding]}
      keyboardShouldPersistTaps="handled"
      scrollEventThrottle={16}
      onScroll={kb.onScroll}
    >
      <Text style={[styles.stepTitle, { color: primaryText }]}>Import Wallet</Text>
      <Text style={[styles.stepDescription, { color: secondaryText }]}>
        Enter your 12 or 24-word recovery phrase. Words should be separated by spaces.
      </Text>

      {error && (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}

      <StyledTextInput
        mode="outlined"
        label="Recovery Phrase"
        value={mnemonic}
        onChangeText={(text) => {
          setMnemonic(text);
          setError(null);
        }}
        placeholder="word1 word2 word3..."
        style={styles.mnemonicInput}
        onFocus={kb.scrollFieldIntoView}
        multiline
        numberOfLines={4}
        autoCapitalize="none"
        autoCorrect={false}
      />

      {/* Word Count Indicator */}
      <View style={styles.wordCountContainer}>
        <Text
          style={[
            styles.wordCount,
            wordCount === 12 || wordCount === 24
              ? styles.wordCountValid
              : wordCount > 0
              ? styles.wordCountInvalid
              : null,
          ]}
        >
          {wordCount} / {wordCount > 12 ? 24 : 12} words
        </Text>
        {mnemonicValidation.isValid && (
          <Text style={styles.validIndicator}>✓ Valid phrase</Text>
        )}
      </View>

      {/* Tips */}
      <View style={styles.tipsContainer}>
        <Text style={styles.tipsTitle}>Tips:</Text>
        <Text style={styles.tipText}>• Enter words separated by spaces</Text>
        <Text style={styles.tipText}>• Words are case-insensitive</Text>
        <Text style={styles.tipText}>• Make sure to spell each word correctly</Text>
      </View>

      {/* Always tappable — handleValidateMnemonic returns early with an
          inline error if the field is empty / invalid, instead of leaving
          a silently-disabled button. */}
      <Button
        mode="contained"
        onPress={handleValidateMnemonic}
        style={styles.primaryButton}
        contentStyle={styles.buttonContent}
        labelStyle={styles.buttonLabel}
      >
        Continue
      </Button>

      <TouchableOpacity
        style={styles.cancelButton}
        onPress={safeBack}
      >
        <Text style={styles.cancelButtonText}>Cancel</Text>
      </TouchableOpacity>
    </ScrollView>
  );

  const renderPinStep = () => (
    <ScrollView
      style={styles.scrollView}
      contentContainerStyle={styles.scrollContent}
      keyboardShouldPersistTaps="handled"
    >
      {error && (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}

      <StyledTextInput
        mode="outlined"
        label="Wallet Name"
        value={walletName}
        onChangeText={(text: string) => {
          setWalletName(text);
          nameChangedRef.current = true;
        }}
        style={styles.pinInput}
      />

      <PinSetupKeypad
        primaryText={primaryText}
        secondaryText={secondaryText}
        isProcessing={isLoading}
        processingLabel="Importing wallet…"
        enterLabel="Create a wallet PIN"
        confirmLabel="Confirm PIN"
        cancelLabel="Back"
        onCancel={() => setCurrentStep('input')}
        onComplete={(finalPin) => {
          setPin(finalPin);
          void handleImportWallet(finalPin);
        }}
      />
    </ScrollView>
  );

  const renderCurrentStep = () => {
    switch (currentStep) {
      case 'input':
        return renderInputStep();
      case 'pin':
        return renderPinStep();
      default:
        return renderInputStep();
    }
  };

  return (
    <LinearGradient
      colors={gradientColors}
      style={styles.gradient}
    >
      <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
        <SafeAreaView style={styles.container}>
          {/* Progress Bar */}
          <View style={styles.progressContainer}>
            <ProgressBar
              progress={progress}
              color={BRAND_COLOR}
              style={styles.progressBar}
            />
            <Text style={styles.progressText}>
              Step {['input', 'pin'].indexOf(currentStep) + 1} of 2
            </Text>
          </View>

          {/* Content */}
          {renderCurrentStep()}
        </SafeAreaView>
      </TouchableWithoutFeedback>
    </LinearGradient>
  );
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
  progressContainer: {
    padding: 16,
  },
  progressBar: {
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
  },
  progressText: {
    color: 'rgba(255, 255, 255, 0.6)',
    fontSize: 12,
    marginTop: 8,
    textAlign: 'center',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 24,
    paddingBottom: 40,
  },
  stepContent: {
    flex: 1,
    padding: 24,
    justifyContent: 'center',
  },
  stepTitle: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#FFFFFF',
    textAlign: 'center',
    marginBottom: 16,
  },
  stepDescription: {
    fontSize: 16,
    color: 'rgba(255, 255, 255, 0.7)',
    textAlign: 'center',
    marginBottom: 32,
    lineHeight: 24,
  },
  errorBox: {
    backgroundColor: 'rgba(244, 67, 54, 0.2)',
    borderRadius: 8,
    padding: 12,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: 'rgba(244, 67, 54, 0.3)',
  },
  errorText: {
    color: '#F44336',
    fontSize: 14,
    textAlign: 'center',
  },
  mnemonicInput: {
    marginBottom: 12,
    minHeight: 100,
  },
  wordCountContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 24,
  },
  wordCount: {
    fontSize: 14,
    color: 'rgba(255, 255, 255, 0.5)',
  },
  wordCountValid: {
    color: '#4CAF50',
  },
  wordCountInvalid: {
    color: '#FF9800',
  },
  validIndicator: {
    color: '#4CAF50',
    fontSize: 14,
    fontWeight: '600',
  },
  tipsContainer: {
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: 12,
    padding: 16,
    marginBottom: 24,
  },
  tipsTitle: {
    color: 'rgba(255, 255, 255, 0.8)',
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 8,
  },
  tipText: {
    color: 'rgba(255, 255, 255, 0.5)',
    fontSize: 13,
    marginBottom: 4,
  },
  primaryButton: {
    borderRadius: 12,
    backgroundColor: BRAND_COLOR,
    marginTop: 16,
  },
  buttonContent: {
    paddingVertical: 8,
  },
  buttonLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1a1a2e',
  },
  cancelButton: {
    alignSelf: 'center',
    marginTop: 24,
    padding: 12,
  },
  cancelButtonText: {
    color: 'rgba(255, 255, 255, 0.6)',
    fontSize: 16,
  },
  pinInputs: {
    gap: 16,
    marginBottom: 24,
  },
  pinInput: {
  },
  pinHint: {
    color: '#FF9800',
    fontSize: 12,
    marginTop: -4,
    marginBottom: 4,
    marginLeft: 4,
  },
  pinMismatch: {
    color: '#F44336',
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 8,
  },
  successIcon: {
    alignSelf: 'center',
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: 'rgba(76, 175, 80, 0.2)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 24,
  },
  successEmoji: {
    fontSize: 48,
  },
  backButton: {
    position: 'absolute',
    top: 60,
    left: 16,
    padding: 8,
  },
  backButtonText: {
    color: 'rgba(255, 255, 255, 0.7)',
    fontSize: 16,
  },
});
