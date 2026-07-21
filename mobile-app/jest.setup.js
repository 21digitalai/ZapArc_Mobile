import mockAsyncStorage from '@react-native-async-storage/async-storage/jest/async-storage-mock';

jest.mock('@react-native-async-storage/async-storage', () => mockAsyncStorage);
jest.mock('react-native-quick-crypto', () => {
  const crypto = require('crypto');

  return {
    __esModule: true,
    default: crypto,
  };
});

// Native modules are unavailable in Jest's Node runtime. Individual service
// tests provide their own richer SDK doubles when they exercise Breez calls.
jest.mock('@breeztech/breez-sdk-spark-react-native', () => ({
  __esModule: true,
  default: {},
  ConversionType: {},
  SendPaymentOptions: {},
  OnchainConfirmationSpeed: {},
}));

jest.mock('react-native-fs', () => ({
  DocumentDirectoryPath: '/tmp',
  exists: jest.fn(async () => false),
  readFile: jest.fn(async () => ''),
  writeFile: jest.fn(async () => undefined),
  unlink: jest.fn(async () => undefined),
}));

jest.mock('@react-native-google-signin/google-signin', () => ({
  GoogleSignin: {
    configure: jest.fn(),
    hasPlayServices: jest.fn(async () => true),
    signIn: jest.fn(async () => ({})),
    signOut: jest.fn(async () => undefined),
  },
  statusCodes: {},
}));

// Polyfill for crypto.getRandomValues
if (typeof global.crypto !== 'object') {
  global.crypto = {};
}
if (typeof global.crypto.getRandomValues !== 'function') {
  global.crypto.getRandomValues = (buffer) => {
    for (let i = 0; i < buffer.length; i++) {
      buffer[i] = Math.floor(Math.random() * 256);
    }
    return buffer;
  };
}

// Mock fetch
global.fetch = jest.fn(() =>
  Promise.resolve({
    ok: true,
    json: () => Promise.resolve({ status: 'success', countryCode: 'US', lat: 0, lon: 0 }),
  })
);

// Mock @expo/vector-icons
jest.mock('@expo/vector-icons', () => ({
  MaterialCommunityIcons: 'MaterialCommunityIcons',
  Ionicons: 'Ionicons',
  Feather: 'Feather',
  FontAwesome: 'FontAwesome',
}));

// Mock expo-font
jest.mock('expo-font', () => ({
  isLoaded: jest.fn(() => true),
  loadAsync: jest.fn(() => Promise.resolve()),
}));

// Mock expo-asset
jest.mock('expo-asset', () => ({
  Asset: {
    fromModule: jest.fn(() => ({
      downloadAsync: jest.fn(),
      localUri: 'test-uri',
    })),
  },
}));

// Mock ThemeContext
jest.mock('./src/contexts/ThemeContext', () => ({
  ThemeProvider: ({ children }) => children,
  useAppTheme: jest.fn().mockReturnValue({
    themeMode: 'light',
    toggleTheme: jest.fn(),
  }),
}));
