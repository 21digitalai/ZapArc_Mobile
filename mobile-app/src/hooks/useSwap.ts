import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import NetInfo from '@react-native-community/netinfo';
import { AppState } from 'react-native';

import type { SwapDirection, SwapOutcome, SwapQuote } from '../services/breezSparkService';
import { executeSwap, fetchSwapLimits, listPayments, prepareSwap, syncWallet } from '../services/breezSparkService';
import { settingsService } from '../services/settingsService';

export type SwapStatus =
  | 'idle'
  | 'typing'
  | 'quoteLoading'
  | 'quoteLoaded'
  | 'quoteRefreshing'
  | 'insufficientBalance'
  | 'belowMin'
  | 'aboveMax'
  | 'reviewing'
  | 'confirming'
  | 'success'
  | 'dustResidual'
  | 'refunded'
  | 'error';

export type SwapState =
  | { status: 'idle' }
  | { status: 'typing' }
  | { status: 'quoteLoading' }
  | { status: 'quoteLoaded'; quote: SwapQuote }
  | { status: 'quoteRefreshing'; quote: SwapQuote }
  | { status: 'insufficientBalance'; quote: SwapQuote }
  | { status: 'belowMin'; min: bigint }
  | { status: 'aboveMax'; max: bigint }
  | { status: 'reviewing'; quote: SwapQuote; authError?: string }
  | { status: 'confirming'; quote: SwapQuote }
  | { status: 'success'; result: { paymentId?: string } }
  | { status: 'dustResidual'; result: { paymentId?: string }; residualUsdbBaseUnits: bigint }
  | { status: 'refunded'; latestQuote: SwapQuote }
  | { status: 'error'; message: string; retryable: boolean };

const DEFAULT_SLIPPAGE_BPS = 50;
const INPUT_DEBOUNCE_MS = 400;
const REQUOTE_IDLE_MS = 10000;

type UseSwapOptions = {
  authenticate?: () => Promise<boolean>;
};

function toPositiveBigint(input: string): bigint | null {
  if (!input.trim()) return null;
  if (!/^\d+$/.test(input.trim())) return null;
  try {
    const value = BigInt(input.trim());
    return value > 0n ? value : null;
  } catch {
    return null;
  }
}

function toPaymentId(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null;
  const id = (value as Record<string, unknown>).id;
  return typeof id === 'string' && id.length > 0 ? id : null;
}

