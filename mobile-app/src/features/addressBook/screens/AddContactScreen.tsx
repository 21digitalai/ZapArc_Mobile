/**
 * AddContactScreen
 * Form for adding a new contact to the address book
 */

import React, { useState, useCallback, useMemo } from 'react';
import {
  StyleSheet,
  View,
  ScrollView,
  Platform,
  BackHandler,
} from 'react-native';
import {
  Text,
  Button,
  IconButton,
  HelperText,
} from 'react-native-paper';
import { StyledTextInput } from '../../../components';
import { useKeyboardAwareScroll } from '../../../hooks/useKeyboardAwareScroll';
import { useFeedback } from '../../wallet/components/FeedbackComponents';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useAppTheme } from '../../../contexts/ThemeContext';
import {
  getGradientColors,
  getPrimaryTextColor,
  getSecondaryTextColor,
  BRAND_COLOR,
} from '../../../utils/theme-helpers';
import { validateLightningAddressResolves } from '../../../utils';
import { t } from '../../../services/i18nService';
import { VALIDATION_LIMITS } from '../types';
import { useContacts } from '../hooks/useContacts';
import {
  validateName,
  validateLightningAddress,
  validateSparkAddress,
  validateNotes,
} from '../services/contactValidator';
import { ContactValidationError } from '../services/contactService';
import { createSafeBackHandler } from '../../wallet/utils/safeBack';

