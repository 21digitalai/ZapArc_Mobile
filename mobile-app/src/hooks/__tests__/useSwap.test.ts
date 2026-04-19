import { act, renderHook, waitFor } from '@testing-library/react-native';
import { AppState } from 'react-native';

import { useSwap } from '../useSwap';

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

describe('useSwap', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();

    svc.fetchSwapLimits.mockResolvedValue({ min: 100n, max: 1000000n });
    svc.prepareSwap.mockImplementation(async ({ direction, amount, slippageBps }: { direction: string; amount: bigint; slippageBps: number }) => ({
      direction,
      amount,
      slippageBps,
      receiveAmount: amount > 5n ? amount - 5n : amount,
      feeSat: 5n,
      rate: 1,
      preparedPayment: { id: 'prepared' },
    }));
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  it('loads quote after 400ms debounce', async () => {
    const { result } = renderHook(() => useSwap());

    act(() => {
      result.current.setAmountInput('1000');
      jest.advanceTimersByTime(399);
    });

    expect(svc.prepareSwap).not.toHaveBeenCalled();

    act(() => {
      jest.advanceTimersByTime(1);
    });

    await waitFor(() => {
      expect(result.current.state.status).toBe('quoteLoaded');
    });
  });

  it('returns to idle when amount cleared', async () => {
    const { result } = renderHook(() => useSwap());

    act(() => {
      result.current.setAmountInput('1000');
      jest.advanceTimersByTime(400);
    });
    await waitFor(() => expect(result.current.state.status).toBe('quoteLoaded'));

    act(() => {
      result.current.setAmountInput('');
    });

    expect(result.current.state.status).toBe('idle');
  });

  it('sets belowMin state', async () => {
    svc.fetchSwapLimits.mockResolvedValueOnce({ min: 2000n, max: 1000000n });
    const { result } = renderHook(() => useSwap());

    act(() => {
      result.current.setAmountInput('1000');
      jest.advanceTimersByTime(400);
    });

    await waitFor(() => expect(result.current.state.status).toBe('belowMin'));
  });

  it('sets aboveMax state', async () => {
    svc.fetchSwapLimits.mockResolvedValueOnce({ min: 100n, max: 500n });
    const { result } = renderHook(() => useSwap());

    act(() => {
      result.current.setAmountInput('1000');
      jest.advanceTimersByTime(400);
    });

    await waitFor(() => expect(result.current.state.status).toBe('aboveMax'));
  });

  it('sets insufficientBalance when quote exceeds balance', async () => {
    const { result } = renderHook(() => useSwap());

    act(() => {
      result.current.setAvailableBalance(100n);
      result.current.setAmountInput('1000');
      jest.advanceTimersByTime(400);
    });

    await waitFor(() => expect(result.current.state.status).toBe('insufficientBalance'));
  });

  it('supports open and cancel review transitions', async () => {
    const { result } = renderHook(() => useSwap());

    act(() => {
      result.current.setAmountInput('1000');
      jest.advanceTimersByTime(400);
    });
    await waitFor(() => expect(result.current.state.status).toBe('quoteLoaded'));

    act(() => result.current.openReview());
    expect(result.current.state.status).toBe('reviewing');

    act(() => result.current.cancelReview());
    expect(result.current.state.status).toBe('quoteLoaded');
  });

  it('handles successful confirm flow', async () => {
    svc.executeSwap.mockResolvedValueOnce({ kind: 'success', result: { paymentId: 'p1' } });
    const { result } = renderHook(() => useSwap());

    act(() => {
      result.current.setAmountInput('1000');
      jest.advanceTimersByTime(400);
    });
    await waitFor(() => expect(result.current.state.status).toBe('quoteLoaded'));

    act(() => result.current.openReview());

    await act(async () => {
      await result.current.confirmSwap();
    });

    expect(result.current.state.status).toBe('success');
  });

  it('handles dustResidual outcome', async () => {
    svc.executeSwap.mockResolvedValueOnce({
      kind: 'dustResidual',
      result: { paymentId: 'p2' },
      residualUsdbBaseUnits: 7n,
    });
    const { result } = renderHook(() => useSwap());

    act(() => {
      result.current.setAmountInput('1000');
      jest.advanceTimersByTime(400);
    });
    await waitFor(() => expect(result.current.state.status).toBe('quoteLoaded'));

    act(() => result.current.openReview());
    await act(async () => {
      await result.current.confirmSwap();
    });

    expect(result.current.state.status).toBe('dustResidual');
  });

  it('handles refunded outcome and try again transition', async () => {
    svc.executeSwap.mockResolvedValueOnce({ kind: 'refunded' });
    const { result } = renderHook(() => useSwap());

    act(() => {
      result.current.setAmountInput('1000');
      jest.advanceTimersByTime(400);
    });
    await waitFor(() => expect(result.current.state.status).toBe('quoteLoaded'));

    act(() => result.current.openReview());
    await act(async () => {
      await result.current.confirmSwap();
    });

    expect(result.current.state.status).toBe('refunded');

    act(() => {
      result.current.tryRefundedAgain();
    });
    expect(result.current.state.status).toBe('typing');
  });

  it('prevents concurrent confirm', async () => {
    let resolve: ((value: unknown) => void) | null = null;
    svc.executeSwap.mockImplementation(
      () =>
        new Promise((res) => {
          resolve = res;
        })
    );

    const { result } = renderHook(() => useSwap());

    act(() => {
      result.current.setAmountInput('1000');
      jest.advanceTimersByTime(400);
    });
    await waitFor(() => expect(result.current.state.status).toBe('quoteLoaded'));

    act(() => result.current.openReview());

    await act(async () => {
      const first = result.current.confirmSwap();
      const second = result.current.confirmSwap();
      expect(second).resolves.toBeNull();
      resolve?.({ kind: 'refunded' });
      await first;
    });

    expect(svc.executeSwap).toHaveBeenCalledTimes(1);
  });

  it('refresh failure keeps stale quote loaded', async () => {
    svc.prepareSwap
      .mockResolvedValueOnce({
        direction: 'BTC_TO_USDB',
        amount: 1000n,
        slippageBps: 50,
        receiveAmount: 995n,
        feeSat: 5n,
        rate: 1,
        preparedPayment: { id: 'prepared' },
      })
      .mockRejectedValueOnce(new Error('network'));

    const { result } = renderHook(() => useSwap());

    act(() => {
      result.current.setAmountInput('1000');
      jest.advanceTimersByTime(400);
    });
    await waitFor(() => expect(result.current.state.status).toBe('quoteLoaded'));

    act(() => {
      jest.advanceTimersByTime(10000);
    });

    await waitFor(() => expect(result.current.state.status).toBe('quoteLoaded'));
  });

  it('reconciles confirming state on app resume using payment status', async () => {
    svc.executeSwap.mockImplementation(() => new Promise(() => {}));
    svc.listPayments.mockResolvedValueOnce([
      {
        id: 'prepared',
        status: 'completed',
      },
    ]);

    const listeners = new Set<(s: string) => void>();
    const appStateSpy = jest.spyOn(AppState, 'addEventListener').mockImplementation((_, cb) => {
      listeners.add(cb as (s: string) => void);
      return { remove: () => listeners.delete(cb as (s: string) => void) } as unknown as ReturnType<
        typeof AppState.addEventListener
      >;
    });

    const { result } = renderHook(() => useSwap());
    act(() => {
      result.current.setAmountInput('1000');
      jest.advanceTimersByTime(400);
    });
    await waitFor(() => expect(result.current.state.status).toBe('quoteLoaded'));

    act(() => result.current.openReview());
    act(() => {
      void result.current.confirmSwap();
    });

    await waitFor(() => expect(result.current.state.status).toBe('confirming'));

    await act(async () => {
      for (const listener of listeners) {
        listener('active');
      }
    });

    await waitFor(() => expect(result.current.state.status).toBe('success'));
    expect(svc.syncWallet).toHaveBeenCalled();
    appStateSpy.mockRestore();
  });

  it('retry restores preserved amount and direction', async () => {
    svc.executeSwap.mockResolvedValueOnce({
      kind: 'error',
      message: 'timeout',
      retryable: true,
    });

    const { result } = renderHook(() => useSwap());
    act(() => {
      result.current.flipDirection();
      result.current.setAmountInput('2000');
      jest.advanceTimersByTime(400);
    });
    await waitFor(() => expect(result.current.state.status).toBe('quoteLoaded'));

    act(() => result.current.openReview());
    await act(async () => {
      await result.current.confirmSwap();
    });

    expect(result.current.state.status).toBe('error');

    act(() => {
      result.current.retry();
    });

    expect(result.current.state.status).toBe('typing');
    expect(result.current.amountInput).toBe('2000');
    expect(result.current.direction).toBe('USDB_TO_BTC');
  });
});
