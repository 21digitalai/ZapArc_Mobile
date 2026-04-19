import { act, renderHook, waitFor } from '@testing-library/react-native';
import NetInfo from '@react-native-community/netinfo';
import { AppState } from 'react-native';

import { useSwap } from '../useSwap';

jest.mock('@react-native-community/netinfo', () => ({
  __esModule: true,
  default: {
    fetch: jest.fn().mockResolvedValue({ isConnected: true }),
    addEventListener: jest.fn(() => jest.fn()),
  },
}));

jest.mock('../../services/settingsService', () => ({
  __esModule: true,
  settingsService: {
    getSwapSettings: jest.fn().mockResolvedValue({ slippageBps: 50 }),
    updateSwapSettings: jest.fn().mockResolvedValue({ slippageBps: 50 }),
  },
}));

jest.mock('../../services/breezSparkService', () => ({
  fetchSwapLimits: jest.fn(),
  prepareSwap: jest.fn(),
  executeSwap: jest.fn(),
  listPayments: jest.fn().mockResolvedValue([]),
  syncWallet: jest.fn().mockResolvedValue(undefined),
}));

const svc = jest.requireMock('../../services/breezSparkService') as {
  fetchSwapLimits: jest.Mock;
  prepareSwap: jest.Mock;
  executeSwap: jest.Mock;
  listPayments: jest.Mock;
  syncWallet: jest.Mock;
};

const netInfo = NetInfo as unknown as {
  fetch: jest.Mock;
  addEventListener: jest.Mock;
};

const baseQuote = {
  direction: 'BTC_TO_USDB',
  amount: 1000n,
  slippageBps: 50,
  receiveAmount: 995n,
  feeSat: 5n,
  rate: 1,
  preparedPayment: { id: 'prepared' },
};

