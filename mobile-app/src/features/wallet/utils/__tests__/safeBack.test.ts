import {
  completeProtectedWalletFlow,
  createSafeBackHandler,
  type SafeBackRouter,
  type WalletCompletionRouter,
} from '../safeBack';

function router(canGoBack: boolean): jest.Mocked<SafeBackRouter> {
  return {
    canGoBack: jest.fn(() => canGoBack),
    back: jest.fn(),
    replace: jest.fn(),
  };
}

function completionRouter(canDismiss = true): jest.Mocked<WalletCompletionRouter> {
  return {
    canDismiss: jest.fn(() => canDismiss),
    dismissAll: jest.fn(),
    replace: jest.fn(),
  };
}

describe('createSafeBackHandler', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('pops usable navigation history', () => {
    const navigation = router(true);
    const goBack = createSafeBackHandler(navigation, '/wallet/home');

    expect(goBack()).toBe(true);
    expect(navigation.back).toHaveBeenCalledTimes(1);
    expect(navigation.replace).not.toHaveBeenCalled();
  });

  it('replaces the logical parent when history is unavailable', () => {
    const navigation = router(false);
    const goBack = createSafeBackHandler(navigation, '/wallet/settings');

    expect(goBack()).toBe(true);
    expect(navigation.replace).toHaveBeenCalledWith('/wallet/settings');
    expect(navigation.back).not.toHaveBeenCalled();
  });

  it('returns a non-root wallet menu to Wallet Home when Android history is unavailable', () => {
    const navigation = router(false);
    const androidBack = createSafeBackHandler(navigation, '/wallet/home');

    expect(androidBack()).toBe(true);
    expect(navigation.replace).toHaveBeenCalledWith('/wallet/home');
  });

  it('returns an address-book child to its list when Android history is unavailable', () => {
    const navigation = router(false);
    const androidBack = createSafeBackHandler(navigation, '/wallet/settings/address-book');

    expect(androidBack()).toBe(true);
    expect(navigation.replace).toHaveBeenCalledWith('/wallet/settings/address-book');
  });

  it('returns a nested payment flow to Send when its stack is unavailable', () => {
    const navigation = router(false);
    const goBack = createSafeBackHandler(navigation, '/wallet/send');

    expect(goBack()).toBe(true);
    expect(navigation.replace).toHaveBeenCalledWith('/wallet/send');
  });

  it('suppresses duplicate back events until the transition settles', () => {
    const navigation = router(false);
    const goBack = createSafeBackHandler(navigation, '/wallet/home');

    goBack();
    expect(goBack()).toBe(true);
    expect(navigation.replace).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(300);
    expect(goBack()).toBe(true);
    expect(navigation.replace).toHaveBeenCalledTimes(2);
  });

  it('preserves the Wallet Home root exit policy', () => {
    const navigation = router(false);
    const goBack = createSafeBackHandler(navigation, '/wallet/home', { isRoot: true });

    expect(goBack()).toBe(false);
    expect(navigation.back).not.toHaveBeenCalled();
    expect(navigation.replace).not.toHaveBeenCalled();
  });
});

describe('completeProtectedWalletFlow', () => {
  it('pops a populated wallet stack before replacing its root with home', () => {
    const navigation = completionRouter();

    completeProtectedWalletFlow(navigation);

    expect(navigation.dismissAll).toHaveBeenCalledTimes(1);
    expect(navigation.replace).toHaveBeenCalledWith('/wallet/home');
    expect(navigation.dismissAll.mock.invocationCallOrder[0]).toBeLessThan(
      navigation.replace.mock.invocationCallOrder[0],
    );
  });

  it('replaces home without dismissing when the protected flow is already at its root', () => {
    const navigation = completionRouter(false);

    completeProtectedWalletFlow(navigation);

    expect(navigation.canDismiss).toHaveBeenCalledTimes(1);
    expect(navigation.dismissAll).not.toHaveBeenCalled();
    expect(navigation.replace).toHaveBeenCalledWith('/wallet/home');
  });
});
