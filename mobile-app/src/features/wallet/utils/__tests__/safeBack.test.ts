import { createSafeBackHandler, type SafeBackRouter } from '../safeBack';

function router(canGoBack: boolean): jest.Mocked<SafeBackRouter> {
  return {
    canGoBack: jest.fn(() => canGoBack),
    back: jest.fn(),
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

  it('suppresses duplicate back events until the transition settles', () => {
    const navigation = router(false);
    const goBack = createSafeBackHandler(navigation, '/wallet/home');

    goBack();
    expect(goBack()).toBe(false);
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