describe('useSwap', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    netInfo.fetch.mockResolvedValue({ isConnected: true });
    netInfo.addEventListener.mockImplementation(() => jest.fn());

    svc.fetchSwapLimits.mockResolvedValue({ min: 100n, max: 1000000n });
    svc.prepareSwap.mockImplementation(async ({ direction, amount, slippageBps }: { direction: string; amount: bigint; slippageBps: number }) => ({
      ...baseQuote,
      direction,
      amount,
      slippageBps,
      receiveAmount: amount > 5n ? amount - 5n : amount,
    }));
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  async function quote(result: any, amount = '1000') {
    act(() => {
      result.current.setAmount(amount);
      jest.advanceTimersByTime(400);
    });
    await waitFor(() => expect(result.current.state.status).toBe('quoteLoaded'));
  }

  it('initial state is idle', () => {
    const { result } = renderHook(() => useSwap());
    expect(result.current.state.status).toBe('idle');
  });

  it('initial direction defaults to BTC_TO_USDB', () => {
    const { result } = renderHook(() => useSwap());
    expect(result.current.direction).toBe('BTC_TO_USDB');
  });

  it('initial direction can be overridden', () => {
    const { result } = renderHook(({ direction }: { direction: 'BTC_TO_USDB' | 'USDB_TO_BTC' }) => useSwap(direction), {
      initialProps: { direction: 'USDB_TO_BTC' as const },
    });
    expect(result.current.direction).toBe('USDB_TO_BTC');
  });

  it('syncs direction when initialDirection prop changes', () => {
    const { result, rerender } = renderHook(({ direction }: { direction: 'BTC_TO_USDB' | 'USDB_TO_BTC' }) => useSwap(direction), {
      initialProps: { direction: 'BTC_TO_USDB' as const },
    });

    expect(result.current.direction).toBe('BTC_TO_USDB');

    rerender({ direction: 'USDB_TO_BTC' });

    expect(result.current.direction).toBe('USDB_TO_BTC');
  });

  it('debounces amount input by 400ms before quote', async () => {
    const { result } = renderHook(() => useSwap());
    act(() => {
      result.current.setAmount('1000');
      jest.advanceTimersByTime(399);
    });
    expect(svc.prepareSwap).not.toHaveBeenCalled();
    act(() => jest.advanceTimersByTime(1));
    await waitFor(() => expect(result.current.state.status).toBe('quoteLoaded'));
  });

  it('amount clear returns to idle', async () => {
    const { result } = renderHook(() => useSwap());
    await quote(result);
    act(() => result.current.setAmount(''));
    expect(result.current.state.status).toBe('idle');
  });

  it('below min transitions', async () => {
    svc.fetchSwapLimits.mockResolvedValueOnce({ min: 2000n, max: 1000000n });
    const { result } = renderHook(() => useSwap());
    act(() => {
      result.current.setAmount('1000');
      jest.advanceTimersByTime(400);
    });
    await waitFor(() => expect(result.current.state.status).toBe('belowMin'));
  });

  it('above max transitions', async () => {
    svc.fetchSwapLimits.mockResolvedValueOnce({ min: 100n, max: 500n });
    const { result } = renderHook(() => useSwap());
    act(() => {
      result.current.setAmount('1000');
      jest.advanceTimersByTime(400);
    });
    await waitFor(() => expect(result.current.state.status).toBe('aboveMax'));
  });

  it('insufficient balance transitions', async () => {
    const { result } = renderHook(() => useSwap());
    act(() => {
      result.current.setAvailableBalance(100n);
      result.current.setAmount('1000');
      jest.advanceTimersByTime(400);
    });
    await waitFor(() => expect(result.current.state.status).toBe('insufficientBalance'));
  });

  it('flipDirection clears amount and returns idle', async () => {
    const { result } = renderHook(() => useSwap());
    await quote(result);
    act(() => result.current.flipDirection());
    expect(result.current.state.status).toBe('idle');
    expect(result.current.amountInput).toBe('');
    expect(result.current.direction).toBe('USDB_TO_BTC');
  });

  it('amount changed from quoteLoaded returns typing', async () => {
    const { result } = renderHook(() => useSwap());
    await quote(result);
    act(() => result.current.setAmount('2000'));
    expect(result.current.state.status).toBe('typing');
  });

  it('amount changed from quoteRefreshing returns typing', async () => {
    const { result } = renderHook(() => useSwap());
    await quote(result);
    act(() => jest.advanceTimersByTime(10000));
    await waitFor(() => expect(result.current.state.status).toBe('quoteRefreshing'));
    act(() => result.current.setAmount('2000'));
    expect(result.current.state.status).toBe('typing');
  });

  it('amount changed from belowMin returns typing', async () => {
    svc.fetchSwapLimits.mockResolvedValueOnce({ min: 2000n, max: 1000000n });
    const { result } = renderHook(() => useSwap());
    act(() => {
      result.current.setAmount('1000');
      jest.advanceTimersByTime(400);
    });
    await waitFor(() => expect(result.current.state.status).toBe('belowMin'));
    act(() => result.current.setAmount('3000'));
    expect(result.current.state.status).toBe('typing');
  });

  it('amount changed from aboveMax returns typing', async () => {
    svc.fetchSwapLimits.mockResolvedValueOnce({ min: 100n, max: 500n });
    const { result } = renderHook(() => useSwap());
    act(() => {
      result.current.setAmount('1000');
      jest.advanceTimersByTime(400);
    });
    await waitFor(() => expect(result.current.state.status).toBe('aboveMax'));
    act(() => result.current.setAmount('400'));
    expect(result.current.state.status).toBe('typing');
  });

  it('amount changed from insufficientBalance returns typing', async () => {
    const { result } = renderHook(() => useSwap());
    act(() => {
      result.current.setAvailableBalance(100n);
      result.current.setAmount('1000');
      jest.advanceTimersByTime(400);
    });
    await waitFor(() => expect(result.current.state.status).toBe('insufficientBalance'));
    act(() => result.current.setAmount('50'));
    expect(result.current.state.status).toBe('typing');
  });

  it('slippage change requotes', async () => {
    const { result } = renderHook(() => useSwap());
    await quote(result);
    act(() => {
      void result.current.setSlippageBps(75);
      jest.advanceTimersByTime(400);
    });
    await waitFor(() => expect(svc.prepareSwap).toHaveBeenLastCalledWith(expect.objectContaining({ slippageBps: 75 })));
  });

  it('openReview transitions to reviewing', async () => {
    const { result } = renderHook(() => useSwap());
    await quote(result);
    act(() => result.current.openReview());
    expect(result.current.state.status).toBe('reviewing');
  });

  it('closeReview returns to quoteLoaded', async () => {
    const { result } = renderHook(() => useSwap());
    await quote(result);
    act(() => result.current.openReview());
    act(() => result.current.closeReview());
    expect(result.current.state.status).toBe('quoteLoaded');
  });

  it('confirm auth failure stays reviewing with auth error', async () => {
    const { result } = renderHook(() => useSwap('BTC_TO_USDB', { authenticate: jest.fn().mockResolvedValue(false) }));
    await quote(result);
    act(() => result.current.openReview());
    await act(async () => {
      await result.current.confirmSwap();
    });
    expect(result.current.state.status).toBe('reviewing');
    expect((result.current.state as { authError?: string }).authError).toBeTruthy();
  });

  it('confirm auth success transitions to confirming then success', async () => {
    svc.executeSwap.mockResolvedValueOnce({ kind: 'success', result: { paymentId: 'p1' } });
    const { result } = renderHook(() => useSwap('BTC_TO_USDB', { authenticate: jest.fn().mockResolvedValue(true) }));
    await quote(result);
    act(() => result.current.openReview());
    await act(async () => {
      await result.current.confirmSwap();
    });
    expect(result.current.state.status).toBe('success');
  });

  it('confirm ignores second call while in flight', async () => {
    let resolve: ((value: unknown) => void) | null = null;
    svc.executeSwap.mockImplementation(() => new Promise((res) => { resolve = res; }));
    const { result } = renderHook(() => useSwap());
    await quote(result);
    act(() => result.current.openReview());

    await act(async () => {
      const first = result.current.confirmSwap();
      const second = result.current.confirmSwap();
      await expect(second).resolves.toBeNull();
      resolve?.({ kind: 'refunded' });
      await first;
    });

    expect(svc.executeSwap).toHaveBeenCalledTimes(1);
  });

  it('confirm success transitions to success', async () => {
    svc.executeSwap.mockResolvedValueOnce({ kind: 'success', result: { paymentId: 'ok' } });
    const { result } = renderHook(() => useSwap());
    await quote(result);
    act(() => result.current.openReview());
    await act(async () => void (await result.current.confirmSwap()));
    expect(result.current.state.status).toBe('success');
  });

  it('confirm dust transitions to dustResidual', async () => {
    svc.executeSwap.mockResolvedValueOnce({ kind: 'dustResidual', result: { paymentId: 'd' }, residualUsdbBaseUnits: 1n });
    const { result } = renderHook(() => useSwap());
    await quote(result);
    act(() => result.current.openReview());
    await act(async () => void (await result.current.confirmSwap()));
    expect(result.current.state.status).toBe('dustResidual');
  });

  it('confirm refund transitions to refunded', async () => {
    svc.executeSwap.mockResolvedValueOnce({ kind: 'refunded' });
    const { result } = renderHook(() => useSwap());
    await quote(result);
    act(() => result.current.openReview());
    await act(async () => void (await result.current.confirmSwap()));
    expect(result.current.state.status).toBe('refunded');
  });

  it('confirm timeout/error transitions to error retryable', async () => {
    svc.executeSwap.mockResolvedValueOnce({ kind: 'error', message: 'timeout', retryable: true });
    const { result } = renderHook(() => useSwap());
    await quote(result);
    act(() => result.current.openReview());
    await act(async () => void (await result.current.confirmSwap()));
    expect(result.current.state.status).toBe('error');
    expect((result.current.state as { retryable: boolean }).retryable).toBe(true);
  });

  it('limits fetch failure marks limitsUnavailable and retry clears it', async () => {
    svc.fetchSwapLimits.mockRejectedValueOnce(new Error('limits down'));
    const { result } = renderHook(() => useSwap());
    act(() => {
      result.current.setAmount('1000');
      jest.advanceTimersByTime(400);
    });
    await waitFor(() => expect(result.current.limitsUnavailable).toBe(true));

    svc.fetchSwapLimits.mockResolvedValueOnce({ min: 1n, max: 1000n });
    await act(async () => {
      await result.current.retryLimits();
    });
    expect(result.current.limitsUnavailable).toBe(false);
  });

  it('retrySwap preserves last amount and direction', async () => {
    svc.executeSwap.mockResolvedValueOnce({ kind: 'error', message: 'oops', retryable: true });
    const { result } = renderHook(() => useSwap('USDB_TO_BTC'));
    await quote(result, '2000');
    act(() => result.current.openReview());
    await act(async () => void (await result.current.confirmSwap()));
    act(() => result.current.retrySwap());
    expect(result.current.direction).toBe('USDB_TO_BTC');
    expect(result.current.amountInput).toBe('2000');
  });

  it('tryAgainFromRefund preserves amount and requotes', async () => {
    svc.executeSwap.mockResolvedValueOnce({ kind: 'refunded' });
    const { result } = renderHook(() => useSwap());
    await quote(result);
    act(() => result.current.openReview());
    await act(async () => void (await result.current.confirmSwap()));
    act(() => result.current.tryAgainFromRefund());
    expect(result.current.state.status).toBe('typing');
  });

  it('quote refresh timer fires after 10 seconds', async () => {
    const { result } = renderHook(() => useSwap());
    await quote(result);
    act(() => jest.advanceTimersByTime(10000));
    await waitFor(() => expect(result.current.state.status).toBe('quoteRefreshing'));
  });

  it('app background while confirming keeps confirming until resume resolution', async () => {
    svc.executeSwap.mockImplementation(() => new Promise(() => {}));
    const listeners = new Set<(s: string) => void>();
    const appStateSpy = jest.spyOn(AppState, 'addEventListener').mockImplementation((_, cb) => {
      listeners.add(cb as (s: string) => void);
      return { remove: () => listeners.delete(cb as (s: string) => void) } as unknown as ReturnType<typeof AppState.addEventListener>;
    });

    const { result } = renderHook(() => useSwap());
    await quote(result);
    act(() => result.current.openReview());
    act(() => {
      void result.current.confirmSwap();
    });
    await waitFor(() => expect(result.current.state.status).toBe('confirming'));

    await act(async () => {
      listeners.forEach((cb) => cb('background'));
    });

    expect(result.current.state.status).toBe('confirming');
    appStateSpy.mockRestore();
  });

  it('app resumed while confirming syncs wallet and resolves terminal state', async () => {
    svc.executeSwap.mockImplementation(() => new Promise(() => {}));
    svc.listPayments.mockResolvedValueOnce([{ id: 'prepared', status: 'completed' }]);

    const listeners = new Set<(s: string) => void>();
    const appStateSpy = jest.spyOn(AppState, 'addEventListener').mockImplementation((_, cb) => {
      listeners.add(cb as (s: string) => void);
      return { remove: () => listeners.delete(cb as (s: string) => void) } as unknown as ReturnType<typeof AppState.addEventListener>;
    });

    const { result } = renderHook(() => useSwap());
    await quote(result);
    act(() => result.current.openReview());
    act(() => {
      void result.current.confirmSwap();
    });
    await waitFor(() => expect(result.current.state.status).toBe('confirming'));

    await act(async () => {
      listeners.forEach((cb) => cb('active'));
    });

    await waitFor(() => expect(result.current.state.status).toBe('success'));
    expect(svc.syncWallet).toHaveBeenCalled();
    appStateSpy.mockRestore();
  });

  it('offline on mount sets offline flag', async () => {
    netInfo.fetch.mockResolvedValueOnce({ isConnected: false });
    const { result } = renderHook(() => useSwap());
    await waitFor(() => expect(result.current.isOffline).toBe(true));
  });

  it('netinfo online event clears offline flag', async () => {
    let listener: ((state: { isConnected: boolean }) => void) | null = null;
    netInfo.addEventListener.mockImplementation((cb: (s: { isConnected: boolean }) => void) => {
      listener = cb;
      return jest.fn();
    });

    const { result } = renderHook(() => useSwap());
    act(() => listener?.({ isConnected: false }));
    expect(result.current.isOffline).toBe(true);

    act(() => listener?.({ isConnected: true }));
    expect(result.current.isOffline).toBe(false);
  });
});
