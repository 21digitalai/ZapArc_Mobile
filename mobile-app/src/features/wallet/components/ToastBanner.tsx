// ToastBanner
// Heads-up style toast rendered at the top of the screen. Inspired by the
// Android system heads-up notification: dark glass pill, colored icon chip
// by event tone, compact one-line summary + optional trailing chip.
//
// Replaces the old Paper Snackbar which was a loud full-width green bar at
// the bottom — too much green, low readability, and it sometimes covered
// on-screen controls.

import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, Text, TouchableWithoutFeedback, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export type ToastTone = 'success' | 'accent' | 'warn' | 'danger' | 'info';

export interface ToastBannerProps {
  visible: boolean;
  onDismiss: () => void;
  /**
   * Leading text icon (emoji or single glyph). Rendered inside a tone-tinted
   * square chip on the left of the pill.
   */
  icon?: string;
  title: string;
  /** Optional muted subtitle below the title — e.g. "marcus@breez.tips". */
  subtitle?: string;
  /**
   * Optional right-side chip with a short highlighted value — e.g. "+$85.29"
   * for a received amount, or "0.3% fee" for a swap. Tinted by tone.
   */
  trailing?: string;
  tone?: ToastTone;
  /** Milliseconds to stay on screen. Default 3500. */
  duration?: number;
}

const TONE_COLORS: Record<ToastTone, { accent: string; bg: string; border: string }> = {
  success: { accent: '#34d399', bg: 'rgba(52, 211, 153, 0.14)', border: 'rgba(52, 211, 153, 0.35)' },
  accent:  { accent: '#5eead4', bg: 'rgba(94, 234, 212, 0.14)', border: 'rgba(94, 234, 212, 0.35)' },
  warn:    { accent: '#f59e0b', bg: 'rgba(245, 158, 11, 0.14)', border: 'rgba(245, 158, 11, 0.35)' },
  danger:  { accent: '#ef4444', bg: 'rgba(239, 68, 68, 0.14)',  border: 'rgba(239, 68, 68, 0.35)'  },
  info:    { accent: '#60a5fa', bg: 'rgba(96, 165, 250, 0.14)', border: 'rgba(96, 165, 250, 0.35)' },
};

export function ToastBanner({
  visible,
  onDismiss,
  icon = '⚡',
  title,
  subtitle,
  trailing,
  tone = 'success',
  duration = 3500,
}: ToastBannerProps): React.JSX.Element | null {
  const insets = useSafeAreaInsets();
  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      Animated.timing(anim, {
        toValue: 1,
        duration: 220,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }).start();
      const timer = setTimeout(() => {
        onDismiss();
      }, duration);
      return () => clearTimeout(timer);
    }
    Animated.timing(anim, {
      toValue: 0,
      duration: 180,
      easing: Easing.in(Easing.quad),
      useNativeDriver: true,
    }).start();
    return () => {};
  }, [visible, anim, duration, onDismiss]);

  if (!visible) return null;

  const t = TONE_COLORS[tone];

  return (
    <Animated.View
      pointerEvents="box-none"
      style={[
        styles.container,
        {
          top: insets.top + 6,
          opacity: anim,
          transform: [
            {
              translateY: anim.interpolate({
                inputRange: [0, 1],
                outputRange: [-12, 0],
              }),
            },
          ],
        },
      ]}
      accessibilityLiveRegion="polite"
      accessibilityRole="alert"
    >
      <TouchableWithoutFeedback onPress={onDismiss}>
        <View style={[styles.pill, { borderColor: t.border }]}>
          <View style={[styles.iconChip, { backgroundColor: t.bg, borderColor: t.border }]}>
            <Text style={[styles.iconText, { color: t.accent }]}>{icon}</Text>
          </View>

          <View style={styles.textCol}>
            <Text numberOfLines={1} style={styles.title}>
              {title}
            </Text>
            {subtitle ? (
              <Text numberOfLines={1} style={styles.subtitle}>
                {subtitle}
              </Text>
            ) : null}
          </View>

          {trailing ? (
            <View style={[styles.trailingChip, { backgroundColor: t.bg, borderColor: t.border }]}>
              <Text style={[styles.trailingText, { color: t.accent }]} numberOfLines={1}>
                {trailing}
              </Text>
            </View>
          ) : null}
        </View>
      </TouchableWithoutFeedback>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    left: 12,
    right: 12,
    zIndex: 9999,
    elevation: 20,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    // Dark glass — near-black with subtle tint. Uses the app's common dark
    // card background so the toast feels like a system heads-up notification
    // rather than a loud alert.
    backgroundColor: 'rgba(18, 22, 28, 0.94)',
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 10,
    // Soft drop shadow so the toast floats cleanly over the content below.
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
  },
  iconChip: {
    width: 36,
    height: 36,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  iconText: {
    fontSize: 16,
    fontWeight: '600',
  },
  textCol: {
    flex: 1,
    justifyContent: 'center',
  },
  title: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
  },
  subtitle: {
    color: 'rgba(255, 255, 255, 0.62)',
    fontSize: 12,
    marginTop: 2,
  },
  trailingChip: {
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 4,
    marginLeft: 10,
    maxWidth: 110,
  },
  trailingText: {
    fontSize: 12,
    fontWeight: '700',
  },
});
