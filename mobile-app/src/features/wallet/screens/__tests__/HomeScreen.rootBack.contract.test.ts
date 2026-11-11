import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  completeProtectedWalletFlow,
  createSafeBackHandler,
  type SafeBackRouter,
  type WalletCompletionRouter,
} from '../../utils/safeBack';

function rootRouter(): jest.Mocked<SafeBackRouter> {
  return {
    canGoBack: jest.fn(() => false),
    back: jest.fn(),
    replace: jest.fn(),
  };
}

function completionRouter(): jest.Mocked<WalletCompletionRouter> {
  return {
    canDismiss: jest.fn(() => true),
    dismissAll: jest.fn(),
    replace: jest.fn(),
  };
}

describe('wallet root Android Back contract', () => {
  it('does not install a root BackHandler that would swallow Android default exit', () => {
    const source = readFileSync(resolve('src', 'features', 'wallet', 'screens', 'HomeScreen.tsx'), 'utf8');

    expect(source).not.toContain("BackHandler.addEventListener('hardwareBackPress'");
  });

  it('keeps nested fallback navigation and lets the root defer to Android', () => {
    const nested = rootRouter();
    const root = rootRouter();

    expect(createSafeBackHandler(nested, '/wallet/home')()).toBe(true);
    expect(nested.replace).toHaveBeenCalledWith('/wallet/home');

    expect(createSafeBackHandler(root, '/wallet/home', { isRoot: true })()).toBe(false);
    expect(root.back).not.toHaveBeenCalled();
    expect(root.replace).not.toHaveBeenCalled();
  });

  it('clears protected flow history before exposing the Android-exitable root', () => {
    const navigation = completionRouter();

    completeProtectedWalletFlow(navigation);

    expect(navigation.dismissAll.mock.invocationCallOrder[0]).toBeLessThan(
      navigation.replace.mock.invocationCallOrder[0],
    );
    expect(navigation.replace).toHaveBeenCalledWith('/wallet/home');
  });

  it.each(['WalletCreationScreen.tsx', 'WalletImportScreen.tsx', 'PinEntryScreen.tsx'])(
    '%s uses the protected-flow completion boundary',
    (screen) => {
      const source = readFileSync(resolve('src', 'features', 'wallet', 'screens', screen), 'utf8');

      expect(source).toContain('completeProtectedWalletFlow(router)');
    },
  );
});
