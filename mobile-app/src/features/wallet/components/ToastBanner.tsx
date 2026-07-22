// ToastBanner
// Heads-up style toast rendered at the top of the screen. Inspired by the
// Android system heads-up notification: dark glass pill, colored icon chip
// by event tone, compact one-line summary + optional trailing chip.
//
// Replaces the old Paper Snackbar which was a loud full-width green bar at
// the bottom — too much green, low readability, and it sometimes covered
// on-screen controls.

import React, { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, StyleSheet, Text, TouchableWithoutFeedback, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export type ToastTone = 'success' | 'accent' | 'warn' | 'danger' | 'info';

export interface ToastBannerProps {
  visible: boolean;
  onDismiss: () => void;
  /**
   * Changes whenever a visible notification is replaced. This deliberately
   * restarts the display timer without tying it to incidental parent renders.
   */
  revision?: string | number;
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
  /**
   * Where the toast docks. 'top' (default) is best for transactional
   * alerts (payment received, swap done). 'bottom' is better for
   * micro-confirmations near a button the user just tapped — copy-to-
   * clipboard, "Saved", etc. — so the eye doesn't have to travel.
   */
  position?: 'top' | 'bottom';
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
  revision = 0,
  icon = '⚡',
  title,
  subtitle,
  trailing,
  tone = 'success',
  duration = 3500,
  position = 'top',
}: ToastBannerProps): React.JSX.Element | null {
  const insets = useSafeAreaInsets();
  const anim = useRef(new Animated.Value(0)).current;
  const warnPulse = useRef(new Animated.Value(1)).current;
  // Wait for the accessibility preference before starting motion so a device
  // that requests reduced motion never gets even a one-frame pulse.
  const [reduceMotion, setReduceMotion] = useState<boolean | null>(null);
  // `mounted` tracks whether we should render — stays true throughout
  // the exit animation so the animated styles can still apply. Starts
  // false; flipped true the first time `visible` goes true.
  const [mounted, setMounted] = useState(false);
  // Skip the first effect pass when visible=false — otherwise we start
  // a no-op exit timing on mount that can interfere with state.
  const firstRun = useRef(true);

  useEffect(() => {
    let active = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (active) setReduceMotion(enabled);
    });
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => {
      active = false;
      subscription.remove();
    };
  }, []);

  useEffect(() => {
    if (!visible || tone !== 'warn' || reduceMotion !== false) {
      warnPulse.stopAnimation();
      warnPulse.setValue(1);
      return;
    }
    const animation = Animated.loop(Animated.sequence([
      Animated.timing(warnPulse, { toValue: 1.07, duration: 850, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      Animated.timing(warnPulse, { toValue: 1, duration: 850, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
    ]));
    animation.start();
    return () => animation.stop();
  }, [reduceMotion, tone, visible, warnPulse]);

  useEffect(() => {
    if (firstRun.current && !visible) {
      firstRun.current = false;
      return;
    }
    firstRun.current = false;

    if (visible) {
      setMounted(true);
      anim.setValue(0);
      Animated.timing(anim, {
        toValue: 1,
        duration: 260,
        // Back easing overshoots past the resting position — looks great
        // for a top toast dropping in, but on a bottom toast that means
        // briefly jumping ABOVE its rest point and then dropping back down,
        // which makes a later dismissal feel ambiguous. Use a clean
        // ease-out cubic for the bottom variant.
        easing:
          position === 'bottom'
            ? Easing.out(Easing.cubic)
            : Easing.out(Easing.back(1.2)),
        useNativeDriver: true,
      }).start();
      const timer = setTimeout(() => {
        onDismiss();
      }, duration);
      return () => clearTimeout(timer);
    }

    // Exit: fade + slide. The slide direction is set by the translateY
    // interpolation below — top toasts go up, bottom toasts go down.
    Animated.timing(anim, {
      toValue: 0,
      duration: 220,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) setMounted(false);
    });
    return () => {};
  }, [visible, anim, duration, onDismiss, position, revision]);

  if (!mounted) return null;

  const t = TONE_COLORS[tone];

  return (
    <Animated.View
      pointerEvents="box-none"
      style={[
        styles.container,
        position === 'bottom'
          ? {
              // Sit just above the safe-area bottom inset so the toast
              // clears the home indicator on iPhone.
              bottom: insets.bottom + 16,
            }
          : {
              // Pushed below the wallet-selector header so the toast doesn't
              // cover the lock / eye / settings buttons for its 3.5s lifetime.
              top: insets.top + 60,
            },
        {
          opacity: anim,
          transform: [
            {
              // Slide in from a few pixels off the docking edge — top
              // toasts drop down, bottom toasts pop up.
              translateY: anim.interpolate({
                inputRange: [0, 1],
                outputRange: [position === 'bottom' ? 24 : -24, 0],
              }),
            },
            {
              // Subtle scale bump on entry so the pill "lands" rather than
              // appears flat. Staying close to 1 keeps it from feeling
              // cartoonish.
              scale: anim.interpolate({
                inputRange: [0, 1],
                outputRange: [0.96, 1],
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
          <Animated.View
            style={[
              styles.iconChip,
              { backgroundColor: t.bg, borderColor: t.border },
              tone === 'warn' ? { opacity: warnPulse.interpolate({ inputRange: [1, 1.07], outputRange: [0.82, 1] }), transform: [{ scale: warnPulse }] } : null,
            ]}
          >
            <Text style={[styles.iconText, { color: t.accent }]}>{icon}</Text>
          </Animated.View>

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
