import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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

export function useSwap(initialDirection: SwapDirection = 'BTC_TO_USDB') {
  const [direction, setDirection] = useState<SwapDirection>(initialDirection);
  const [amountInput, setAmountInput] = useState('');
  const [slippageBps, setSlippageBps] = useState(DEFAULT_SLIPPAGE_BPS);
  const [state, setState] = useState<SwapState>({ status: 'idle' });
  const [availableBalance, setAvailableBalance] = useState<bigint | null>(null);

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

  const runQuote = useCallback(async (isRefresh: boolean) => {
    if (!amountBaseUnits) {
      setState({ status: 'idle' });
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
  }, [amountBaseUnits, availableBalance, direction, slippageBps]);

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

  const flipDirection = useCallback(() => {
    requestSeqRef.current += 1;
    setDirection((current) => {
      const next = current === 'BTC_TO_USDB' ? 'USDB_TO_BTC' : 'BTC_TO_USDB';
      lastDirectionRef.current = next;
      return next;
    });
    setAmountInput('');
    setState({ status: 'idle' });
  }, []);

  const openReview = useCallback(() => {
    if (state.status !== 'quoteLoaded') return;
    setState({ status: 'reviewing', quote: state.quote });
  }, [state]);

  const cancelReview = useCallback(() => {
    if (state.status !== 'reviewing') return;
    setState({ status: 'quoteLoaded', quote: state.quote });
  }, [state]);

  const confirmSwap = useCallback(async (): Promise<SwapOutcome | null> => {
    if (state.status !== 'reviewing' || confirmInFlightRef.current) {
      return null;
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
  }, [state]);

  const retry = useCallback(() => {
    const preservedAmount = lastInputRef.current || amountInput;
    setDirection(lastDirectionRef.current);
    if (preservedAmount) {
      setAmountInput(preservedAmount);
      setState({ status: 'typing' });
      return;
    }
    setState({ status: 'idle' });
  }, [amountInput]);

  const tryRefundedAgain = useCallback(() => {
    if (state.status !== 'refunded') return;
    setAmountInput(String(state.latestQuote.amount));
    setState({ status: 'typing' });
  }, [state]);

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
    setAmountInput,
    setAvailableBalance,
    setDirection,
    flipDirection,
    openReview,
    cancelReview,
    confirmSwap,
    retry,
    tryRefundedAgain,
    updateSlippage,
  };
}