export function AddContactScreen(): React.JSX.Element {
  const safeBack = useMemo(() => createSafeBackHandler({
    canGoBack: () => router.canGoBack(), back: () => router.back(), replace: (route) => router.replace(route),
  }, '/wallet/settings/address-book'), []);
  useFocusEffect(
    useCallback(() => {
      const subscription = BackHandler.addEventListener('hardwareBackPress', safeBack);
      return () => subscription.remove();
    }, [safeBack])
  );
  const { themeMode } = useAppTheme();
  const { createContact } = useContacts();

  // Optional prefill — e.g. the "Save as contact" prompt after paying a
  // Lightning Address routes here with both fields set to the address the
  // user just paid.
  const params = useLocalSearchParams<{ name?: string; address?: string }>();
  const prefillName = typeof params.name === 'string' ? params.name : '';
  const prefillAddress = typeof params.address === 'string' ? params.address : '';

  const gradientColors = getGradientColors(themeMode);
  const primaryTextColor = getPrimaryTextColor(themeMode);
  const secondaryTextColor = getSecondaryTextColor(themeMode);

  const [name, setName] = useState(prefillName);
  const [lightningAddress, setLightningAddress] = useState(prefillAddress);
  const [sparkAddress, setSparkAddress] = useState('');
  const [preferredAsset, setPreferredAsset] = useState<'BTC' | 'USDB'>('BTC');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const { showError } = useFeedback();
  // Manual keyboard avoidance (Notes sits at the bottom; Android edge-to-edge
  // ignores adjustResize and KAV 'height' mis-measures there).
  const kb = useKeyboardAwareScroll();

  const [nameError, setNameError] = useState<string | null>(null);
  const [addressError, setAddressError] = useState<string | null>(null);
  const [sparkAddressError, setSparkAddressError] = useState<string | null>(null);
  const [notesError, setNotesError] = useState<string | null>(null);

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

    if (sparkAddress.trim()) {
      const sparkResult = validateSparkAddress(sparkAddress);
      if (!sparkResult.isValid) {
        setSparkAddressError(sparkResult.errors[0]?.message || 'Invalid Spark address');
        isValid = false;
      } else {
        setSparkAddressError(null);
      }
    } else {
      setSparkAddressError(null);
    }

    if (notes.trim()) {
      const notesResult = validateNotes(notes);
      if (!notesResult.isValid) {
        setNotesError(notesResult.errors[0]?.message || 'Invalid notes');
        isValid = false;
      } else {
        setNotesError(null);
      }
    } else {
      setNotesError(null);
    }

    return isValid;
  }, [name, lightningAddress, sparkAddress, notes]);

  const handleSave = useCallback(async () => {
    if (!validateForm()) return;

    setSaving(true);
    setVerifying(true);
    
    try {
      // Verify the Lightning Address resolves correctly
      const verifyResult = await validateLightningAddressResolves(lightningAddress.trim());
      setVerifying(false);
      
      if (!verifyResult.isValid) {
        setAddressError(verifyResult.error || 'Lightning Address could not be verified');
        setSaving(false);
        return;
      }

      await createContact({
        name: name.trim(),
        lightningAddress: lightningAddress.trim(),
        sparkAddress: sparkAddress.trim() || undefined,
        preferredAsset,
        notes: notes.trim() || undefined,
      });
      safeBack();
    } catch (err) {
      setVerifying(false);
      if (err instanceof ContactValidationError) {
        const addressErrors = err.validation.errors.filter(
          (e) => e.field === 'lightningAddress'
        );
        if (addressErrors.length > 0) {
          setAddressError(addressErrors[0].message);
        } else {
          showError(err.message);
        }
      } else {
        showError('Failed to save contact. Please try again.');
      }
    } finally {
      setSaving(false);
    }
  }, [validateForm, createContact, name, lightningAddress, sparkAddress, preferredAsset, notes, safeBack]);

  return (
    <LinearGradient colors={gradientColors} style={styles.gradient}>
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.keyboardView}>
          {/* Header */}
          <View style={styles.header}>
            <IconButton
              icon="close"
              iconColor={primaryTextColor}
              size={24}
              onPress={safeBack}
            />
            <Text style={[styles.headerTitle, { color: primaryTextColor }]}>
              {t('addressBook.addContact')}
            </Text>
            <Button
              mode="text"
              onPress={handleSave}
              loading={saving}
              disabled={saving}
              textColor={BRAND_COLOR}
            >
              {verifying ? t('addressBook.verifying') : t('addressBook.save')}
            </Button>
          </View>

          <ScrollView
            ref={kb.scrollRef}
            style={styles.scrollView}
            contentContainerStyle={[styles.scrollContent, kb.contentPadding]}
            keyboardShouldPersistTaps="handled"
            scrollEventThrottle={16}
            onScroll={kb.onScroll}
          >
            {/* Name Input (optional — falls back to the address when blank) */}
            <View style={styles.inputContainer}>
              <StyledTextInput
                label={t('addressBook.nameOptional')}
                onFocus={kb.scrollFieldIntoView}
                value={name}
                onChangeText={setName}
                error={!!nameError}
                maxLength={VALIDATION_LIMITS.NAME_MAX_LENGTH}
              />
              <HelperText type="error" visible={!!nameError}>
                {nameError}
              </HelperText>
            </View>

            {/* Lightning Address Input */}
            <View style={styles.inputContainer}>
              <StyledTextInput
                label={t('addressBook.lightningAddress')}
                onFocus={kb.scrollFieldIntoView}
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

            {/* Spark Address Input */}
            <View style={styles.inputContainer}>
              <StyledTextInput
                label={t('addressBook.sparkAddressOptional')}
                onFocus={kb.scrollFieldIntoView}
                value={sparkAddress}
                onChangeText={setSparkAddress}
                error={!!sparkAddressError}
                autoCapitalize="none"
                autoCorrect={false}
                placeholder="sp1..."
              />
              <HelperText type="error" visible={!!sparkAddressError}>
                {sparkAddressError}
              </HelperText>
            </View>

            {/* Notes Input */}
            <View style={styles.inputContainer}>
              <StyledTextInput
                label={t('addressBook.notesOptional')}
                onFocus={kb.scrollFieldIntoView}
                value={notes}
                onChangeText={setNotes}
                error={!!notesError}
                multiline
                numberOfLines={3}
                maxLength={VALIDATION_LIMITS.NOTES_MAX_LENGTH}
                style={styles.notesInput}
              />
              <HelperText type="error" visible={!!notesError}>
                {notesError}
              </HelperText>
              <Text style={[styles.charCount, { color: secondaryTextColor }]}>
                {notes.length}/{VALIDATION_LIMITS.NOTES_MAX_LENGTH}
              </Text>
            </View>
          </ScrollView>
        </View>
      </SafeAreaView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  gradient: {
    flex: 1,
  },
  container: {
    flex: 1,
  },
  keyboardView: {
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
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
  },
  inputContainer: {
    marginBottom: 8,
  },
  notesInput: {
    minHeight: 100,
  },
  charCount: {
    textAlign: 'right',
    fontSize: 12,
    marginTop: -16,
    marginRight: 8,
  },
});
