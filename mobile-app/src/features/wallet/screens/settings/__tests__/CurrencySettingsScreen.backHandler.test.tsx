import React from 'react';
import { BackHandler, View } from 'react-native';
import { render } from '@testing-library/react-native';
import { CurrencySettingsScreen } from '../CurrencySettingsScreen';

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
}));

jest.mock('expo-router', () => ({
  router: {
    back: jest.fn(),
    canGoBack: jest.fn(() => false),
    replace: jest.fn(),
  },
  useFocusEffect: (effect: () => void | (() => void)) => effect(),
}));

jest.mock('expo-linear-gradient', () => ({
  LinearGradient: ({ children }: { children: React.ReactNode }) => children,
}));

jest.mock('react-native-paper', () => ({
  Text: ({ children }: { children: React.ReactNode }) => children,
  RadioButton: {
    Group: ({ children }: { children: React.ReactNode }) => children,
    Item: () => null,
    Android: () => null,
  },
  IconButton: () => null,
}));

jest.mock('../../../../../hooks/useSettings', () => ({
  useSettings: () => ({ settings: null, updateSettings: jest.fn() }),
}));

jest.mock('../../../../../hooks/useLanguage', () => ({
  useLanguage: () => ({ t: (key: string) => key }),
}));

jest.mock('../../../components/FeedbackComponents', () => ({
  useFeedback: () => ({ showError: jest.fn() }),
}));

jest.mock('../../../../../contexts/ThemeContext', () => ({
  useAppTheme: () => ({ themeMode: 'light' }),
}));

jest.mock('../../../../../utils/theme-helpers', () => ({
  BRAND_COLOR: '#000',
  getGradientColors: () => ['#000', '#fff'],
  getPrimaryTextColor: () => '#000',
  getSecondaryTextColor: () => '#666',
}));

describe('CurrencySettingsScreen Android back handling', () => {
  const navigation = require('expo-router').router;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  function captureHandler(canGoBack: boolean): () => boolean {
    navigation.canGoBack.mockReturnValue(canGoBack);
    const addListener = jest.spyOn(BackHandler, 'addEventListener').mockReturnValue({ remove: jest.fn() });

    render(React.createElement(View, null, React.createElement(CurrencySettingsScreen)));

    const handler = addListener.mock.calls
      .find(([eventName]) => eventName === 'hardwareBackPress')?.[1];
    expect(handler).toBeDefined();
    return handler as () => boolean;
  }

  it('consumes rapid hardware-back events and pops only once when history exists', () => {
    const handler = captureHandler(true);

    expect(handler()).toBe(true);
    expect(handler()).toBe(true);
    expect(navigation.back).toHaveBeenCalledTimes(1);
    expect(navigation.replace).not.toHaveBeenCalled();
  });

  it('consumes rapid hardware-back events and replaces Settings only once without history', () => {
    const handler = captureHandler(false);

    expect(handler()).toBe(true);
    expect(handler()).toBe(true);
    expect(navigation.replace).toHaveBeenCalledWith('/wallet/settings');
    expect(navigation.replace).toHaveBeenCalledTimes(1);
    expect(navigation.back).not.toHaveBeenCalled();
  });
});
