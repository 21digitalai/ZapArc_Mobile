/**
 * SaveContactPrompt
 *
 * Two-step post-payment contact save flow. A small dismissible banner appears
 * after a successful send; tapping Save opens the larger bottom-sheet form.
 * The form keeps the user on Home and writes through useContacts so every
 * address-book consumer sees the new contact immediately.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated,
  Alert,
  Easing,
  KeyboardAvoidingView,
  Platform,
  Pressable,
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
  validateNotes,
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
  const [sheetVisible, setSheetVisible] = useState(false);
  const [name, setName] = useState('');
  const [lightningAddress, setLightningAddress] = useState(address || '');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const [addressError, setAddressError] = useState<string | null>(null);
  const [notesError, setNotesError] = useState<string | null>(null);

  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!visible) return;

    setSheetVisible(false);
    setName('');
    setLightningAddress(address || '');
    setNotes('');
    setNameError(null);
    setAddressError(null);
    setNotesError(null);
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
        setSheetVisible(false);
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

    const notesResult = validateNotes(notes);
    if (!notesResult.isValid) {
      setNotesError(notesResult.errors[0]?.message || 'Invalid notes');
      isValid = false;
    } else {
      setNotesError(null);
    }

    return isValid;
  }, [name, lightningAddress, notes]);

  const handleOpenSheet = useCallback((): void => {
    setSheetVisible(true);
    anim.setValue(0);
    Animated.spring(anim, {
      toValue: 1,
      useNativeDriver: true,
      friction: 9,
      tension: 60,
    }).start();
  }, [anim]);

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
        notes: notes.trim() || undefined,
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
  }, [createContact, lightningAddress, name, notes, onDismiss, onSaved, validateForm]);

  if (!rendered) return null;

  const bannerTranslateY = anim.interpolate({ inputRange: [0, 1], outputRange: [140, 0] });
  const sheetTranslateY = anim.interpolate({ inputRange: [0, 1], outputRange: [360, 0] });

  return (
    <View style={styles.overlay} pointerEvents="box-none">
      {!sheetVisible ? (
        <Animated.View
          pointerEvents="auto"
          style={[
            styles.bannerWrap,
            { bottom: insets.bottom + 16, opacity: anim, transform: [{ translateY: bannerTranslateY }] },
          ]}
        >
          <View style={styles.bannerCard}>
            <View style={styles.bannerRow}>
              <View style={styles.iconWrap}>
                <IconButton icon="account-plus" iconColor={BRAND_COLOR} size={20} style={styles.iconBtn} />
              </View>
              <View style={styles.bannerTextCol}>
                <Text style={styles.bannerTitle} numberOfLines={1}>
                  {t('send.saveContactTitle')}
                </Text>
                <Text style={styles.bannerAddress} numberOfLines={1}>
                  {address}
                </Text>
              </View>
            </View>

            <View style={styles.bannerActions}>
              <TouchableOpacity onPress={onDismiss} activeOpacity={0.7} style={[styles.bannerBtn, styles.bannerCancelBtn]}>
                <Text style={styles.bannerCancelText}>{t('common.cancel')}</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={handleOpenSheet} activeOpacity={0.8} style={[styles.bannerBtn, styles.bannerSaveBtn]}>
                <Text style={styles.bannerSaveText}>{t('common.save')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Animated.View>
      ) : (
        <>
          <Pressable style={styles.backdrop} onPress={onDismiss} />
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            pointerEvents="box-none"
            style={styles.keyboardAvoider}
          >
            <Animated.View
              style={[
                styles.sheet,
                {
                  paddingBottom: insets.bottom + 18,
                  transform: [{ translateY: sheetTranslateY }],
                  opacity: anim,
                },
              ]}
            >
              <View style={styles.handle} />

              <View style={styles.header}>
                <View style={styles.headerText}>
                  <Text style={styles.title}>{t('send.saveContactTitle')}</Text>
                  <Text style={styles.subtitle} numberOfLines={1}>
                    {address}
                  </Text>
                </View>
                <IconButton icon="close" iconColor="rgba(255,255,255,0.72)" size={22} onPress={onDismiss} />
              </View>

              <View style={styles.form}>
                <View style={styles.inputBlock}>
                  <StyledTextInput
                    label={t('addressBook.nameOptional')}
                    value={name}
                    onChangeText={setName}
                    error={!!nameError}
                    maxLength={VALIDATION_LIMITS.NAME_MAX_LENGTH}
                  />
                  <HelperText type="error" visible={!!nameError}>
                    {nameError}
                  </HelperText>
                </View>

                <View style={styles.inputBlock}>
                  <StyledTextInput
                    label={t('addressBook.lightningAddress')}
                    value={lightningAddress}
                    onChangeText={setLightningAddress}
                    error={!!addressError}
                    autoCapitalize="none"
                    autoCorrect={false}
                    keyboardType="email-address"
                    placeholder="user@domain.com"
                  />
                  <HelperText type="error" visible={!!addressError}>
                    {addressError}
                  </HelperText>
                </View>

                <View style={styles.inputBlock}>
                  <StyledTextInput
                    label={t('addressBook.notesOptional')}
                    value={notes}
                    onChangeText={setNotes}
                    error={!!notesError}
                    multiline
                    numberOfLines={2}
                    maxLength={VALIDATION_LIMITS.NOTES_MAX_LENGTH}
                  />
                  <HelperText type="error" visible={!!notesError}>
                    {notesError}
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
                >
                  {verifying ? t('addressBook.verifying') : t('common.save')}
                </Button>
              </View>
            </Animated.View>
          </KeyboardAvoidingView>
        </>
      )}
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
  bannerWrap: {
    position: 'absolute',
    left: 12,
    right: 12,
    zIndex: 50,
    elevation: 12,
  },
  bannerCard: {
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
  bannerRow: {
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
  bannerTextCol: {
    flex: 1,
    paddingRight: 4,
  },
  bannerTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  bannerAddress: {
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.6)',
    marginTop: 1,
  },
  bannerActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: 8,
    marginTop: 10,
  },
  bannerBtn: {
    minWidth: 84,
    paddingVertical: 9,
    paddingHorizontal: 16,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bannerCancelBtn: {
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
  },
  bannerCancelText: {
    color: 'rgba(255, 255, 255, 0.85)',
    fontSize: 14,
    fontWeight: '600',
  },
  bannerSaveBtn: {
    backgroundColor: BRAND_COLOR,
  },
  bannerSaveText: {
    color: '#1a1a2e',
    fontSize: 14,
    fontWeight: '700',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.48)',
  },
  keyboardAvoider: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#1a1a2e',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingTop: 10,
    paddingHorizontal: 18,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255, 255, 255, 0.12)',
    shadowColor: '#000',
    shadowOpacity: 0.32,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: -6 },
  },
  handle: {
    alignSelf: 'center',
    width: 42,
    height: 4,
    borderRadius: 999,
    backgroundColor: 'rgba(255, 255, 255, 0.24)',
    marginBottom: 10,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  headerText: {
    flex: 1,
    paddingRight: 8,
  },
  title: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: '800',
  },
  subtitle: {
    color: 'rgba(255, 255, 255, 0.58)',
    fontSize: 13,
    marginTop: 3,
  },
  form: {
    gap: 2,
  },
  inputBlock: {
    marginBottom: 2,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 10,
  },
  actionBtn: {
    minHeight: 46,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 18,
  },
  cancelBtn: {
    flex: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
  },
  cancelText: {
    color: 'rgba(255, 255, 255, 0.86)',
    fontSize: 15,
    fontWeight: '700',
  },
  saveBtn: {
    flex: 1,
    minHeight: 46,
    borderRadius: 14,
    justifyContent: 'center',
  },
  saveLabel: {
    fontSize: 15,
    fontWeight: '800',
  },
});
