// PIN Setup Keypad
// Single-screen PIN + Confirm-PIN entry with auto-advance between stages.
// On 6 digits entered, stage morphs from "Enter PIN" to "Confirm PIN".
// On match, calls onComplete(pin). On mismatch, shakes + resets to stage 1.

import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  Animated,
  Vibration,
} from 'react-native';
import { Text, IconButton, ActivityIndicator } from 'react-native-paper';
import { BRAND_COLOR } from '../utils/theme-helpers';
import { WALLET_PIN_LENGTH } from '../features/wallet/constants/security';

const PIN_LENGTH = WALLET_PIN_LENGTH;

const KEYPAD: Array<Array<string>> = [
  ['1', '2', '3'],
  ['4', '5', '6'],
  ['7', '8', '9'],
  ['', '0', 'delete'],
];

export interface PinSetupKeypadProps {
  onComplete: (pin: string) => void | Promise<void>;
  onCancel?: () => void;
  primaryText: string;
  secondaryText: string;
  isProcessing?: boolean;
  processingLabel?: string;
  enterLabel?: string;
  confirmLabel?: string;
  mismatchLabel?: string;
  cancelLabel?: string;
}

export function PinSetupKeypad({
  onComplete,
  onCancel,
  primaryText,
  secondaryText,
  isProcessing = false,
  processingLabel = 'Setting up…',
  enterLabel = 'Create PIN',
  confirmLabel = 'Confirm PIN',
  mismatchLabel = 'PINs do not match — try again',
  cancelLabel = 'Cancel',
}: PinSetupKeypadProps): React.JSX.Element {
  const [stage, setStage] = useState<'enter' | 'confirm'>('enter');
  const [firstPin, setFirstPin] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);

  // One-shot guard: once onComplete has fired, never fire again for this
  // mount. Without this, if the parent re-renders while handleComplete is
  // in-flight (common — hook callbacks often change reference between
  // renders), the useEffect below re-fires with `pin === firstPin` still
  // true and calls onComplete a second (or third, or fourth) time. That's
  // what caused multiple concurrent wallet imports in alpha.4–alpha.6.
  const completedRef = useRef(false);

  const shakeAnimation = useRef(new Animated.Value(0)).current;

  const shake = useCallback(() => {
    Vibration.vibrate(60);
    Animated.sequence([
      Animated.timing(shakeAnimation, { toValue: 12, duration: 50, useNativeDriver: true }),
      Animated.timing(shakeAnimation, { toValue: -12, duration: 50, useNativeDriver: true }),
      Animated.timing(shakeAnimation, { toValue: 8, duration: 50, useNativeDriver: true }),
      Animated.timing(shakeAnimation, { toValue: -8, duration: 50, useNativeDriver: true }),
      Animated.timing(shakeAnimation, { toValue: 0, duration: 50, useNativeDriver: true }),
    ]).start();
  }, [shakeAnimation]);

  // Auto-advance when a stage is complete
  useEffect(() => {
    if (completedRef.current) return;
    if (pin.length !== PIN_LENGTH) return;

    if (stage === 'enter') {
      // Move to confirm stage
      setFirstPin(pin);
      setPin('');
      setError(null);
      setStage('confirm');
      return;
    }

    // stage === 'confirm'
    if (pin === firstPin) {
      // Mark completed BEFORE the async call so the effect can't re-fire
      // with a still-matching pin if the parent re-renders during await.
      completedRef.current = true;
      void onComplete(pin);
      return;
    }

    // mismatch → shake, reset to enter stage
    shake();
    setError(mismatchLabel);
    setFirstPin('');
    setPin('');
    setStage('enter');
  }, [pin, stage, firstPin, onComplete, mismatchLabel, shake]);

  const handleKeyPress = useCallback(
    (key: string) => {
      if (isProcessing) return;
      setError(null);

      if (key === 'delete') {
        setPin((p) => p.slice(0, -1));
        return;
      }

      setPin((p) => (p.length < PIN_LENGTH ? p + key : p));
    },
    [isProcessing]
  );

  const title = stage === 'enter' ? enterLabel : confirmLabel;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: primaryText }]}>{title}</Text>
        {stage === 'confirm' && (
          <Text style={[styles.subtitle, { color: secondaryText }]}>
            Re-enter the same PIN
          </Text>
        )}
      </View>

      <View style={styles.pinDisplayContainer}>
        {isProcessing ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={BRAND_COLOR} />
            <Text style={[styles.loadingText, { color: secondaryText }]}>
              {processingLabel}
            </Text>
          </View>
        ) : (
          <>
            <Animated.View
              style={[
                styles.pinDisplay,
                { transform: [{ translateX: shakeAnimation }] },
              ]}
            >
              {Array(PIN_LENGTH)
                .fill(0)
                .map((_, index) => (
                  <View
                    key={index}
                    style={[
                      styles.pinDot,
                      index < pin.length && styles.pinDotFilled,
                      error && styles.pinDotError,
                    ]}
                  />
                ))}
            </Animated.View>
            {error && <Text style={styles.errorText}>{error}</Text>}
          </>
        )}
      </View>

      <View style={styles.keypadContainer}>
        {KEYPAD.map((row, rowIndex) => (
          <View key={rowIndex} style={styles.keypadRow}>
            {row.map((key, keyIndex) => {
              if (key === '') {
                return <View key={keyIndex} style={styles.keypadKeyEmpty} />;
              }
              if (key === 'delete') {
                return (
                  <TouchableOpacity
                    key={keyIndex}
                    style={styles.keypadKey}
                    onPress={() => handleKeyPress('delete')}
                    disabled={pin.length === 0 || isProcessing}
                  >
                    <IconButton
                      icon="backspace-outline"
                      size={28}
                      iconColor={pin.length > 0 ? primaryText : secondaryText}
                    />
                  </TouchableOpacity>
                );
              }
              return (
                <TouchableOpacity
                  key={keyIndex}
                  style={styles.keypadKey}
                  onPress={() => handleKeyPress(key)}
                  activeOpacity={0.7}
                  disabled={isProcessing}
                >
                  <Text style={[styles.keypadKeyText, { color: primaryText }]}>
                    {key}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        ))}
      </View>

      {onCancel && !isProcessing && (
        <TouchableOpacity style={styles.cancelBtn} onPress={onCancel}>
          <Text style={[styles.cancelText, { color: secondaryText }]}>
            {cancelLabel}
          </Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 24,
    paddingVertical: 20,
    alignItems: 'stretch',
    gap: 20,
  },
  header: {
    alignItems: 'center',
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 13,
  },
  pinDisplayContainer: {
    alignItems: 'center',
    minHeight: 60,
    justifyContent: 'center',
  },
  loadingContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    gap: 10,
  },
  loadingText: {
    fontSize: 14,
    fontWeight: '500',
  },
  pinDisplay: {
    flexDirection: 'row',
    gap: 16,
  },
  pinDot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 2,
    borderColor: 'rgba(255, 255, 255, 0.35)',
    backgroundColor: 'transparent',
  },
  pinDotFilled: {
    backgroundColor: BRAND_COLOR,
    borderColor: BRAND_COLOR,
  },
  pinDotError: {
    borderColor: '#F44336',
    backgroundColor: '#F44336',
  },
  errorText: {
    color: '#F44336',
    fontSize: 13,
    marginTop: 10,
    textAlign: 'center',
  },
  keypadContainer: {
    alignItems: 'center',
    gap: 14,
  },
  keypadRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 20,
  },
  keypadKey: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  keypadKeyEmpty: {
    width: 64,
    height: 64,
  },
  keypadKeyText: {
    fontSize: 26,
    fontWeight: '500',
  },
  cancelBtn: {
    alignSelf: 'center',
    padding: 10,
  },
  cancelText: {
    fontSize: 14,
  },
});
