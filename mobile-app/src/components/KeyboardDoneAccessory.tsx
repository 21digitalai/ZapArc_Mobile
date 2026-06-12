/**
 * KeyboardDoneAccessory
 *
 * iOS-only "Done" bar that floats above the keyboard, giving a one-tap way to
 * dismiss it. Numeric (decimal-pad / number-pad) and multiline inputs have no
 * return key to dismiss with on iOS, so without this the keyboard is awkward to
 * close. Android has a system back-to-dismiss, so this renders nothing there.
 *
 * Usage:
 *   import { KeyboardDoneAccessory, keyboardDoneAccessoryId } from '...';
 *   <StyledTextInput inputAccessoryViewID={keyboardDoneAccessoryId} ... />
 *   // …render once in the screen:
 *   <KeyboardDoneAccessory />
 */
import React from 'react';
import { InputAccessoryView, View, TouchableOpacity, Platform, Keyboard, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { BRAND_COLOR } from '../utils/theme-helpers';
import { t } from '../services/i18nService';

export const KB_DONE_ACCESSORY_ID = 'kbDoneAccessory';

/** Attach to an input's `inputAccessoryViewID`. Undefined on Android. */
export const keyboardDoneAccessoryId =
  Platform.OS === 'ios' ? KB_DONE_ACCESSORY_ID : undefined;

/**
 * iOS-only accessory id. Pass a UNIQUE id per input when a screen has multiple
 * fields — a single shared InputAccessoryView doesn't always bind to every
 * field, so give each its own id + its own <KeyboardDoneAccessory nativeID=…/>.
 * Returns undefined on Android (no accessory there).
 */
export const iosAccessoryId = (id: string): string | undefined =>
  Platform.OS === 'ios' ? id : undefined;

interface KeyboardDoneAccessoryProps {
  /** nativeID this accessory serves. Defaults to the shared single-field id. */
  nativeID?: string;
}

export function KeyboardDoneAccessory({
  nativeID = KB_DONE_ACCESSORY_ID,
}: KeyboardDoneAccessoryProps = {}): React.JSX.Element | null {
  if (Platform.OS !== 'ios') return null;
  return (
    <InputAccessoryView nativeID={nativeID}>
      <View style={styles.bar}>
        <TouchableOpacity
          onPress={() => Keyboard.dismiss()}
          style={styles.done}
          hitSlop={{ top: 8, bottom: 8, left: 12, right: 12 }}
        >
          <Text style={styles.doneText}>{t('common.done')}</Text>
        </TouchableOpacity>
      </View>
    </InputAccessoryView>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    backgroundColor: '#2a2a40',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255, 255, 255, 0.12)',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  done: {
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  doneText: {
    color: BRAND_COLOR,
    fontSize: 16,
    fontWeight: '700',
  },
});

export default KeyboardDoneAccessory;
