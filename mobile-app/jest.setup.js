import mockAsyncStorage from '@react-native-async-storage/async-storage/jest/async-storage-mock';

jest.mock('@react-native-async-storage/async-storage', () => mockAsyncStorage);
jest.mock('react-native-quick-crypto', () => {
  const subtleDigest = jest.fn(async (_algorithm, data) => data);
  const deriveBits = jest.fn(async () => new ArrayBuffer(32));

  return {
    __esModule: true,
    default: {
      pbkdf2Sync: jest.fn(() => Buffer.alloc(32, 1)),
      createCipheriv: jest.fn(() => ({
        update: jest.fn(() => Buffer.alloc(0)),
        final: jest.fn(() => Buffer.alloc(0)),
        getAuthTag: jest.fn(() => Buffer.alloc(16, 2)),
      })),
      createDecipheriv: jest.fn(() => ({
        setAuthTag: jest.fn(),
        update: jest.fn(() => Buffer.alloc(0)),
        final: jest.fn(() => Buffer.alloc(0)),
      })),
      webcrypto: {
        subtle: {
          digest: subtleDigest,
          importKey: jest.fn(async () => ({})),
          deriveBits,
        },
      },
    },
  };
});

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