export function useSwap(initialDirection: SwapDirection = 'BTC_TO_USDB', options: UseSwapOptions = {}) {
  const [direction, setDirectionState] = useState<SwapDirection>(initialDirection);
  const [amountInput, setAmountInput] = useState('');
  const [slippageBps, setSlippageBps] = useState(DEFAULT_SLIPPAGE_BPS);
  const [state, setState] = useState<SwapState>({ status: 'idle' });
  const [availableBalance, setAvailableBalance] = useState<bigint | null>(null);
  const [isOffline, setIsOffline] = useState(false);
  const [limitsUnavailable, setLimitsUnavailable] = useState(false);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requoteRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestSeqRef = useRef(0);
  const confirmInFlightRef = useRef(false);
  const lastQuoteRef = useRef<SwapQuote | null>(null);
  const lastInputRef = useRef('');
  const lastDirectionRef = useRef<SwapDirection>(initialDirection);
  const inFlightPaymentIdRef = useRef<string | null>(null);

  const amountBaseUnits = useMemo(() => toPositiveBigint(amountInput), [amountInput]);

  const clearTimers = useCallback(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    if (requoteRef.current) {
      clearTimeout(requoteRef.current);
      requoteRef.current = null;
    }
  }, []);

  const loadSlippage = useCallback(async () => {
    const settings = await settingsService.getSwapSettings();
    setSlippageBps(settings.slippageBps);
  }, []);

  const loadLimits = useCallback(async () => {
    try {
      await fetchSwapLimits(direction);
      setLimitsUnavailable(false);
      return true;
    } catch {
      setLimitsUnavailable(true);
      return false;
    }
  }, [direction]);

  const runQuote = useCallback(async (isRefresh: boolean) => {
    if (!amountBaseUnits) {
      setState({ status: 'idle' });
      return;
    }
    if (isOffline) {
      setState({ status: 'error', message: 'Offline', retryable: true });
      return;
    }

    const seq = ++requestSeqRef.current;
    setState((current) => {
      if (isRefresh && current.status === 'quoteLoaded') {
        return { status: 'quoteRefreshing', quote: current.quote };
      }
      return { status: 'quoteLoading' };
    });

    try {
      const limits = await fetchSwapLimits(direction);
      setLimitsUnavailable(false);
      if (amountBaseUnits < limits.min) {
        if (seq === requestSeqRef.current) setState({ status: 'belowMin', min: limits.min });
        return;
      }
      if (amountBaseUnits > limits.max) {
        if (seq === requestSeqRef.current) setState({ status: 'aboveMax', max: limits.max });
        return;
      }

      const quote = await prepareSwap({ direction, amount: amountBaseUnits, slippageBps });
      if (seq !== requestSeqRef.current) return;

      if (availableBalance !== null && quote.amount > availableBalance) {
        setState({ status: 'insufficientBalance', quote });
        return;
      }

      lastQuoteRef.current = quote;
      setState({ status: 'quoteLoaded', quote });
    } catch (error) {
      if (seq !== requestSeqRef.current) return;
      setLimitsUnavailable(true);
      if (isRefresh && lastQuoteRef.current) {
        setState({ status: 'quoteLoaded', quote: lastQuoteRef.current });
        return;
      }
      setState({
        status: 'error',
        message: error instanceof Error ? error.message : 'Failed to prepare quote',
        retryable: true,
      });
    }
  }, [amountBaseUnits, availableBalance, direction, isOffline, slippageBps]);

  const scheduleRequote = useCallback(() => {
    if (requoteRef.current) clearTimeout(requoteRef.current);
    requoteRef.current = setTimeout(() => {
      void runQuote(true);
    }, REQUOTE_IDLE_MS);
  }, [runQuote]);

  useEffect(() => {
    void loadSlippage();
  }, [loadSlippage]);

  useEffect(() => {
    let mounted = true;
    void NetInfo.fetch().then((state) => {
      if (mounted) setIsOffline(!(state.isConnected ?? true));
    });

    const unsubscribe = NetInfo.addEventListener((next) => {
      const offline = !(next.isConnected ?? true);
      setIsOffline(offline);
    });

    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!amountBaseUnits) {
      requestSeqRef.current += 1;
      setState({ status: 'idle' });
      return;
    }

    setState({ status: 'typing' });
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      void runQuote(false);
    }, INPUT_DEBOUNCE_MS);

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
    };
  }, [amountBaseUnits, direction, runQuote, slippageBps]);

  useEffect(() => {
    if (state.status === 'quoteLoaded') {
      scheduleRequote();
      return;
    }

    if (requoteRef.current) {
      clearTimeout(requoteRef.current);
      requoteRef.current = null;
    }
  }, [scheduleRequote, state]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (nextState) => {
      if (nextState !== 'active' || state.status !== 'confirming') return;

      void (async () => {
        try {
          await syncWallet();
          const payments = await listPayments();
          const paymentId = inFlightPaymentIdRef.current;
          if (!paymentId) return;

          const match = payments.find((payment) => payment.id === paymentId);
          if (!match) return;

          if (match.status === 'completed') {
            setState({ status: 'success', result: { paymentId: match.id } });
            return;
          }
          if (match.status === 'failed') {
            setState({
              status: 'error',
              message: match.failureReason || 'Swap failed',
              retryable: true,
            });
          }
        } catch {
          // Best-effort recovery only, remain in confirming.
        }
      })();
    });

    return () => {
      sub?.remove?.();
    };
  }, [state.status]);

  useEffect(() => {
    return () => clearTimers();
  }, [clearTimers]);

  const setDirection = useCallback((next: SwapDirection) => {
    requestSeqRef.current += 1;
    lastDirectionRef.current = next;
    setDirectionState(next);
    setAmountInput('');
    setState({ status: 'idle' });
  }, []);

  const flipDirection = useCallback(() => {
    setDirection(direction === 'BTC_TO_USDB' ? 'USDB_TO_BTC' : 'BTC_TO_USDB');
  }, [direction, setDirection]);

  const openReview = useCallback(() => {
    if (state.status !== 'quoteLoaded') return;
    setState({ status: 'reviewing', quote: state.quote });
  }, [state]);

  const closeReview = useCallback(() => {
    if (state.status !== 'reviewing') return;
    setState({ status: 'quoteLoaded', quote: state.quote });
  }, [state]);

  const confirmSwap = useCallback(async (): Promise<SwapOutcome | null> => {
    if (state.status !== 'reviewing' || confirmInFlightRef.current) {
      return null;
    }

    if (options.authenticate) {
      const authOk = await options.authenticate();
      if (!authOk) {
        setState({ status: 'reviewing', quote: state.quote, authError: 'Authentication failed' });
        return null;
      }
    }

    confirmInFlightRef.current = true;
    const activeQuote = state.quote;
    lastQuoteRef.current = activeQuote;
    lastInputRef.current = String(activeQuote.amount);
    lastDirectionRef.current = activeQuote.direction;
    inFlightPaymentIdRef.current = toPaymentId(activeQuote.preparedPayment);
    setState({ status: 'confirming', quote: activeQuote });

    try {
      const outcome = await executeSwap(activeQuote);
      if (outcome.kind === 'success') {
        setState({ status: 'success', result: outcome.result });
      } else if (outcome.kind === 'dustResidual') {
        setState({
          status: 'dustResidual',
          result: outcome.result,
          residualUsdbBaseUnits: outcome.residualUsdbBaseUnits,
        });
      } else if (outcome.kind === 'refunded') {
        setState({ status: 'refunded', latestQuote: activeQuote });
      } else {
        setState({ status: 'error', message: outcome.message, retryable: outcome.retryable });
      }
      return outcome;
    } catch (error) {
      setState({
        status: 'error',
        message: error instanceof Error ? error.message : 'Swap failed',
        retryable: true,
      });
      return null;
    } finally {
      confirmInFlightRef.current = false;
    }
  }, [options, state]);

  const retrySwap = useCallback(() => {
    const preservedAmount = lastInputRef.current || amountInput;
    setDirectionState(lastDirectionRef.current);
    if (preservedAmount) {
      setAmountInput(preservedAmount);
      setState({ status: 'typing' });
      return;
    }
    setState({ status: 'idle' });
  }, [amountInput]);

  const tryAgainFromRefund = useCallback(() => {
    if (state.status !== 'refunded') return;
    setAmountInput(String(state.latestQuote.amount));
    setState({ status: 'typing' });
  }, [state]);

  const refreshQuote = useCallback(() => {
    void runQuote(true);
  }, [runQuote]);

  const updateSlippage = useCallback(async (next: number) => {
    const clamped = Math.min(1000, Math.max(1, Math.round(next)));
    setSlippageBps(clamped);
    await settingsService.updateSwapSettings({ slippageBps: clamped });
  }, []);

  return {
    direction,
    amountInput,
    amountBaseUnits,
    slippageBps,
    state,
    isOffline,
    limitsUnavailable,
    setAmount: setAmountInput,
    setAmountInput,
    setAvailableBalance,
    setDirection,
    flipDirection,
    loadLimits,
    retryLimits: loadLimits,
    refreshQuote,
    openReview,
    closeReview,
    cancelReview: closeReview,
    confirmSwap,
    retrySwap,
    retry: retrySwap,
    tryAgainFromRefund,
    tryRefundedAgain: tryAgainFromRefund,
    setSlippageBps: updateSlippage,
    updateSlippage,
  };
}
