/**
 * useKeyboardAwareScroll — manual, cross-platform keyboard avoidance for forms
 * inside a ScrollView.
 *
 * Why manual: iOS never resizes the window for the keyboard, and on Android 15+
 * with edge-to-edge enabled (this app) windowSoftInputMode=adjustResize no
 * longer resizes it either — so KeyboardAvoidingView / adjustResize can't be
 * relied on. Instead we:
 *
 *   1. track the keyboard height ourselves and reserve it as extra
 *      paddingBottom on the scroll content (room to scroll), and
 *   2. scroll the FOCUSED input (via TextInput.State) so its bottom sits just
 *      above the keyboard top — measured in window coordinates, no
 *      measureLayout (Fabric rejects its relative-node argument).
 *
 * iOS uses keyboardWillShow so the scroll tracks the keyboard animation
 * (feels instant); Android has no "will" events, so keyboardDidShow. The
 * auto-scroll only fires on the FIRST show — the iOS predictive/autofill bar
 * re-fires frame events mid-typing, which previously caused jumping. Moving
 * focus between fields while the keyboard is already up is covered by calling
 * `scrollFieldIntoView` from each input's onFocus.
 *
 * Usage:
 *   const kb = useKeyboardAwareScroll();
 *   <ScrollView
 *     ref={kb.scrollRef}
 *     contentContainerStyle={[styles.scrollContent, kb.contentPadding]}
 *     keyboardShouldPersistTaps="handled"
 *     scrollEventThrottle={16}
 *     onScroll={kb.onScroll}
 *   >
 *     <StyledTextInput onFocus={kb.scrollFieldIntoView} ... />
 *   </ScrollView>
 *
 * Screens that render one step at a time (e.g. wizards) can attach
 * `kb.scrollRef` to every step's ScrollView — only the mounted one holds it.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Keyboard,
  Platform,
  TextInput,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type ScrollView,
} from 'react-native';

export interface KeyboardAwareScroll {
  /** Attach to the ScrollView's `ref`. */
  scrollRef: React.RefObject<ScrollView | null>;
  /** Attach to the ScrollView's `onScroll` (with scrollEventThrottle={16}). */
  onScroll: (e: NativeSyntheticEvent<NativeScrollEvent>) => void;
  /** Spread into contentContainerStyle — reserves space under the keyboard. */
  contentPadding: { paddingBottom: number } | null;
  /** Call from each input's onFocus (covers field-to-field moves). */
  scrollFieldIntoView: () => void;
  /** Current keyboard height (0 when hidden), for bespoke layout needs. */
  keyboardHeight: number;
}

export function useKeyboardAwareScroll(options?: {
  /** Gap kept between the field's bottom and the keyboard top (default 16). */
  margin?: number;
  /** Extra padding added beyond the keyboard height (default 24). */
  extraPadding?: number;
}): KeyboardAwareScroll {
  const margin = options?.margin ?? 16;
  const extraPadding = options?.extraPadding ?? 24;

  const scrollRef = useRef<ScrollView | null>(null);
  const scrollOffsetRef = useRef(0);
  const keyboardTopRef = useRef<number | null>(null);
  const keyboardHeightRef = useRef(0);
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  // Generation counter: each new trigger (focus / keyboard event) invalidates
  // the previous trigger's pending correction attempts.
  const scrollAttemptGen = useRef(0);

  /**
   * One measurement + (maybe) scroll. Re-measures the CURRENTLY focused field
   * in window coordinates at call time, so every attempt self-corrects against
   * whatever actually happened (clamped scroll, late layout, focus transfer).
   * No-ops when the field is already visible above the keyboard.
   */
  const attemptScroll = useCallback((animated: boolean) => {
    const sv = scrollRef.current;
    const kbTop = keyboardTopRef.current;
    const input = TextInput.State.currentlyFocusedInput?.();
    if (!sv || kbTop == null || !input) return;
    input.measureInWindow((_x: number, y: number, _w: number, h: number) => {
      // How far the field's bottom (plus a margin) sits below the keyboard top.
      const overlap = y + h + margin - kbTop;
      if (overlap > 2) {
        sv.scrollTo({ y: Math.max(0, scrollOffsetRef.current + overlap), animated });
      }
    });
  }, [margin]);

  /**
   * Converging retry schedule instead of a single shot. Why each attempt:
   *  -  50ms: native focus has transferred (onFocus fires BEFORE
   *           currentlyFocusedInput points at the new field) — animated.
   *  - 250ms: the reserved paddingBottom has committed natively, so scrollTo
   *           is no longer clamped to the old content size (the clamp was why
   *           it "only worked when already scrolled near the bottom").
   *  - 500ms: after every animation has settled — final exact correction.
   * Later attempts are instant (not animated) and no-op when the field is
   * already in place, so at most the user sees one small corrective hop.
   */
  const scrollFieldIntoView = useCallback(() => {
    const gen = ++scrollAttemptGen.current;
    const schedule: Array<[number, boolean]> = [[50, true], [250, false], [500, false]];
    for (const [delay, animated] of schedule) {
      setTimeout(() => {
        if (scrollAttemptGen.current === gen) attemptScroll(animated);
      }, delay);
    }
  }, [attemptScroll]);

  useEffect(() => {
    const showEvt = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvt = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const showSub = Keyboard.addListener(showEvt, (e) => {
      keyboardTopRef.current = e.endCoordinates.screenY;
      keyboardHeightRef.current = e.endCoordinates.height;
      setKeyboardHeight(e.endCoordinates.height);
      // Run on EVERY show/frame event (predictive-bar toggles included):
      // attempts re-measure and no-op when the field is already visible, so
      // this corrects covered fields without re-scroll jitter.
      scrollFieldIntoView();
    });
    const hideSub = Keyboard.addListener(hideEvt, () => {
      keyboardTopRef.current = null;
      keyboardHeightRef.current = 0;
      setKeyboardHeight(0);
      // Cancel any pending attempts from the last trigger.
      scrollAttemptGen.current++;
    });
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, [scrollFieldIntoView]);

  const onScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    scrollOffsetRef.current = e.nativeEvent.contentOffset.y;
  }, []);

  return {
    scrollRef,
    onScroll,
    contentPadding: keyboardHeight > 0 ? { paddingBottom: keyboardHeight + extraPadding } : null,
    scrollFieldIntoView,
    keyboardHeight,
  };
}
