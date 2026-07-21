import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import NetInfo from '@react-native-community/netinfo';
import { AppState } from 'react-native';

import type { SwapDirection, SwapOutcome, SwapQuote, SwapResult } from '../services/breezSparkService';
import { executeSwap, fetchSwapLimits, listPayments, prepareSwap, resolveSwapTokens, syncWallet } from '../services/breezSparkService';
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
  | { status: 'success'; result: SwapResult }
  | { status: 'dustResidual'; result: SwapResult; residualUsdbBaseUnits: bigint }
  | { status: 'refunded'; latestQuote: SwapQuote }
  | { status: 'error'; message: string; retryable: boolean };

const DEFAULT_SLIPPAGE_BPS = 50;
const INPUT_DEBOUNCE_MS = 400;
const REQUOTE_IDLE_MS = 10000;

type UseSwapOptions = {
  authenticate?: () => Promise<boolean>;
};

/**
 * Parse a user-entered amount string to base units, scaling by `decimals` if
 * provided (for USDB-style tokens where "1.5" → 1_500_000 at 6 decimals).
 * `decimals = 0` (default) treats the input as already-integer base units (sats).
 */
function toPositiveBigint(input: string, decimals = 0): bigint | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  // Allow decimal point only when decimals > 0 (USDB side).
  const pattern = decimals > 0 ? /^\d+(\.\d+)?$/ : /^\d+$/;
  if (!pattern.test(trimmed)) return null;
  try {
    if (decimals === 0) {
      const value = BigInt(trimmed);
      return value > 0n ? value : null;
    }
    const [whole, frac = ''] = trimmed.split('.');
    const padded = (frac + '0'.repeat(decimals)).slice(0, decimals);
    const value = BigInt(whole + padded);
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
  // USDB internal decimals — resolved once from the SDK token metadata.
  // Used for user-input parsing ("1.5" → 1_500_000 base units) and for
  // display formatting of the destination card when USDB is the source/dest.
  const [usdbDecimals, setUsdbDecimals] = useState(6);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requoteRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestSeqRef = useRef(0);
  const confirmInFlightRef = useRef(false);
  const lastQuoteRef = useRef<SwapQuote | null>(null);
  const lastInputRef = useRef('');
  const lastDirectionRef = useRef<SwapDirection>(initialDirection);
  const inFlightPaymentIdRef = useRef<string | null>(null);

  // The user's input is in DISPLAY units of the SOURCE currency:
  //   • BTC_TO_USDB → source is sats (integer, no scaling)
  //   • USDB_TO_BTC → source is USDB display (e.g. "1.5"), scaled by 10^decimals
  // amountBaseUnits is always in the source currency's base units so it can
  // be directly compared against fetchSwapLimits's min (which is also in
  // source base units per direction).
  const amountBaseUnits = useMemo(() => {
    const decimals = direction === 'USDB_TO_BTC' ? usdbDecimals : 0;
    return toPositiveBigint(amountInput, decimals);
  }, [amountInput, direction, usdbDecimals]);

  // Guard: only reset state when initialDirection ACTUALLY changes after mount.
  // Without this guard, any parent re-render that passes a new prop reference
  // (even with the same value) would clear the user's input mid-typing.
  const initialDirectionRef = useRef(initialDirection);
  useEffect(() => {
    if (initialDirectionRef.current === initialDirection) return;
    initialDirectionRef.current = initialDirection;
    console.log('🔄 [useSwap] initialDirection changed — resetting', { to: initialDirection });
    setDirectionState(initialDirection);
    lastDirectionRef.current = initialDirection;
    setAmountInput('');
    setState({ status: 'idle' });
    requestSeqRef.current += 1;
  }, [initialDirection]);

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

      if (availableBalance !== null && quote.payAmount > availableBalance) {
        console.log('🔬 [useSwap] quote → insufficientBalance', {
          quoteAmount: quote.amount.toString(),
          payAmount: quote.payAmount.toString(),
          availableBalance: availableBalance.toString(),
          direction,
        });
        setState({ status: 'insufficientBalance', quote });
        return;
      }

      console.log('🔬 [useSwap] quote → quoteLoaded', {
        amount: quote.amount.toString(),
        receiveAmount: quote.receiveAmount.toString(),
        direction,
      });
      lastQuoteRef.current = quote;
      setState({ status: 'quoteLoaded', quote });
    } catch (error) {
      if (seq !== requestSeqRef.current) return;
      setLimitsUnavailable(true);
      // Surface the raw SDK error so we can see what the actual failure is
      // (e.g., minimum pool amount, missing identifier, AMM illiquidity).
      console.error('❌ [useSwap] runQuote failed', {
        name: (error as any)?.name,
        message: (error as any)?.message,
        code: (error as any)?.code,
        variant: (error as any)?.variant,
        raw: error,
      });
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

  // Resolve USDB decimals from the SDK token metadata once. If it fails
  // (offline, SDK unavailable), keep the default of 6 — swap flows will
  // surface an error later anyway when prepareSwap tries to run.
  useEffect(() => {
    let mounted = true;
    void resolveSwapTokens()
      .then((tokens) => {
        const usdb = tokens.find((t) => t.id === 'USDB');
        if (mounted && usdb && Number.isFinite(usdb.internalDecimals)) {
          setUsdbDecimals(usdb.internalDecimals);
        }
      })
      .catch(() => {
        // best-effort — default stays at 6
      });
    return () => {
      mounted = false;
    };
  }, []);

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

  // Stable refs for runQuote + scheduleRequote so the debounce/requote effects
  // below don't re-fire every time those callbacks are recreated (e.g. when
  // availableBalance updates from a wallet refresh). That was causing the
  // Review modal to be wiped mid-review and input to churn during typing.
  const runQuoteRef = useRef(runQuote);
  const scheduleRequoteRef = useRef(scheduleRequote);
  useEffect(() => { runQuoteRef.current = runQuote; }, [runQuote]);
  useEffect(() => { scheduleRequoteRef.current = scheduleRequote; }, [scheduleRequote]);

  // Read state.status via a ref so it's available inside the effect body
  // without being a dep. Having it as a dep caused an infinite loop:
  //   effect runs → setState(typing) → state.status changes → effect re-runs
  //   → setState(typing) again → stomps on state.quoteLoading set by runQuote
  const stateStatusRef = useRef(state.status);
  useEffect(() => { stateStatusRef.current = state.status; }, [state.status]);

  useEffect(() => {
    // Do NOT re-quote or flip to typing when the user is actively reviewing or
    // confirming — that would wipe the modal's displayed quote.
    if (stateStatusRef.current === 'reviewing' || stateStatusRef.current === 'confirming') return;

    if (!amountBaseUnits) {
      requestSeqRef.current += 1;
      setState({ status: 'idle' });
      return;
    }

    setState({ status: 'typing' });
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      void runQuoteRef.current(false);
    }, INPUT_DEBOUNCE_MS);

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
    };
    // Intentionally omit runQuote + state.status from deps — refs keep them current.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [amountBaseUnits, direction, slippageBps]);

  useEffect(() => {
    // Only the fully-settled quoteLoaded state schedules auto-refreshes.
    // Reviewing/confirming/terminal states must freeze the quote.
    if (state.status === 'quoteLoaded') {
      scheduleRequoteRef.current();
      return;
    }

    if (requoteRef.current) {
      clearTimeout(requoteRef.current);
      requoteRef.current = null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.status]);

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
    lastInputRef.current = amountInput;
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
  }, [amountInput, options, state]);

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
    usdbDecimals,
    availableBalance,
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
