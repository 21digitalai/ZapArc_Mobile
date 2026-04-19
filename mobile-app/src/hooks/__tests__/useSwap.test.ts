import { act, renderHook, waitFor } from '@testing-library/react-native';

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
}));

const svc = jest.requireMock('../../services/breezSparkService') as {
  fetchSwapLimits: jest.Mock;
  prepareSwap: jest.Mock;
  executeSwap: jest.Mock;
};

describe('useSwap', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();

    svc.fetchSwapLimits.mockResolvedValue({ min: 100n, max: 1000000n });
    svc.prepareSwap.mockResolvedValue({
      direction: 'BTC_TO_USDB',
      amount: 1000n,
      slippageBps: 50,
      receiveAmount: 995n,
      feeSat: 5n,
      rate: 1,
      preparedPayment: { id: 'prepared' },
    });
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

    expect(svc.prepareSwap).toHaveBeenCalledTimes(1);
  });

  it('sets belowMin state', async () => {
    svc.fetchSwapLimits.mockResolvedValueOnce({ min: 2000n, max: 1000000n });

    const { result } = renderHook(() => useSwap());

    act(() => {
      result.current.setAmountInput('1000');
      jest.advanceTimersByTime(400);
    });

    await waitFor(() => {
      expect(result.current.state.status).toBe('belowMin');
    });
  });

  it('sets aboveMax state', async () => {
    svc.fetchSwapLimits.mockResolvedValueOnce({ min: 100n, max: 500n });

    const { result } = renderHook(() => useSwap());

    act(() => {
      result.current.setAmountInput('1000');
      jest.advanceTimersByTime(400);
    });

    await waitFor(() => {
      expect(result.current.state.status).toBe('aboveMax');
    });
  });

  it('handles successful confirm flow', async () => {
    svc.executeSwap.mockResolvedValueOnce({
      kind: 'success',
      result: { paymentId: 'p1' },
    });

    const { result } = renderHook(() => useSwap());

    act(() => {
      result.current.setAmountInput('1000');
      jest.advanceTimersByTime(400);
    });

    await waitFor(() => {
      expect(result.current.state.status).toBe('quoteLoaded');
    });

    act(() => {
      result.current.openReview();
    });

    expect(result.current.state.status).toBe('reviewing');

    await act(async () => {
      await result.current.confirmSwap();
    });

    expect(result.current.state.status).toBe('success');
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

    await waitFor(() => {
      expect(result.current.state.status).toBe('quoteLoaded');
    });

    act(() => {
      result.current.openReview();
    });

    await act(async () => {
      const first = result.current.confirmSwap();
      const second = result.current.confirmSwap();
      expect(second).resolves.toBeNull();
      resolve?.({ kind: 'refunded' });
      await first;
    });

    expect(svc.executeSwap).toHaveBeenCalledTimes(1);
    expect(result.current.state.status).toBe('refunded');
  });
});
