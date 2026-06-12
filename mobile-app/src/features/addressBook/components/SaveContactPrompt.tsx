/**
 * SaveContactPrompt
 *
 * A small, NON-blocking banner that slides up from the bottom after the send
 * flow redirects Home, offering to save a just-paid Lightning Address / LNURL
 * as a contact. Tapping it routes to Add Contact; the × (or auto-timeout)
 * dismisses it. It does not cover the screen — Home stays fully interactive
 * underneath (pointerEvents="box-none").
 */
import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, TouchableOpacity, View } from 'react-native';
import { Text, IconButton } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BRAND_COLOR } from '../../../utils/theme-helpers';
import { t } from '../../../services/i18nService';

interface SaveContactPromptProps {
  visible: boolean;
  address: string | null;
  onSave: () => void;
  onDismiss: () => void;
}

// Short beat before it slides in (lets the send→home transition settle), and
// an auto-dismiss so it doesn't linger if the user ignores it.
const ENTRANCE_DELAY_MS = 650;
const AUTO_DISMISS_MS = 8000;

export function SaveContactPrompt({
  visible,
  address,
  onSave,
  onDismiss,
}: SaveContactPromptProps): React.JSX.Element | null {
  const insets = useSafeAreaInsets();
  const [rendered, setRendered] = useState(false);
  const anim = useRef(new Animated.Value(0)).current; // 0 = hidden, 1 = shown

  // Slide in (after the delay) / slide out.
  useEffect(() => {
    if (visible) {
      const showTimer = setTimeout(() => {
        setRendered(true);
        Animated.spring(anim, {
          toValue: 1,
          useNativeDriver: true,
          friction: 9,
          tension: 60,
        }).start();
      }, ENTRANCE_DELAY_MS);
      return () => clearTimeout(showTimer);
    }
    Animated.timing(anim, {
      toValue: 0,
      duration: 180,
      easing: Easing.in(Easing.ease),
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) setRendered(false);
    });
    return undefined;
  }, [visible, anim]);

  // Auto-dismiss once shown.
  useEffect(() => {
    if (!rendered) return undefined;
    const timer = setTimeout(() => onDismiss(), AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [rendered, onDismiss]);

  if (!rendered) return null;

  const translateY = anim.interpolate({ inputRange: [0, 1], outputRange: [140, 0] });

  return (
    <Animated.View
      pointerEvents="box-none"
      style={[
        styles.wrap,
        { bottom: insets.bottom + 16, opacity: anim, transform: [{ translateY }] },
      ]}
    >
      <View style={styles.card}>
        <View style={styles.row}>
          <View style={styles.iconWrap}>
            <IconButton icon="account-plus" iconColor={BRAND_COLOR} size={20} style={styles.iconBtn} />
          </View>
          <View style={styles.textCol}>
            <Text style={styles.title} numberOfLines={1}>
              {t('send.saveContactTitle')}
            </Text>
            <Text style={styles.addr} numberOfLines={1}>
              {address}
            </Text>
          </View>
        </View>

        <View style={styles.actions}>
          <TouchableOpacity onPress={onDismiss} activeOpacity={0.7} style={[styles.btn, styles.cancelBtn]}>
            <Text style={styles.cancelText}>{t('common.cancel')}</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={onSave} activeOpacity={0.8} style={[styles.btn, styles.saveBtn]}>
            <Text style={styles.saveText}>{t('common.save')}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
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
    // Soft lift so it reads as floating above the page.
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
  },
  row: {
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
  iconBtn: { margin: 0 },
  textCol: { flex: 1, paddingRight: 4 },
  title: {
    fontSize: 14,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  addr: {
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.6)',
    marginTop: 1,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: 8,
    marginTop: 10,
  },
  btn: {
    minWidth: 84,
    paddingVertical: 9,
    paddingHorizontal: 16,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelBtn: {
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
  },
  cancelText: {
    color: 'rgba(255, 255, 255, 0.85)',
    fontSize: 14,
    fontWeight: '600',
  },
  saveBtn: {
    backgroundColor: BRAND_COLOR,
  },
  saveText: {
    color: '#1a1a2e',
    fontSize: 14,
    fontWeight: '700',
  },
});
