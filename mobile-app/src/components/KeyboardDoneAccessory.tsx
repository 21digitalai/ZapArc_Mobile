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

export function KeyboardDoneAccessory(): React.JSX.Element | null {
  if (Platform.OS !== 'ios') return null;
  return (
    <InputAccessoryView nativeID={KB_DONE_ACCESSORY_ID}>
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
