/**
 * SaveContactPrompt
 *
 * Compact post-payment contact save flow. A floating card appears after a
 * successful send, keeps the Home screen usable behind it, and writes through
 * useContacts so every address-book consumer sees the new contact immediately.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated,
  Alert,
  Easing,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  TouchableOpacity,
  View,
} from 'react-native';
import { Button, HelperText, IconButton, Text } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StyledTextInput } from '../../../components';
import { t } from '../../../services/i18nService';
import { validateLightningAddressResolves } from '../../../utils';
import { BRAND_COLOR } from '../../../utils/theme-helpers';
import { ContactValidationError } from '../services/contactService';
import {
  validateLightningAddress,
  validateName,
} from '../services/contactValidator';
import { VALIDATION_LIMITS } from '../types';
import { useContacts } from '../hooks/useContacts';

interface SaveContactPromptProps {
  visible: boolean;
  address: string | null;
  onSaved?: () => void;
  onDismiss: () => void;
}

const ENTRANCE_DELAY_MS = 650;

export function SaveContactPrompt({
  visible,
  address,
  onSaved,
  onDismiss,
}: SaveContactPromptProps): React.JSX.Element | null {
  const insets = useSafeAreaInsets();
  const { createContact } = useContacts();

  const [rendered, setRendered] = useState(false);
  const [name, setName] = useState('');
  const [lightningAddress, setLightningAddress] = useState(address || '');
  const [saving, setSaving] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const [addressError, setAddressError] = useState<string | null>(null);

  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!visible) return;

    setName('');
    setLightningAddress(address || '');
    setNameError(null);
    setAddressError(null);
  }, [visible, address]);

  useEffect(() => {
    if (visible) {
      const showTimer = globalThis.setTimeout(() => {
        setRendered(true);
        Animated.spring(anim, {
          toValue: 1,
          useNativeDriver: true,
          friction: 9,
          tension: 60,
        }).start();
      }, ENTRANCE_DELAY_MS);
      return () => globalThis.clearTimeout(showTimer);
    }

    Animated.timing(anim, {
      toValue: 0,
      duration: 180,
      easing: Easing.in(Easing.ease),
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) {
        setRendered(false);
      }
    });
    return undefined;
  }, [visible, anim]);

  const validateForm = useCallback((): boolean => {
    let isValid = true;

    const nameResult = validateName(name);
    if (!nameResult.isValid) {
      setNameError(nameResult.errors[0]?.message || 'Invalid name');
      isValid = false;
    } else {
      setNameError(null);
    }

    const addressResult = validateLightningAddress(lightningAddress);
    if (!addressResult.isValid) {
      setAddressError(addressResult.errors[0]?.message || 'Invalid address');
      isValid = false;
    } else {
      setAddressError(null);
    }

    return isValid;
  }, [name, lightningAddress]);

  const handleSave = useCallback(async (): Promise<void> => {
    if (!validateForm()) return;

    setSaving(true);
    setVerifying(true);

    try {
      const normalizedAddress = lightningAddress.trim();
      const verifyResult = await validateLightningAddressResolves(normalizedAddress);
      setVerifying(false);

      if (!verifyResult.isValid) {
        setAddressError(verifyResult.error || 'Lightning Address could not be verified');
        return;
      }

      await createContact({
        name: name.trim(),
        lightningAddress: normalizedAddress,
        preferredAsset: 'BTC',
      });

      onSaved?.();
      onDismiss();
    } catch (err) {
      setVerifying(false);
      if (err instanceof ContactValidationError) {
        const addressErrors = err.validation.errors.filter((e) => e.field === 'lightningAddress');
        if (addressErrors.length > 0) {
          setAddressError(addressErrors[0].message);
        } else {
          Alert.alert(t('common.error'), err.message);
        }
      } else {
        Alert.alert(t('common.error'), 'Failed to save contact. Please try again.');
      }
    } finally {
      setSaving(false);
    }
  }, [createContact, lightningAddress, name, onDismiss, onSaved, validateForm]);

  if (!rendered) return null;

  const cardTranslateY = anim.interpolate({ inputRange: [0, 1], outputRange: [140, 0] });

  return (
    <View style={styles.overlay} pointerEvents="box-none">
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        pointerEvents="box-none"
        style={styles.keyboardAvoider}
      >
        <Animated.View
          pointerEvents="auto"
          style={[
            styles.cardWrap,
            {
              bottom: insets.bottom + 14,
              opacity: anim,
              transform: [{ translateY: cardTranslateY }],
            },
          ]}
        >
          <View style={styles.card}>
            <View style={styles.headerRow}>
              <View style={styles.iconWrap}>
                <IconButton icon="account-plus" iconColor={BRAND_COLOR} size={20} style={styles.iconBtn} />
              </View>
              <View style={styles.headerTextCol}>
                <Text style={styles.title} numberOfLines={1}>
                  {t('send.saveContactTitle')}
                </Text>
                <Text style={styles.subtitle} numberOfLines={1}>
                  {address}
                </Text>
              </View>
              <IconButton
                icon="close"
                iconColor="rgba(255,255,255,0.72)"
                size={20}
                onPress={onDismiss}
                style={styles.closeBtn}
                disabled={saving}
              />
            </View>

            <View style={styles.formRow}>
              <View style={styles.nameField}>
                <StyledTextInput
                  label={t('addressBook.nameOptional')}
                  value={name}
                  onChangeText={setName}
                  error={!!nameError}
                  maxLength={VALIDATION_LIMITS.NAME_MAX_LENGTH}
                  dense
                  style={styles.input}
                />
                <HelperText type="error" visible={!!nameError} style={styles.helperText}>
                  {nameError}
                </HelperText>
              </View>

              <View style={styles.addressField}>
                <StyledTextInput
                  label={t('addressBook.lightningAddress')}
                  value={lightningAddress}
                  onChangeText={setLightningAddress}
                  error={!!addressError}
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="email-address"
                  placeholder="user@domain.com"
                  dense
                  style={styles.input}
                />
                <HelperText type="error" visible={!!addressError} style={styles.helperText}>
                  {addressError}
                </HelperText>
              </View>
            </View>

            <View style={styles.actions}>
              <TouchableOpacity
                onPress={onDismiss}
                activeOpacity={0.75}
                style={[styles.actionBtn, styles.cancelBtn]}
                disabled={saving}
              >
                <Text style={styles.cancelText}>{t('common.cancel')}</Text>
              </TouchableOpacity>
              <Button
                mode="contained"
                onPress={handleSave}
                loading={saving}
                disabled={saving}
                buttonColor={BRAND_COLOR}
                textColor="#1a1a2e"
                style={styles.saveBtn}
                labelStyle={styles.saveLabel}
                compact
              >
                {verifying ? t('addressBook.verifying') : t('common.save')}
              </Button>
            </View>
          </View>
        </Animated.View>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 80,
    elevation: 24,
    justifyContent: 'flex-end',
  },
  keyboardAvoider: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'flex-end',
  },
  cardWrap: {
    position: 'absolute',
    left: 12,
    right: 12,
    zIndex: 50,
    elevation: 12,
  },
  card: {
    backgroundColor: '#23233a',
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255, 255, 255, 0.10)',
    paddingHorizontal: 10,
    paddingTop: 10,
    paddingBottom: 8,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(247, 147, 26, 0.16)',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 10,
  },
  iconBtn: {
    margin: 0,
  },
  headerTextCol: {
    flex: 1,
    paddingRight: 4,
  },
  closeBtn: {
    margin: -6,
  },
  title: {
    fontSize: 14,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  subtitle: {
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.6)',
    marginTop: 1,
  },
  formRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    marginTop: 10,
  },
  nameField: {
    flex: 0.9,
  },
  addressField: {
    flex: 1.25,
  },
  input: {
    minHeight: 42,
    fontSize: 13,
  },
  helperText: {
    minHeight: 16,
    marginTop: -2,
    marginBottom: -6,
    fontSize: 10,
    lineHeight: 12,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    justifyContent: 'flex-end',
    marginTop: 4,
  },
  actionBtn: {
    minHeight: 38,
    minWidth: 86,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
  },
  cancelBtn: {
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
  },
  cancelText: {
    color: 'rgba(255, 255, 255, 0.86)',
    fontSize: 13,
    fontWeight: '700',
  },
  saveBtn: {
    minHeight: 38,
    minWidth: 104,
    borderRadius: 12,
    justifyContent: 'center',
  },
  saveLabel: {
    fontSize: 13,
    fontWeight: '800',
  },
});
