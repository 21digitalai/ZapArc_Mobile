import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { View, StyleSheet, ScrollView, Alert, TouchableOpacity, FlatList, InputAccessoryView, Keyboard, Platform, BackHandler } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Text, Button, IconButton } from 'react-native-paper';
import { StyledTextInput } from '../../src/components';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import {
  getGradientColors,
  getPrimaryTextColor,
  getSecondaryTextColor,
  BRAND_COLOR,
} from '../../src/utils/theme-helpers';
import { useAppTheme } from '../../src/contexts/ThemeContext';
import { CameraView, useCameraPermissions, BarcodeScanningResult } from 'expo-camera';
import { useWallet } from '../../src/hooks/useWallet';
import { BreezSparkService, type CrossChainDestinationRoute } from '../../src/services/breezSparkService';
import { SWAP_FEATURE_ENABLED, MULTI_ASSET_UI_ENABLED, CROSS_CHAIN_SEND_ENABLED } from '../../src/config/features';
import { useCurrency } from '../../src/hooks/useCurrency';
import { formatFiat, satsToFiat, usdbToFiat, fiatToUsdb } from '../../src/utils/currency';
import { cycleDisplayCurrency, type DisplayCurrency } from '../../src/services/displayCurrencyService';
import { useLightningAddress } from '../../src/hooks/useLightningAddress';
import { useKeyboardAwareScroll } from '../../src/hooks/useKeyboardAwareScroll';
import { getAssetMeta, getAllAssets } from '../../src/features/wallet/registry/assetRegistry';
import { CurrencyPickerSheet, type PickerCurrency } from '../../src/features/wallet/components/CurrencyPickerSheet';
import { useContacts } from '../../src/features/addressBook/hooks/useContacts';
import { ContactSelectionModal } from '../../src/features/addressBook/components/ContactSelectionModal';
import { Contact } from '../../src/features/addressBook/types';
import { normalizeLightningAddress } from '../../src/features/addressBook/services/contactValidator';
import { contactDisplayName } from '../../src/features/addressBook/utils/contactDisplay';
import { t } from '../../src/services/i18nService';

function isValidBitcoinAddress(address: string): boolean {
  // Bech32 (native segwit): bc1q... or bc1p... (taproot)
  if (/^bc1[qpzry9x8gf2tvdw0s3jn54khce6mua7l]{25,87}$/i.test(address)) return true;
  // Legacy P2PKH: starts with 1
  if (/^1[1-9A-HJ-NP-Za-km-z]{24,33}$/.test(address)) return true;
  // P2SH: starts with 3
  if (/^3[1-9A-HJ-NP-Za-km-z]{24,33}$/.test(address)) return true;
  return false;
}

/**
 * Parse BIP21 bitcoin: URIs and lightning: URIs
 * Examples:
 *   bitcoin:bc1q...?amount=0.00115262
 *   bitcoin:bc1q...?amount=0.001&label=Donation
 *   lightning:lnbc500u1...
 *   BITCOIN:BC1Q...?amount=0.5 (case-insensitive scheme)
 *
 * Returns { address, amountSats?, label?, lightning? } or null if not a URI
 */
function parseBIP21(input: string): {
  address: string;
  amountSats?: number;
  label?: string;
  message?: string;
  lightning?: string;
} | null {
  const trimmed = input.trim();
  const lower = trimmed.toLowerCase();

  // Check for bitcoin: or lightning: scheme
  if (!lower.startsWith('bitcoin:') && !lower.startsWith('lightning:')) {
    return null;
  }

  // Handle lightning: URIs
  if (lower.startsWith('lightning:')) {
    const invoice = trimmed.substring('lightning:'.length);
    return { address: invoice };
  }

  // Parse bitcoin: URI
  const withoutScheme = trimmed.substring('bitcoin:'.length);
  const questionIndex = withoutScheme.indexOf('?');

  let address: string;
  let params: URLSearchParams;

  if (questionIndex === -1) {
    address = withoutScheme;
    params = new URLSearchParams();
  } else {
    address = withoutScheme.substring(0, questionIndex);
    params = new URLSearchParams(withoutScheme.substring(questionIndex + 1));
  }

  if (!address) return null;

  const result: {
    address: string;
    amountSats?: number;
    label?: string;
    message?: string;
    lightning?: string;
  } = { address };

  // Parse amount (BIP21 amount is in BTC)
  const amountBtc = params.get('amount');
  if (amountBtc) {
    const btcValue = parseFloat(amountBtc);
    if (!isNaN(btcValue) && btcValue > 0) {
      result.amountSats = Math.round(btcValue * 100_000_000);
    }
  }

  // Parse optional label/message
  const label = params.get('label');
  if (label) result.label = label;

  const message = params.get('message');
  if (message) result.message = message;

  // Parse lightning param (some wallets include a lightning invoice in the URI)
  const lightning = params.get('lightning');
  if (lightning) result.lightning = lightning;

  return result;
}

type SendStep = 'input' | 'preview' | 'onchain-preview' | 'scanning';
type ConfirmationSpeed = 'fast' | 'medium' | 'slow';
type SendTab = 'lightning' | 'onchain';
export type RecipientAsset = 'bitcoin' | 'usdb' | 'usdt' | 'usdc';

const RECIPIENT_ASSET_OPTIONS: Array<{ value: RecipientAsset; label: string }> = [
  { value: 'bitcoin', label: 'Bitcoin / Lightning' },
  { value: 'usdb', label: 'USDB' },
  { value: 'usdt', label: 'USDT' },
  { value: 'usdc', label: 'USDC' },
];

interface OnchainFeeQuote {
  feeSats: number;        // total fee (service + L1)
  serviceFee: number;     // Spark service fee (userFeeSat)
  l1Fee: number;          // L1 broadcast fee (l1BroadcastFeeSat)
  satPerVbyte?: number;
  estimatedConfirmationTime?: string;
}

interface PaymentPreview {
  recipient: string;
  amount: number;
  fee: number;
  total: number;
  description?: string;
}

/**
 * Local widening of {@link DisplayCurrency} to also cover USDB as an
 * "input mode" — same approach as on the receive screen. Used purely as
 * a label key + a tag for the conversion branch (USDB→base-units vs
 * fiat→sats vs fiat→USDB).
 */
type SendInputCurrency = DisplayCurrency | 'usdb';

const currencyLabels: Record<SendInputCurrency, string> = {
  sats: 'sats',
  usd: 'USD',
  eur: 'EUR',
  usdb: 'USDB',
};
const PREVIEW_FIAT_RATE_STALE_MS = 15 * 60 * 1000;

export default function SendScreen() {
  const params = useLocalSearchParams<{
    paymentInput?: string;
    tab?: string;
    amount?: string;
    comment?: string;
    asset?: string;
  }>();
  const { themeMode } = useAppTheme();
  const gradientColors = getGradientColors(themeMode);
  const primaryTextColor = getPrimaryTextColor(themeMode);
  const secondaryTextColor = getSecondaryTextColor(themeMode);

  const { balance, refreshBalance, getBalanceForAsset } = useWallet();
  const {
    displayCurrency,
    setDisplayCurrency,
    convertToSats,
    formatSatsWithFiat,
    isLoadingRates,
    rates,
    secondaryFiatCurrency,
  } = useCurrency();
  const { contacts, refreshContacts } = useContacts();

  // Refresh contacts when screen gains focus (e.g. after adding a contact in address book)
  useFocusEffect(
    useCallback(() => {
      refreshContacts();
    }, [refreshContacts])
  );
  const { addressInfo } = useLightningAddress();

  const [step, setStep] = useState<SendStep>('input');
  const [activeTab, setActiveTab] = useState<SendTab>('lightning');
  // Funding remains the asset selected on Home (`activeAsset`). This state
  // describes only what the recipient will receive; the cross-chain children
  // use it to load routes and execute stablecoin sends through Breez.
  const [recipientAsset, setRecipientAsset] = useState<RecipientAsset>('bitcoin');
  const [crossChainRoutes, setCrossChainRoutes] = useState<Array<{ route: unknown; destination: CrossChainDestinationRoute }>>([]);
  const [selectedCrossChainRoute, setSelectedCrossChainRoute] = useState<unknown>(null);
  const [isLoadingCrossChainRoutes, setIsLoadingCrossChainRoutes] = useState(false);
  const [crossChainRouteError, setCrossChainRouteError] = useState<string | null>(null);
  const [paymentInput, setPaymentInput] = useState('');
  const [amount, setAmount] = useState('');
  const [comment, setComment] = useState('');
  // Manual cross-platform keyboard avoidance (see useKeyboardAwareScroll —
  // neither iOS nor Android edge-to-edge resizes the window for the keyboard).
  const {
    scrollRef: formScrollRef,
    onScroll: onFormScroll,
    contentPadding: kbContentPadding,
    scrollFieldIntoView,
  } = useKeyboardAwareScroll();
  const [preview, setPreview] = useState<PaymentPreview | null>(null);
  const [isPreparing, setIsPreparing] = useState(false);
  const [isSending, setIsSending] = useState(false);
  // True for the duration of an in-flight send — blocks a duplicate submit of
  // the same prepared payment (which the SDK rejects as "already exists").
  const sendInFlightRef = useRef(false);
  const [permission, requestPermission] = useCameraPermissions();
  const [prepareResponse, setPrepareResponse] = useState<any>(null);
  const [scanned, setScanned] = useState(false);
  const [onchainFeeQuotes, setOnchainFeeQuotes] = useState<
    | { fast: OnchainFeeQuote; medium: OnchainFeeQuote; slow: OnchainFeeQuote }
    | null
  >(null);
  const [selectedSpeed, setSelectedSpeed] = useState<ConfirmationSpeed>('medium');

  const [inputCurrency, setInputCurrency] = useState<SendInputCurrency>('sats');
  const [showCurrencyPicker, setShowCurrencyPicker] = useState(false);
  // True when the amount comes from a fixed-amount invoice/BIP21 — the recipient
  // dictates it, so we lock the field + currency toggle to prevent confusion.
  const [amountLocked, setAmountLocked] = useState(false);

  const [selectedContact, setSelectedContact] = useState<Contact | null>(null);
  const [activeAsset, setActiveAsset] = useState<'BTC' | 'USDB'>('BTC');
  const [contactModalVisible, setContactModalVisible] = useState(false);
  const [isFetchingFees, setIsFetchingFees] = useState(false);
  const [addressError, setAddressError] = useState<string | null>(null);
  const [usdbLightningError, setUsdbLightningError] = useState<string | null>(null);
  const [usdbTokenIdentifier, setUsdbTokenIdentifier] = useState<string | null>(null);
  const [usdbInternalDecimals, setUsdbInternalDecimals] = useState<number>(2);

  const isUsdbAsset = activeAsset === 'USDB';

  // iOS: an accessory bar with a "Done" button above the keyboard. The address
  // and amount fields are multiline/numeric, so the keyboard has no return key
  // to dismiss it — this gives a one-tap way to drop the keyboard and reach the
  // Preview/Send button. Android has a system back-to-dismiss, so it's unset.
  const kbAccessoryId = Platform.OS === 'ios' ? 'sendKbAccessory' : undefined;

  // Render-time safety net for the input currency. If state is somehow out
  // of sync with the active asset (e.g. Fast Refresh preserved a stale
  // 'sats' across a USDB switch), the UI uses the asset's correct native
  // unit. The default-effect below still runs and converges; this just
  // prevents flicker in the meantime.
  const effectiveInputCurrency: SendInputCurrency =
    isUsdbAsset && inputCurrency === 'sats'
      ? 'usdb'
      : !isUsdbAsset && inputCurrency === 'usdb'
        ? 'sats'
        : inputCurrency;

  useEffect(() => {
    // IMPORTANT: only reset state when params actually carry a value. The
    // effect clears them via `router.setParams({ asset: undefined, … })`
    // after applying — without this guard the resulting re-render fires
    // the effect again with everything undefined and clobbers state back
    // to defaults (e.g. activeAsset reset to 'BTC' even when entered from
    // the USDB asset).
    const hasIncomingInput = typeof params.paymentInput === 'string' && params.paymentInput.trim() !== '';
    const hasIncomingAsset = typeof params.asset === 'string';
    const hasIncomingTab = typeof params.tab === 'string';
    const hasIncomingAmount = typeof params.amount === 'string' && params.amount.trim() !== '';
    const hasIncomingComment = typeof params.comment === 'string' && params.comment.trim() !== '';
    if (!hasIncomingInput && !hasIncomingAsset && !hasIncomingTab && !hasIncomingAmount && !hasIncomingComment) {
      return;
    }

    const incomingInput = hasIncomingInput ? (params.paymentInput as string).trim() : '';
    let resolvedAsset: 'BTC' | 'USDB' = hasIncomingAsset
      ? ((params.asset as string).toUpperCase() === 'USDB' ? 'USDB' : 'BTC')
      : activeAsset;
    // v1: USDB UI is hidden — coerce any deep-link / scanner-routed USDB
    // attempt back to BTC. This is defence-in-depth on top of hiding the
    // entry points; reviewers (or scripted nav) can't land in a half-broken
    // USDB tab.
    if (!MULTI_ASSET_UI_ENABLED && resolvedAsset === 'USDB') {
      resolvedAsset = 'BTC';
    }
    if (hasIncomingAsset) {
      setActiveAsset(resolvedAsset);
    }
    if (!incomingInput) return;

    const incomingTab = typeof params.tab === 'string' ? params.tab.toLowerCase() : '';
    if (incomingTab === 'onchain' && resolvedAsset !== 'USDB') {
      setActiveTab('onchain');
    } else {
      setActiveTab('lightning');
    }

    setPaymentInput(incomingInput);

    if (typeof params.amount === 'string' && params.amount.trim()) {
      setAmount(params.amount.trim());
      setInputCurrency('sats');
    }

    if (typeof params.comment === 'string' && params.comment.trim()) {
      setComment(params.comment.trim());
    }

    router.setParams({
      paymentInput: undefined,
      tab: undefined,
      amount: undefined,
      comment: undefined,
      asset: undefined,
    });
  }, [params.paymentInput, params.tab, params.amount, params.comment, params.asset]);

  // Default the input currency based on active asset, mirroring receive:
  //   • USDB asset → seed `usdb` (sats are meaningless for tokens)
  //   • BTC asset  → mirror the user's persisted display preference
  // Only seeds when the previous value is the *opposite asset's* native unit
  // so explicit fiat picks (usd / eur) survive switching between assets and
  // displayCurrency hydrating asynchronously.
  useEffect(() => {
    if (isUsdbAsset) {
      if (inputCurrency === 'sats') setInputCurrency('usdb');
    } else {
      if (inputCurrency === 'usdb') setInputCurrency(displayCurrency);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isUsdbAsset, displayCurrency]);

  // Release the amount lock if the user clears the destination — they may be
  // entering a different amountless invoice or address next.
  useEffect(() => {
    if (!paymentInput.trim()) {
      setAmountLocked(false);
    }
  }, [paymentInput]);

  useEffect(() => {
    if (isUsdbAsset && activeTab === 'onchain') {
      setActiveTab('lightning');
    }
  }, [activeTab, isUsdbAsset]);

  useEffect(() => {
    let isCancelled = false;

    if (!isUsdbAsset) {
      setUsdbTokenIdentifier(null);
      return;
    }

    const loadUsdbTokenIdentifier = async () => {
      try {
        const [usdbToken] = await BreezSparkService.resolveSwapTokens();
        if (!isCancelled) {
          setUsdbTokenIdentifier(usdbToken?.tokenIdentifier || null);
          setUsdbInternalDecimals(Number.isFinite(usdbToken?.internalDecimals) ? Number(usdbToken?.internalDecimals) : 2);
        }
      } catch (error) {
        console.warn('⚠️ [Send] Failed to resolve USDB token identifier:', error);
        if (!isCancelled) {
          setUsdbTokenIdentifier(null);
          setUsdbInternalDecimals(2);
        }
      }
    };

    void loadUsdbTokenIdentifier();

    return () => {
      isCancelled = true;
    };
  }, [isUsdbAsset]);

  useEffect(() => {
    const asset = recipientAsset === 'usdt' ? 'USDT' : recipientAsset === 'usdc' ? 'USDC' : null;
    const recipientAddress = paymentInput.trim();
    if (!asset || !recipientAddress) {
      setCrossChainRoutes([]);
      setSelectedCrossChainRoute(null);
      setCrossChainRouteError(null);
      return;
    }

    let cancelled = false;
    const loadRoutes = async () => {
      setIsLoadingCrossChainRoutes(true);
      try {
        const routes = await BreezSparkService.getCrossChainSendRoutesForAddress(recipientAddress, asset);
        if (cancelled) return;
        setCrossChainRoutes(routes);
        setSelectedCrossChainRoute(routes.length === 1 ? routes[0].route : null);
        setCrossChainRouteError(routes.length ? null : `No ${asset} route is currently available for this address.`);
      } catch (error) {
        if (!cancelled) {
          setCrossChainRoutes([]);
          setSelectedCrossChainRoute(null);
          setCrossChainRouteError(error instanceof Error ? error.message : 'Could not load destination networks.');
        }
      } finally {
        if (!cancelled) setIsLoadingCrossChainRoutes(false);
      }
    };
    void loadRoutes();
    return () => { cancelled = true; };
  }, [recipientAsset, paymentInput]);


  const usdbBalance = useMemo(() => getBalanceForAsset('USDB'), [getBalanceForAsset]);

  const convertUsdbDisplayToBaseUnits = useCallback((value: number): number => {
    if (!Number.isFinite(value) || value <= 0) return 0;
    const factor = 10 ** usdbInternalDecimals;
    return Math.floor(value * factor);
  }, [usdbInternalDecimals]);

  const formatUsdbFromBaseUnits = useCallback((value: number): string => {
    const factor = 10 ** usdbInternalDecimals;
    const normalized = factor > 0 ? value / factor : value;
    return normalized.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }, [usdbInternalDecimals]);


  const previewSats = useMemo(() => {
    const numAmount = parseFloat(amount);
    if (!numAmount || isNaN(numAmount)) return 0;
    // Sat preview only makes sense for BTC inputs.
    if (inputCurrency === 'usdb') return 0;
    return convertToSats(numAmount, inputCurrency);
  }, [amount, inputCurrency, convertToSats]);

  const previewDisplay = useMemo(() => {
    if (!previewSats) return null;
    return formatSatsWithFiat(previewSats);
  }, [previewSats, formatSatsWithFiat]);

  const balanceDisplay = useMemo(() => {
    if (isUsdbAsset) {
      const fiat = rates ? formatFiat(usdbToFiat(usdbBalance, secondaryFiatCurrency, rates), secondaryFiatCurrency) : null;
      return { satsDisplay: `${usdbBalance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDB`, fiatDisplay: fiat };
    }
    return formatSatsWithFiat(balance);
  }, [isUsdbAsset, rates, usdbBalance, secondaryFiatCurrency, balance, formatSatsWithFiat]);

  const formatPreviewFiat = useCallback((sats: number): string | null => {
    if (isUsdbAsset || !Number.isFinite(sats) || sats < 0) return null;
    if (!rates || rates.timestamp <= 0 || rates[secondaryFiatCurrency] <= 0) return null;
    if (Date.now() - rates.timestamp > PREVIEW_FIAT_RATE_STALE_MS) return null;

    return `≈ ${formatFiat(satsToFiat(sats, rates, secondaryFiatCurrency), secondaryFiatCurrency)}`;
  }, [isUsdbAsset, rates, secondaryFiatCurrency]);

  const getOnchainFeeQuote = useCallback(
    (
      speed: ConfirmationSpeed,
      feeQuotes?: { fast: OnchainFeeQuote; medium: OnchainFeeQuote; slow: OnchainFeeQuote } | null
    ) => {
      if (!feeQuotes) return 0;
      return Number(feeQuotes[speed]?.feeSats || 0);
    },
    []
  );

  const formatEstimatedTime = useCallback((value?: string, fallbackMinutes?: string) => {
    const base = value || fallbackMinutes || '0';
    const minutes = base.replace(/[^0-9]/g, '') || base;
    return t('send.estimatedTime').replace('%s', minutes);
  }, []);

  const resetFormState = useCallback(() => {
    setPaymentInput('');
    setAmount('');
    setComment('');
    setPreview(null);
    setPrepareResponse(null);
    setOnchainFeeQuotes(null);
    setSelectedSpeed('medium');
    setSelectedContact(null);
    setInputCurrency('sats');
    setAmountLocked(false);
    setAddressError(null);
    setUsdbLightningError(null);
  }, []);

  const handleTabChange = useCallback(
    (tab: SendTab) => {
      if (isUsdbAsset && tab === 'onchain') return;
      if (activeTab === tab) return;
      setActiveTab(tab);
      resetFormState();
    },
    [activeTab, isUsdbAsset, resetFormState]
  );

  // (cycleCurrency removed — superseded by the bottom-sheet picker)

  const handleContactSelect = useCallback((contact: Contact) => {
    setSelectedContact(contact);
    const destination = activeAsset === 'USDB' ? contact.sparkAddress : contact.lightningAddress;
    setPaymentInput(destination || '');
    setContactModalVisible(false);
  }, [activeAsset]);

  const handleClearContact = useCallback(() => {
    setSelectedContact(null);
    setPaymentInput('');
    setUsdbLightningError(null);
  }, []);

  const handlePaymentInputChange = useCallback((value: string) => {
    setPaymentInput(value);
    if (usdbLightningError) {
      setUsdbLightningError(null);
    }
  }, [usdbLightningError]);

  const handleSwitchToBtc = useCallback(() => {
    setActiveAsset('BTC');
    setUsdbLightningError(null);
  }, []);

  const isValidUsdbSparkPayment = useCallback((parsed: { type: string; tokenIdentifier?: string }) => {
    if (parsed.type !== 'sparkAddress' && parsed.type !== 'sparkInvoice') {
      return false;
    }
    if (!usdbTokenIdentifier) {
      return false;
    }
    return parsed.tokenIdentifier === usdbTokenIdentifier;
  }, [usdbTokenIdentifier]);

  /**
   * Look up the asset ticker for a parsed-invoice's tokenIdentifier. Returns
   * 'BTC' when no token id is present (Bolt11 / sat-denominated SparkInvoice
   * / on-chain), or the matching ticker from the asset registry.
   *
   * The registry is the canonical source for tokenIdentifier→ticker mapping,
   * so this function works regardless of which asset is currently active —
   * needed for auto-switching the active asset based on what was scanned.
   */
  const tickerForTokenIdentifier = useCallback((tokenIdentifier?: string): 'BTC' | 'USDB' | null => {
    if (!tokenIdentifier) return 'BTC';
    const match = getAllAssets().find((m) => m.tokenIdentifier === tokenIdentifier);
    if (!match) return null;
    if (match.ticker === 'BTC' || match.ticker === 'USDB') return match.ticker;
    return null;
  }, []);

  /**
   * Apply a successfully-parsed invoice/address to the form: switch active
   * asset if needed, fill the amount in **display units** (sats for BTC,
   * USDB display units for USDB), pin the input currency, and lock the
   * amount field. Centralised so all five parse entry points stay
   * consistent.
   */
  const applyParsedInvoice = useCallback(
    (parsed: { type: string; amountSat?: number; tokenAmount?: number; tokenIdentifier?: string }) => {
      const ticker = tickerForTokenIdentifier(parsed.tokenIdentifier);
      if (!ticker) return; // unknown token — leave the form alone

      // Auto-switch the active asset to match what was scanned. This used
      // to be a hard error ("USDB transfers stay on Spark"); now we just
      // follow the user's intent.
      if (ticker !== activeAsset) {
        setActiveAsset(ticker as 'BTC' | 'USDB');
      }

      // Fill amount in the *display* unit appropriate for the asset.
      if (ticker === 'USDB' && typeof parsed.tokenAmount === 'number' && parsed.tokenAmount > 0) {
        const decimals = getAssetMeta('USDB').decimals;
        const display = parsed.tokenAmount / 10 ** decimals;
        // Trim trailing zeros after the decimal so the field reads "50"
        // rather than "50.000000" but keeps "12.345" intact.
        const formatted = display.toFixed(decimals).replace(/\.?0+$/, '');
        setAmount(formatted);
        // Pin the input mode to 'usdb' so handlePreviewPayment routes
        // through the USDB display→base-units conversion (not the fiat
        // path) and the picker label reads "USDB".
        setInputCurrency('usdb');
        setAmountLocked(true);
      } else if (typeof parsed.amountSat === 'number' && parsed.amountSat > 0) {
        setAmount(String(parsed.amountSat));
        setInputCurrency('sats');
        setAmountLocked(true);
      }
      // Amountless invoices: leave amount empty, user types it.
    },
    [activeAsset, tickerForTokenIdentifier],
  );

  useEffect(() => {
    const trimmedInput = paymentInput.trim();
    if (!trimmedInput) return;

    const timeoutId = setTimeout(async () => {
      // Check for BIP21 / lightning: URI pasted into input
      const bip21 = parseBIP21(trimmedInput);
      if (bip21) {
        // If lightning param exists and we're on lightning tab, use it
        // BIP21 with embedded lightning: always prefer the LN path. Auto-
        // switch to the lightning tab so the same paste/scan works whether
        // the user is currently looking at on-chain or lightning.
        if (bip21.lightning) {
          setActiveTab('lightning');
          setPaymentInput(bip21.lightning);
          try {
            const parsed = await BreezSparkService.parsePaymentRequest(bip21.lightning);
            if (parsed.isValid) {
              applyParsedInvoice(parsed);
            }
          } catch (e) { /* ignore */ }
          return;
        }

        // Bitcoin address — auto-switch to on-chain
        if (isValidBitcoinAddress(bip21.address)) {
          setActiveTab('onchain');
          setPaymentInput(bip21.address);
          if (bip21.amountSats) {
            setAmount(bip21.amountSats.toString());
            setInputCurrency('sats');
            setAmountLocked(true);
          }
          if (bip21.label || bip21.message) {
            setComment(bip21.label || bip21.message || '');
          }
          return;
        }

        // lightning: URI
        if (trimmedInput.toLowerCase().startsWith('lightning:')) {
          setPaymentInput(bip21.address);
        }
      }

      // Raw lightning/Spark/LNURL/etc. paste — parse first, then auto-route
      // the active tab. Previously we early-returned when not on the
      // lightning tab, which meant pasting a Bolt11/Spark invoice into the
      // payment field while on on-chain quietly did nothing.
      try {
        const parsed = await BreezSparkService.parsePaymentRequest(trimmedInput);
        if (!parsed.isValid) return;

        // Tab routing: only `bitcoinAddress` belongs on the on-chain tab.
        // Bolt11 / SparkInvoice / SparkAddress / LNURL / LightningAddress
        // → lightning. Asset (BTC vs USDB) is decided by applyParsedInvoice
        // based on the parsed `tokenIdentifier`.
        if (parsed.type === 'bitcoinAddress') {
          setActiveTab('onchain');
        } else {
          setActiveTab('lightning');
        }

        // Used to be a hard error when the asset and invoice mismatched
        // ("USDB transfers stay on Spark"); now we follow the user's
        // intent and just clear any stale warning.
        if (isUsdbAsset && parsed.type === 'bolt11') {
          setUsdbLightningError(null);
        }
        applyParsedInvoice(parsed);
      } catch (error) {
        if (trimmedInput.length > 10) {
          console.error('❌ [Send] Failed to parse payment request:', error);
        }
      }
    }, 500);

    return () => clearTimeout(timeoutId);
  }, [paymentInput, activeTab, isUsdbAsset, isValidUsdbSparkPayment]);

  // Auto-fetch on-chain fee quotes when address + amount are filled
  useEffect(() => {
    if (activeTab !== 'onchain') return;

    // Strip BIP21 URI if present
    let trimmedAddress = paymentInput.trim();
    const bip21Check = parseBIP21(trimmedAddress);
    if (bip21Check) {
      trimmedAddress = bip21Check.address;
      // If BIP21 has amount and our amount field is empty, apply it
      if (bip21Check.amountSats && !amount) {
        setAmount(bip21Check.amountSats.toString());
        setInputCurrency('sats');
        setAmountLocked(true);
        // Also update the input field to show just the address
        setPaymentInput(trimmedAddress);
        return; // Let the next effect cycle pick up the new values
      }
      // Update input to stripped address
      if (paymentInput.trim() !== trimmedAddress) {
        setPaymentInput(trimmedAddress);
        return;
      }
    }

    const satsAmount = Math.floor(Number(amount));

    // Validate address format
    if (trimmedAddress.length > 0 && !isValidBitcoinAddress(trimmedAddress)) {
      setAddressError(t('send.invalidOnchainAddress'));
      setOnchainFeeQuotes(null);
      return;
    } else {
      setAddressError(null);
    }

    if (!trimmedAddress || !isValidBitcoinAddress(trimmedAddress) || !satsAmount || satsAmount <= 0) {
      setOnchainFeeQuotes(null);
      return;
    }

    const timeoutId = setTimeout(async () => {
      // Double-check address is still valid (could have been cleared by tab switch)
      if (!trimmedAddress || !isValidBitcoinAddress(trimmedAddress) || satsAmount <= 0) return;
      try {
        setIsFetchingFees(true);
        const prepared = await BreezSparkService.prepareSendPayment(trimmedAddress, satsAmount);
        console.log('🔍 [Send] auto-fee prepared:', JSON.stringify(prepared, (_, v) => typeof v === 'bigint' ? v.toString() : v));
        setPrepareResponse(prepared);

        const method = prepared.paymentMethod;
        const methodInner = method?.inner || method;
        console.log('🔍 [Send] paymentMethod tag:', method?.tag, 'keys:', method ? Object.keys(method) : 'null');
        console.log('🔍 [Send] methodInner keys:', methodInner ? Object.keys(methodInner) : 'null');
        if (method?.tag === 'BitcoinAddress' || method?.type === 'bitcoinAddress') {
          const feeQuote = methodInner?.feeQuote || method?.feeQuote;
          console.log('🔍 [Send] feeQuote:', JSON.stringify(feeQuote, (_, v) => typeof v === 'bigint' ? v.toString() : v));
          if (feeQuote?.speedFast || feeQuote?.speedMedium || feeQuote?.speedSlow) {
            const extractL1Fee = (q: any) => Number(q?.l1BroadcastFeeSat ?? 0);
            const extractServiceFee = (q: any) => Number(q?.userFeeSat ?? q?.feeSats ?? 0);
            // Total fee = service fee (userFeeSat) + L1 broadcast fee (l1BroadcastFeeSat)
            const extractFee = (q: any) => extractServiceFee(q) + extractL1Fee(q);
            const extractSatPerVbyte = (q: any) => {
              // Try direct field first, then estimate from l1BroadcastFeeSat
              const direct = Number(q?.satPerVbyte ?? q?.sat_per_vbyte ?? 0);
              if (direct > 0) return direct;
              // Estimate: typical P2WPKH tx is ~141 vBytes, P2TR ~111 vBytes; use ~140 as approximation
              const l1Fee = extractL1Fee(q);
              if (l1Fee > 0) return Math.round(l1Fee / 140);
              return undefined;
            };
            const buildQuote = (q: any): OnchainFeeQuote => ({
              feeSats: extractFee(q),
              serviceFee: extractServiceFee(q),
              l1Fee: extractL1Fee(q),
              satPerVbyte: extractSatPerVbyte(q),
              estimatedConfirmationTime: q?.estimatedConfirmationTime,
            });
            setOnchainFeeQuotes({
              fast: buildQuote(feeQuote.speedFast),
              medium: buildQuote(feeQuote.speedMedium),
              slow: buildQuote(feeQuote.speedSlow),
            });
          }
        }
      } catch (error) {
        console.warn('⚠️ [Send] auto-fee estimation failed:', error);
        setOnchainFeeQuotes(null);
      } finally {
        setIsFetchingFees(false);
      }
    }, 800);

    return () => clearTimeout(timeoutId);
  }, [activeTab, paymentInput, amount]);

  const handleScanQR = useCallback(async () => {
    if (permission?.granted) {
      setScanned(false);
      setStep('scanning');
      return;
    }

    const response = await requestPermission();
    if (response.granted) {
      setScanned(false);
      setStep('scanning');
    } else {
      Alert.alert(t('send.permissionRequired'), t('send.cameraPermissionRequired'));
    }
  }, [permission, requestPermission]);

  const handleBarCodeScanned = useCallback(
    async ({ data }: BarcodeScanningResult) => {
      if (scanned) return;
      setScanned(true);

      // BIP21 URIs (`bitcoin:…?lightning=…`, `lightning:…`)
      const bip21 = parseBIP21(data);
      if (bip21) {
        // BIP21 with embedded lightning invoice — ALWAYS prefer the LN
        // route regardless of which tab the user is currently viewing.
        // The previous logic only switched when already on the lightning
        // tab, so scanning a BIP21+LN invoice from the on-chain tab
        // silently dropped it.
        if (bip21.lightning) {
          setActiveTab('lightning');
          setPaymentInput(bip21.lightning);
          setStep('input');
          try {
            const parsed = await BreezSparkService.parsePaymentRequest(bip21.lightning);
            if (parsed.isValid) applyParsedInvoice(parsed);
          } catch (error) {
            console.error('Failed to parse lightning param from BIP21:', error);
          }
          return;
        }

        // Bitcoin address — switch to on-chain tab if not already
        if (isValidBitcoinAddress(bip21.address)) {
          setActiveTab('onchain');
          setPaymentInput(bip21.address);
          if (bip21.amountSats) {
            setAmount(bip21.amountSats.toString());
            setInputCurrency('sats');
            setAmountLocked(true);
          }
          if (bip21.label || bip21.message) {
            setComment(bip21.label || bip21.message || '');
          }
          setStep('input');
          return;
        }

        // lightning: URI (not bitcoin:) — always lightning tab.
        setActiveTab('lightning');
        setPaymentInput(bip21.address);
        setStep('input');
        try {
          const parsed = await BreezSparkService.parsePaymentRequest(bip21.address);
          if (parsed.isValid) applyParsedInvoice(parsed);
        } catch (error) {
          console.error('Failed to parse lightning URI:', error);
        }
        return;
      }

      // Raw input — always parse first to detect the type, then route the
      // correct tab + asset before filling the form. Previously this only
      // ran on the lightning tab; scanning a Spark/LN invoice from the
      // on-chain tab would just drop the input into the address field.
      setPaymentInput(data);
      setStep('input');

      try {
        const parsed = await BreezSparkService.parsePaymentRequest(data);
        if (!parsed.isValid) return;

        // Tab routing: only `bitcoinAddress` belongs on the on-chain tab.
        // Everything else (Bolt11, SparkInvoice, SparkAddress, LNURL,
        // LightningAddress) lives under the lightning tab. The asset
        // (BTC vs USDB) is decided by `applyParsedInvoice` based on the
        // parsed `tokenIdentifier`.
        if (parsed.type === 'bitcoinAddress') {
          setActiveTab('onchain');
          return;
        }
        setActiveTab('lightning');
        applyParsedInvoice(parsed);
      } catch (error) {
        console.error('Failed to parse scanned QR code:', error);
      }
    },
    [scanned, applyParsedInvoice]
  );

  const handlePreviewPayment = useCallback(async () => {
    if (!paymentInput.trim()) {
      Alert.alert(t('common.error'), t('send.enterDestination'));
      return;
    }

    try {
      setIsPreparing(true);

      // Strip BIP21/lightning: URI scheme before passing to SDK
      let resolvedInput = paymentInput.trim();
      const bip21Parsed = parseBIP21(resolvedInput);
      if (bip21Parsed) {
        // If lightning param exists and we're on lightning tab, use it
        if (bip21Parsed.lightning && activeTab === 'lightning') {
          resolvedInput = bip21Parsed.lightning;
        } else {
          resolvedInput = bip21Parsed.address;
        }
        // Apply amount from BIP21 if not already set
        if (bip21Parsed.amountSats && !amount) {
          setAmount(bip21Parsed.amountSats.toString());
          setInputCurrency('sats');
          setAmountLocked(true);
        }
      }

      const parsedRequest = await BreezSparkService.parsePaymentRequest(resolvedInput);
      const isOnchainFlow = activeTab === 'onchain';
      const isCrossChainFlow = recipientAsset === 'usdt' || recipientAsset === 'usdc';

      if (isCrossChainFlow && !selectedCrossChainRoute) {
        Alert.alert(t('common.error'), 'Enter a supported recipient address and select a destination network.');
        return;
      }

      if (isUsdbAsset && !isCrossChainFlow) {
        if (parsedRequest.type === 'bolt11') {
          setUsdbLightningError('USDB transfers stay on Spark. Lightning invoices are BTC-only.');
          return;
        }
        if (!isValidUsdbSparkPayment(parsedRequest)) {
          setUsdbLightningError('USDB transfers require a Spark destination for USDB.');
          return;
        }
      }

      if (!parsedRequest.isValid) {
        Alert.alert(t('send.paymentError'), t('send.invalidPaymentRequest'));
        return;
      }

      if (isOnchainFlow && parsedRequest.type !== 'bitcoinAddress') {
        Alert.alert(t('send.invalidBitcoinAddress'), t('send.invalidOnchainAddress'));
        return;
      }

      if (!isOnchainFlow && parsedRequest.type === 'bitcoinAddress') {
        Alert.alert(t('send.lightningOnly'), t('send.invalidLightningDestination'));
        return;
      }

      let paymentAmount: number;
      if (isOnchainFlow) {
        const parsedAmount = parseFloat(amount);
        if (!parsedAmount || parsedAmount <= 0) {
          Alert.alert(t('common.error'), t('send.amountRequiredOnchain'));
          return;
        }
        // On-chain is BTC-only — `inputCurrency === 'usdb'` is unreachable
        // here (USDB asset auto-switches to the lightning tab).
        const btcInput = inputCurrency as DisplayCurrency;
        const satsAmount = btcInput === 'sats'
          ? Math.floor(parsedAmount)
          : convertToSats(parsedAmount, btcInput);
        if (!satsAmount || satsAmount <= 0) {
          Alert.alert(t('send.conversionError'), t('send.conversionErrorMessage'));
          return;
        }
        paymentAmount = satsAmount;
      } else if (parsedRequest.type === 'bolt11' && parsedRequest.amountSat !== undefined) {
        paymentAmount = parsedRequest.amountSat;
      } else {
        const parsedAmount = parseFloat(amount);
        if (!parsedAmount || parsedAmount <= 0) {
          Alert.alert(t('common.error'), t('send.invalidAmount'));
          return;
        }
        if (isUsdbAsset) {
          // Convert from whatever the user typed in into USDB display
          // units, then to USDB base units. 1 USDB ≈ 1 USD by design;
          // EUR uses cached BTC FX rates (fiatToUsdb).
          let usdbDisplay: number;
          if (inputCurrency === 'usdb') {
            usdbDisplay = parsedAmount;
          } else if (inputCurrency === 'usd' || inputCurrency === 'eur') {
            usdbDisplay = fiatToUsdb(parsedAmount, inputCurrency, rates);
          } else {
            usdbDisplay = parsedAmount; // 'sats' shouldn't reach here, but be lenient
          }
          paymentAmount = convertUsdbDisplayToBaseUnits(usdbDisplay);
        } else {
          // BTC asset: type-narrow `inputCurrency` away from 'usdb'.
          const btcInput = inputCurrency as DisplayCurrency;
          paymentAmount = convertToSats(parsedAmount, btcInput);
        }

        if (!paymentAmount || paymentAmount <= 0) {
          Alert.alert(t('send.conversionError'), t('send.conversionErrorMessage'));
          return;
        }
      }

      // Minimum on-chain send to avoid dust issues on the receiving end
      const MIN_ONCHAIN_SATS = 1000;
      if (isOnchainFlow && paymentAmount < MIN_ONCHAIN_SATS) {
        Alert.alert(
          t('common.error'),
          `Minimum on-chain send is ${MIN_ONCHAIN_SATS.toLocaleString()} sats. Smaller amounts may be unspendable due to network fees.`
        );
        return;
      }

      const availableBalance = isUsdbAsset ? convertUsdbDisplayToBaseUnits(usdbBalance) : balance;
      if (paymentAmount > availableBalance) {
        // Format amounts in the asset's *display* units so the message
        // reads naturally for either currency. The underlying
        // `paymentAmount` / `availableBalance` are sats for BTC and USDB
        // base units (×10^decimals) for USDB.
        const fmtAmount = isUsdbAsset
          ? `${formatUsdbFromBaseUnits(paymentAmount)} USDB`
          : `${paymentAmount.toLocaleString()} sats`;
        const fmtBalance = isUsdbAsset
          ? `${usdbBalance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDB`
          : `${balance.toLocaleString()} sats`;
        Alert.alert(
          t('send.insufficientBalance'),
          `${fmtAmount} exceeds your balance of ${fmtBalance}.`,
        );
        return;
      }

      const prepared = isCrossChainFlow
        ? await BreezSparkService.prepareCrossChainSendPayment(resolvedInput, selectedCrossChainRoute, paymentAmount)
        : await BreezSparkService.prepareSendPayment(
          resolvedInput,
          paymentAmount,
          isUsdbAsset ? { tokenIdentifier: usdbTokenIdentifier || undefined } : undefined
        );
      console.log('🔍 [Send] prepared response:', JSON.stringify(prepared, (_, v) => typeof v === 'bigint' ? v.toString() : v));
      setPrepareResponse(prepared);

      let feeAmount = 0;
      let extractedFeeQuotes: { fast: OnchainFeeQuote; medium: OnchainFeeQuote; slow: OnchainFeeQuote } | null = null;
      // LNURL-pay / Lightning Address prepares carry the fee directly (no
      // paymentMethod). See prepareSendPayment's __lnurlPay wrapper.
      if (prepared?.__lnurlPay) {
        feeAmount = Number(prepared.feeSats || 0);
      } else if (prepared.paymentMethod) {
        const method = prepared.paymentMethod;
        const methodInner = method.inner || method;
        if (method.tag === 'Bolt11Invoice' || method.tag === 'SparkInvoice') {
          feeAmount = Number(method.inner?.lightningFeeSats || 0);
          if (method.inner?.sparkTransferFeeSats) {
            feeAmount += Number(method.inner.sparkTransferFeeSats);
          }
        } else if (method.tag === 'BitcoinAddress' || method.type === 'bitcoinAddress') {
          const feeQuote = methodInner?.feeQuote || method?.feeQuote;
          if (feeQuote?.speedFast || feeQuote?.speedMedium || feeQuote?.speedSlow) {
            const extractL1 = (q: any) => Number(q?.l1BroadcastFeeSat ?? 0);
            const extractService = (q: any) => Number(q?.userFeeSat ?? q?.feeSats ?? 0);
            // Total fee = service fee + L1 broadcast fee
            const extractFee = (q: any) => extractService(q) + extractL1(q);
            const extractSatPerVbyte = (q: any) => {
              const direct = Number(q?.satPerVbyte ?? q?.sat_per_vbyte ?? 0);
              if (direct > 0) return direct;
              const l1Fee = extractL1(q);
              if (l1Fee > 0) return Math.round(l1Fee / 140);
              return undefined;
            };
            const buildQuote2 = (q: any): OnchainFeeQuote => ({
              feeSats: extractFee(q),
              serviceFee: extractService(q),
              l1Fee: extractL1(q),
              satPerVbyte: extractSatPerVbyte(q),
              estimatedConfirmationTime: q?.estimatedConfirmationTime,
            });
            extractedFeeQuotes = {
              fast: buildQuote2(feeQuote.speedFast),
              medium: buildQuote2(feeQuote.speedMedium),
              slow: buildQuote2(feeQuote.speedSlow),
            };
            feeAmount = getOnchainFeeQuote(selectedSpeed, extractedFeeQuotes);
          } else {
            feeAmount = Number(methodInner?.feeQuote?.feeSats || 0);
          }
        }
      }

      if (isOnchainFlow) {
        const defaultSpeed: ConfirmationSpeed = 'medium';
        setSelectedSpeed(defaultSpeed);
        setOnchainFeeQuotes(extractedFeeQuotes);
        feeAmount = extractedFeeQuotes ? getOnchainFeeQuote(defaultSpeed, extractedFeeQuotes) : feeAmount;
      } else {
        setOnchainFeeQuotes(null);
      }

      const totalAmount = paymentAmount + feeAmount;

      if (totalAmount > availableBalance) {
        Alert.alert(
          t('send.insufficientBalance'),
          t('send.insufficientBalanceWithFee')
            .replace('{{total}}', totalAmount.toLocaleString())
            .replace('{{fee}}', feeAmount.toLocaleString())
            .replace('{{balance}}', availableBalance.toLocaleString())
        );
        return;
      }

      const paymentPreview: PaymentPreview = {
        recipient: resolvedInput,
        amount: paymentAmount,
        fee: feeAmount,
        total: totalAmount,
        description: parsedRequest.description || comment || undefined,
      };

      setPreview(paymentPreview);
      setStep(isOnchainFlow ? 'onchain-preview' : 'preview');
    } catch (error) {
      console.error('Failed to prepare payment:', error);

      let errorMessage = error instanceof Error ? error.message : String(error);
      // Try to extract from SDK error objects
      if (errorMessage === '[object Object]' && typeof error === 'object' && error !== null) {
        const e = error as Record<string, unknown>;
        errorMessage = (e.message as string) || (e.variant as string) || JSON.stringify(error);
      }

      if (errorMessage.includes('Network request failed') || errorMessage.includes('Failed to resolve')) {
        errorMessage = 'Could not reach the Lightning Address provider. Please check the address is correct (e.g., user@wallet.com).';
      } else if (/invalid\s*input/i.test(errorMessage)) {
        // The SDK's raw "InvalidInput" is meaningless to users. Map it to a
        // clear, actionable message — this fires when the destination isn't a
        // recognisable invoice / Lightning Address / LNURL / Bitcoin address.
        errorMessage = 'We couldn’t read that destination. Make sure it’s a valid Lightning invoice, Lightning Address (name@domain), LNURL, or Bitcoin address.';
      }

      Alert.alert(t('send.paymentError'), errorMessage);
      // Clear any stale prepare state from previous attempts
      setPreview(null);
      setPrepareResponse(null);
    } finally {
      setIsPreparing(false);
    }
  }, [paymentInput, amount, comment, balance, inputCurrency, convertToSats, getOnchainFeeQuote, selectedSpeed, activeTab, isUsdbAsset, usdbTokenIdentifier, isValidUsdbSparkPayment, recipientAsset, selectedCrossChainRoute, t]);

  const handleSendPayment = useCallback(async () => {
    if (!preview || !prepareResponse) {
      return;
    }
    // Guard against a second submit reusing the same prepared payment. The
    // SDK rejects a re-send of an already-used payment hash ("payment request
    // already exists"), so we drop any tap that lands while one is in flight —
    // a ref (not state) so it's correct even within the same render tick.
    if (sendInFlightRef.current) {
      return;
    }
    sendInFlightRef.current = true;

    try {
      setIsSending(true);

      const isOnchainFlow = step === 'onchain-preview';
      const result = isOnchainFlow
        ? await BreezSparkService.sendOnchainPayment(prepareResponse, selectedSpeed)
        : await BreezSparkService.sendPayment(prepareResponse, paymentInput, preview.amount);

      if (result.success) {
        if (result.paymentId && comment.trim()) {
          try {
            await AsyncStorage.setItem(`payment_note_${result.paymentId}`, comment.trim());
          } catch {
            // Non-critical — ignore storage errors
          }
        }
        // Detect whether the recipient was a human-readable Lightning Address
        // (name@domain) or an LNURL — the only inputs worth labelling / saving
        // as a contact. Raw BOLT11 invoices aren't a meaningful recipient.
        const recipientRaw = paymentInput.trim();
        const looksLikeAddress = recipientRaw.includes('@') && !recipientRaw.toLowerCase().startsWith('ln');
        const looksLikeLnurl = recipientRaw.toLowerCase().startsWith('lnurl');
        const isPersistableRecipient = looksLikeAddress || looksLikeLnurl;
        const isContactSavableRecipient = looksLikeAddress;

        // Persist the recipient when we paid a Lightning Address / LNURL.
        // The SDK's payment history doesn't reliably surface the human-
        // readable destination, but we know exactly what the user entered
        // here — store it locally so the transaction details can show
        // "To: name@domain" later.
        if (result.paymentId && isPersistableRecipient) {
          try {
            await AsyncStorage.setItem(`payment_recipient_${result.paymentId}`, recipientRaw);
          } catch {
            // Non-critical — ignore storage errors
          }
        }
        await refreshBalance();

        // Offer to save the recipient as a contact — but only for a
        // human-readable Lightning Address that isn't already in the address
        // book. Raw BOLT11 invoices and LNURLs are not useful contact labels.
        const alreadyAContact =
          isContactSavableRecipient &&
          contacts.some(
            (c) =>
              normalizeLightningAddress(c.lightningAddress) ===
              normalizeLightningAddress(recipientRaw)
          );
        await new Promise(resolve => setTimeout(resolve, 1000));
        // Clear the prepared payment so nothing can re-submit it, then redirect
        // home. For an unsaved Lightning Address we pass it along so Home can
        // open the in-place save-contact sheet over the balance page.
        setPrepareResponse(null);
        if (isContactSavableRecipient && !alreadyAContact) {
          router.navigate({ pathname: '/wallet/home', params: { saveContact: recipientRaw } });
        } else {
          router.navigate('/wallet/home');
        }
      } else {
        const errorMsg = result.error || 'Unknown error occurred';
        const details = result.errorDetails ? `\n\nDetails:\n${result.errorDetails}` : '';
        Alert.alert(t('send.paymentFailed'), `${errorMsg}${details}`);
        // Clear stale prepare state so next send attempt doesn't reuse it
        setStep('input');
        setPreview(null);
        setPrepareResponse(null);
      }
    } catch (error) {
      console.error('Failed to send payment:', error);
      const msg = error instanceof Error ? error.message : String(error);
      Alert.alert(t('common.error'), msg);
      // Clear stale prepare state on error too
      setStep('input');
      setPreview(null);
      setPrepareResponse(null);
    } finally {
      setIsSending(false);
      sendInFlightRef.current = false;
    }
  }, [preview, prepareResponse, refreshBalance, step, selectedSpeed, paymentInput, comment, contacts, t]);

  const handleBackToInput = useCallback(() => {
    setStep('input');
    setPreview(null);
    setPrepareResponse(null);
    setOnchainFeeQuotes(null);
    setSelectedSpeed('medium');
  }, []);

  // System back while in a sub-step of the send flow (inline scanner or
  // payment preview) must step back WITHIN the flow instead of popping the
  // whole Send screen — which dumped the user on Home.
  //
  // Android: hardware back button / back gesture via BackHandler (runs before
  // the navigator's own handler; returning true stops the pop).
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (step === 'scanning') {
        setStep('input');
        return true;
      }
      if (step === 'preview' || step === 'onchain-preview') {
        handleBackToInput();
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, [step, handleBackToInput]);

  // iOS: the swipe-back gesture completes NATIVELY on a native stack — the
  // screen is already dismissed before JS hears about it, so it can't be
  // remapped to an in-flow step-back (only disabled entirely, which felt
  // broken). Deliberate trade-off: the gesture stays enabled and pops the
  // whole Send screen to Home even from the scanner/preview sub-steps; the
  // on-screen ← Back is the way to step back within the flow on iOS.

  const handleSelectSpeed = useCallback(
    (speed: ConfirmationSpeed) => {
      if (!preview) {
        setSelectedSpeed(speed);
        return;
      }

      const feeAmount = getOnchainFeeQuote(speed, onchainFeeQuotes);
      const totalAmount = preview.amount + feeAmount;
      if (totalAmount > balance) {
        Alert.alert(
          t('send.insufficientBalance'),
          t('send.insufficientBalanceWithFee')
            .replace('{{total}}', totalAmount.toLocaleString())
            .replace('{{fee}}', feeAmount.toLocaleString())
            .replace('{{balance}}', balance.toLocaleString())
        );
        return;
      }

      setSelectedSpeed(speed);
      setPreview({
        ...preview,
        fee: feeAmount,
        total: totalAmount,
      });
    },
    [preview, onchainFeeQuotes, balance, getOnchainFeeQuote]
  );

  const speedOptions = useMemo(
    () => {
      const buildOption = (key: ConfirmationSpeed, labelKey: string, defaultTime: string, quote?: OnchainFeeQuote) => ({
        key,
        label: t(labelKey),
        time: formatEstimatedTime(quote?.estimatedConfirmationTime, defaultTime),
        fee: Number(quote?.feeSats || 0),
        serviceFee: Number(quote?.serviceFee || 0),
        l1Fee: Number(quote?.l1Fee || 0),
        satPerVbyte: quote?.satPerVbyte,
      });
      return [
        buildOption('fast', 'send.speedFast', '10', onchainFeeQuotes?.fast),
        buildOption('medium', 'send.speedMedium', '30', onchainFeeQuotes?.medium),
        buildOption('slow', 'send.speedSlow', '60', onchainFeeQuotes?.slow),
      ];
    },
    [onchainFeeQuotes, formatEstimatedTime]
  );

  const selectedOnchainQuote = useMemo(() => {
    if (!onchainFeeQuotes) return undefined;
    return onchainFeeQuotes[selectedSpeed];
  }, [onchainFeeQuotes, selectedSpeed]);

  if (step === 'scanning') {
    return (
      <LinearGradient colors={gradientColors} style={styles.gradient}>
        <SafeAreaView style={styles.container}>
          <View style={styles.header}>
            <TouchableOpacity onPress={() => setStep('input')}>
              <Text style={styles.backButton}>← {t('common.back')}</Text>
            </TouchableOpacity>
            <Text style={[styles.headerTitle, { color: primaryTextColor }]}>{t('send.scanQrCode')}</Text>
            <View style={styles.headerSpacer} />
          </View>

          <View style={styles.scannerContainer}>
            <CameraView
              style={StyleSheet.absoluteFillObject}
              facing="back"
              barcodeScannerSettings={{
                barcodeTypes: ['qr'],
              }}
              onBarcodeScanned={scanned ? undefined : handleBarCodeScanned}
            />
            <View style={styles.overlay}>
              <View style={styles.overlayTop} />
              <View style={styles.overlayMiddle}>
                <View style={styles.overlaySide} />
                <View style={styles.scanFrame}>
                  <View style={[styles.corner, styles.cornerTopLeft]} />
                  <View style={[styles.corner, styles.cornerTopRight]} />
                  <View style={[styles.corner, styles.cornerBottomLeft]} />
                  <View style={[styles.corner, styles.cornerBottomRight]} />
                  <View style={styles.crosshairHorizontal} />
                  <View style={styles.crosshairVertical} />
                </View>
                <View style={styles.overlaySide} />
              </View>
              <View style={styles.overlayBottom}>
                <Text style={styles.scannerText}>
                  {activeTab === 'onchain' ? t('send.scanOnchainQr') : t('send.scanLightningQr')}
                </Text>
              </View>
            </View>
          </View>
        </SafeAreaView>
      </LinearGradient>
    );
  }

  if ((step === 'preview' || step === 'onchain-preview') && preview) {
    const isOnchainPreview = step === 'onchain-preview';
    const previewFiat = {
      amount: formatPreviewFiat(preview.amount),
      fee: formatPreviewFiat(preview.fee),
      total: formatPreviewFiat(preview.total),
    };
    const shouldShowFiatUnavailable =
      !isUsdbAsset && (!previewFiat.amount || !previewFiat.fee || !previewFiat.total);

    return (
      <LinearGradient colors={gradientColors} style={styles.gradient}>
        <SafeAreaView style={styles.container}>
          <View style={styles.header}>
            <TouchableOpacity onPress={handleBackToInput}>
              <Text style={styles.backButton}>← {t('common.back')}</Text>
            </TouchableOpacity>
            <Text style={[styles.headerTitle, { color: primaryTextColor }]}>{isOnchainPreview ? t('send.onchainTitle') : t('wallet.send')}</Text>
            <View style={styles.headerSpacer} />
          </View>

          <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent}>
            <Text style={[styles.sectionTitle, { color: primaryTextColor }]}>{t('send.paymentPreview')}</Text>

            {isOnchainPreview && (
              <View style={styles.onchainSelectorContainer}>
                <Text style={[styles.label, { color: primaryTextColor }]}>{t('send.confirmationSpeed')}</Text>
                <View style={styles.speedSelectorRow}>
                  {speedOptions.map((option) => {
                    const isSelected = selectedSpeed === option.key;
                    return (
                      <TouchableOpacity
                        key={option.key}
                        onPress={() => handleSelectSpeed(option.key)}
                        style={[
                          styles.speedOption,
                          {
                            borderColor: isSelected ? BRAND_COLOR : 'rgba(255, 255, 255, 0.2)',
                            backgroundColor: isSelected ? 'rgba(255, 193, 7, 0.12)' : 'rgba(255, 255, 255, 0.05)',
                          },
                        ]}
                      >
                        <Text style={[styles.speedOptionTitle, { color: primaryTextColor }]}>
                          {option.label}
                        </Text>
                        <Text style={[styles.speedOptionSubtitle, { color: secondaryTextColor }]}>
                          {option.time}
                        </Text>
                        <Text style={[styles.speedOptionFee, { color: primaryTextColor }]}>
                          {option.fee.toLocaleString()} sats{option.satPerVbyte ? ` (${option.satPerVbyte} sat/vB)` : ''}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>
            )}

            <View style={styles.previewContainer}>
              <View style={styles.previewRow}>
                <Text style={[styles.previewLabel, { color: secondaryTextColor }]}>{t('send.recipient')}</Text>
                <Text style={[styles.previewValue, { color: primaryTextColor }]} numberOfLines={1} ellipsizeMode="middle">
                  {preview.recipient}
                </Text>
              </View>

              <View style={styles.previewRow}>
                <Text style={[styles.previewLabel, { color: secondaryTextColor }]}>{t('payments.amount')}:</Text>
                <View style={styles.previewValueStack}>
                  <Text style={[styles.previewAmount, { color: primaryTextColor }]}>
                    {isUsdbAsset ? `${formatUsdbFromBaseUnits(preview.amount)} USDB` : `${preview.amount.toLocaleString()} sats`}
                  </Text>
                  {previewFiat.amount && (
                    <Text style={[styles.previewFiatEstimate, { color: secondaryTextColor }]}>
                      {previewFiat.amount}
                    </Text>
                  )}
                </View>
              </View>

              <View style={styles.previewRow}>
                <Text style={[styles.previewLabel, { color: secondaryTextColor }]}>{t('wallet.fee')}:</Text>
                <View style={styles.previewValueStack}>
                  <Text style={[styles.previewFee, { color: secondaryTextColor }]}>
                    {isUsdbAsset ? `${formatUsdbFromBaseUnits(preview.fee)} USDB` : `${preview.fee.toLocaleString()} sats`}{isOnchainPreview && selectedOnchainQuote?.satPerVbyte ? ` (${selectedOnchainQuote.satPerVbyte} sat/vB)` : ''}
                  </Text>
                  {previewFiat.fee && (
                    <Text style={[styles.previewFiatEstimate, { color: secondaryTextColor }]}>
                      {previewFiat.fee}
                    </Text>
                  )}
                </View>
              </View>

              <View style={[styles.previewRow, styles.previewTotal]}>
                <Text style={[styles.previewTotalLabel, { color: primaryTextColor }]}>{t('send.total')}</Text>
                <View style={styles.previewTotalStack}>
                  <Text style={styles.previewTotalAmount}>
                    {isUsdbAsset ? `${formatUsdbFromBaseUnits(preview.total)} USDB` : `${preview.total.toLocaleString()} sats`}
                  </Text>
                  {previewFiat.total && (
                    <Text style={[styles.previewTotalFiatEstimate, { color: secondaryTextColor }]}>
                      {previewFiat.total}
                    </Text>
                  )}
                </View>
              </View>

              {shouldShowFiatUnavailable && (
                <Text style={[styles.previewFiatUnavailable, { color: secondaryTextColor }]}>
                  Fiat estimate unavailable
                </Text>
              )}

              {preview.description && (
                <View style={styles.previewRow}>
                  <Text style={[styles.previewLabel, { color: secondaryTextColor }]}>{t('payments.description')}:</Text>
                  <Text style={[styles.previewValue, { color: primaryTextColor }]}>{preview.description}</Text>
                </View>
              )}
            </View>

            <View style={styles.buttonRow}>
              <Button
                mode="outlined"
                onPress={handleBackToInput}
                disabled={isSending}
                style={[styles.cancelButton, { borderColor: secondaryTextColor }]}
                textColor={secondaryTextColor}
              >
                {t('common.cancel')}
              </Button>

              <Button
                mode="contained"
                onPress={handleSendPayment}
                loading={isSending}
                disabled={isSending}
                style={styles.sendButton}
                buttonColor={BRAND_COLOR}
                textColor="#1a1a2e"
              >
                {isOnchainPreview ? t('send.sendOnchainCta') : t('payments.sendPayment')}
              </Button>
            </View>
          </ScrollView>
        </SafeAreaView>
      </LinearGradient>
    );
  }

  const isLightningTab = activeTab === 'lightning';

  return (
    <LinearGradient colors={gradientColors} style={styles.gradient}>
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()}>
            <Text style={styles.backButton}>← {t('common.back')}</Text>
          </TouchableOpacity>
          <Text style={[styles.headerTitle, { color: primaryTextColor }]}>{t('wallet.send')}</Text>
          <View style={styles.headerSpacer} />
        </View>

        <View style={styles.tabContainer}>
          <TouchableOpacity
            onPress={() => handleTabChange('lightning')}
            style={[
              styles.tabButton,
              isLightningTab && styles.tabButtonActive,
              { borderColor: BRAND_COLOR },
            ]}
          >
            <Text style={[styles.tabText, { color: isLightningTab ? '#1a1a2e' : primaryTextColor }]}>
              {t('send.lightningTab')}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => handleTabChange('onchain')}
            disabled={isUsdbAsset}
            style={[
              styles.tabButton,
              !isLightningTab && styles.tabButtonActive,
              isUsdbAsset && styles.tabButtonDisabled,
              { borderColor: BRAND_COLOR },
            ]}
          >
            <Text style={[styles.tabText, { color: !isLightningTab ? '#1a1a2e' : primaryTextColor }]}>
              {t('send.onchainTab')}
            </Text>
          </TouchableOpacity>
        </View>

        <View style={styles.recipientAssetSection}>
          <Text style={[styles.recipientAssetLabel, { color: primaryTextColor }]}>Recipient receives</Text>
          <View style={styles.recipientAssetSelector} accessibilityRole="radiogroup" accessibilityLabel="Recipient receives">
            {RECIPIENT_ASSET_OPTIONS.filter((option) => CROSS_CHAIN_SEND_ENABLED || (option.value !== 'usdt' && option.value !== 'usdc')).map((option) => {
              const isSelected = recipientAsset === option.value;
              return (
                <TouchableOpacity
                  key={option.value}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: isSelected }}
                  accessibilityLabel={option.label}
                  onPress={() => setRecipientAsset(option.value)}
                  style={[
                    styles.recipientAssetOption,
                    isSelected && styles.recipientAssetOptionSelected,
                  ]}
                >
                  <Text style={[
                    styles.recipientAssetOptionText,
                    { color: isSelected ? '#1a1a2e' : primaryTextColor },
                  ]}>
                    {option.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {isUsdbAsset && (
          <View style={styles.usdbBanner}>
            <Text style={styles.usdbBannerText}>USDB transfers stay on Spark.</Text>
            {SWAP_FEATURE_ENABLED && (
              <Text onPress={handleSwitchToBtc} style={styles.usdbBannerAction}>Swap to BTC →</Text>
            )}
          </View>
        )}

        <ScrollView
          ref={formScrollRef}
          style={styles.scrollView}
          // Reserve the keyboard height as extra bottom padding so the lower
          // fields (amount / comment) have room to scroll above the overlaying
          // keyboard. Fully manual — no KeyboardAvoidingView / adjustResize,
          // which don't shrink the window under Android edge-to-edge.
          contentContainerStyle={[styles.scrollContent, kbContentPadding]}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          scrollEventThrottle={16}
          onScroll={onFormScroll}
        >
          <View style={styles.balanceContainer}>
            <Text style={[styles.balanceLabel, { color: secondaryTextColor }]}>{t('send.availableBalance')}</Text>
            <Text style={styles.balanceAmount}>{isUsdbAsset ? `${usdbBalance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDB` : `${balance.toLocaleString()} sats`}</Text>
            {balanceDisplay.fiatDisplay && (
              <Text style={[styles.balanceFiat, { color: secondaryTextColor }]}>{balanceDisplay.fiatDisplay}</Text>
            )}
          </View>

          {!isLightningTab && (
            <View style={styles.onchainInfoCard}>
              <Text style={[styles.onchainInfoTitle, { color: primaryTextColor }]}>{t('send.onchainModeTitle')}</Text>
              <Text style={[styles.onchainInfoText, { color: secondaryTextColor }]}>{t('send.onchainModeDescription')}</Text>
            </View>
          )}

          <Text style={[styles.sectionLabel, { color: primaryTextColor }]}>
            {isLightningTab ? t('send.lightningDestinationLabel') : t('send.onchainAddressLabel')}
          </Text>

          {isLightningTab && selectedContact ? (
            <View style={styles.selectedContactContainer}>
              <View style={styles.selectedContactHeader}>
                <Text style={styles.selectedContactName}>{contactDisplayName(selectedContact)}</Text>
                <IconButton
                  icon="close"
                  iconColor="rgba(255, 255, 255, 0.7)"
                  size={20}
                  onPress={handleClearContact}
                  style={styles.clearContactButton}
                />
              </View>
              <Text style={styles.selectedContactAddress} numberOfLines={1} ellipsizeMode="middle">
                {activeAsset === 'USDB' ? selectedContact.sparkAddress : selectedContact.lightningAddress}
              </Text>
            </View>
          ) : isLightningTab ? (
            <View style={styles.inputWithButtonRow}>
              <StyledTextInput
                placeholder={t('send.lightningInputPlaceholder')}
                value={paymentInput}
                onChangeText={handlePaymentInputChange}
                onFocus={scrollFieldIntoView}
                inputAccessoryViewID={kbAccessoryId}
                style={[styles.input, styles.inputWithButton]}
                multiline
                numberOfLines={2}
                // Top-align so pasted invoices read from the top of the box
                // instead of getting pushed to the bottom border (Android's
                // default vertical-center on a multiline-sized TextInput).
                textAlignVertical="top"
                contentStyle={styles.pasteInputContent}
              />
              <TouchableOpacity
                style={styles.addressBookButton}
                onPress={() => {
                  setContactModalVisible(true);
                }}
              >
                <IconButton icon="contacts" iconColor={BRAND_COLOR} size={24} style={styles.addressBookIcon} />
              </TouchableOpacity>
            </View>
          ) : (
            <StyledTextInput
              placeholder={t('send.onchainInputPlaceholder')}
              value={paymentInput}
              onChangeText={handlePaymentInputChange}
              onFocus={scrollFieldIntoView}
              inputAccessoryViewID={kbAccessoryId}
              style={styles.input}
              // Bitcoin addresses are long enough that they overflow the
              // visible field width; enable multiline + wrap so the entire
              // address is readable. Top-align matches the Lightning input.
              multiline
              numberOfLines={2}
              textAlignVertical="top"
              contentStyle={styles.pasteInputContent}
              error={!!addressError}
            />
          )}

          {addressError && activeTab === 'onchain' && (
            <Text style={styles.addressErrorText}>{addressError}</Text>
          )}

          {(recipientAsset === 'usdt' || recipientAsset === 'usdc') && (
            <View style={styles.destinationNetworkSection}>
              <Text style={[styles.label, { color: primaryTextColor }]}>Destination network</Text>
              {isLoadingCrossChainRoutes && <Text style={[styles.destinationNetworkHint, { color: secondaryTextColor }]}>Loading live Breez routes…</Text>}
              {!!crossChainRouteError && <Text style={styles.addressErrorText}>{crossChainRouteError}</Text>}
              <View style={styles.recipientAssetSelector}>
                {crossChainRoutes.map(({ route, destination }) => {
                  const isSelected = selectedCrossChainRoute === route;
                  const label = destination.chainId ? `${destination.chain} (${destination.chainId})` : destination.chain;
                  return (
                    <TouchableOpacity
                      key={`${destination.provider}:${destination.chain}:${destination.chainId || ''}`}
                      accessibilityRole="radio"
                      accessibilityState={{ selected: isSelected }}
                      accessibilityLabel={label}
                      onPress={() => setSelectedCrossChainRoute(route)}
                      style={[styles.recipientAssetOption, isSelected && styles.recipientAssetOptionSelected]}
                    >
                      <Text style={[styles.recipientAssetOptionText, { color: isSelected ? '#1a1a2e' : primaryTextColor }]}>{label}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          )}

          {!!usdbLightningError && isLightningTab && isUsdbAsset && (
            <View style={styles.usdbInlineErrorContainer}>
              <Text style={styles.usdbInlineErrorText}>{usdbLightningError}</Text>
              <Text onPress={handleSwitchToBtc} style={styles.usdbInlineErrorAction}>Switch to BTC</Text>
            </View>
          )}

          <Button
            mode="outlined"
            onPress={handleScanQR}
            icon="qrcode-scan"
            style={styles.scanButton}
            textColor={BRAND_COLOR}
          >
            {t('send.scanQrCode')}
          </Button>

          <ContactSelectionModal
            visible={contactModalVisible}
            onDismiss={() => setContactModalVisible(false)}
            onSelect={handleContactSelect}
            contacts={contacts}
            myAddress={addressInfo?.lightningAddress}
            activeAsset={activeAsset}
          />

          {isLightningTab ? (
            <>
              <Text style={[styles.label, { color: primaryTextColor }]}>{t('send.amountLabel')}</Text>

              <View style={styles.amountInputRow}>
                <StyledTextInput
                  label={t('send.amountInCurrency').replace('{{currency}}', currencyLabels[effectiveInputCurrency])}
                  value={amount}
                  onChangeText={setAmount}
                  onFocus={scrollFieldIntoView}
                  inputAccessoryViewID={kbAccessoryId}
                  keyboardType="decimal-pad"
                  editable={!amountLocked}
                  style={[styles.input, styles.amountInput, amountLocked && { opacity: 0.7 }]}
                />

                <TouchableOpacity
                  style={[styles.currencySelector, { backgroundColor: gradientColors[1] || '#16213e' }, amountLocked && { opacity: 0.5 }]}
                  onPress={amountLocked ? undefined : () => setShowCurrencyPicker(true)}
                  disabled={amountLocked}
                >
                  <Text style={styles.currencySelectorText}>{currencyLabels[effectiveInputCurrency]}</Text>
                </TouchableOpacity>
              </View>

              {amountLocked && (
                <Text style={[styles.conversionFiat, { marginTop: 4 }]}>Amount fixed by invoice</Text>
              )}

              {previewDisplay && previewSats > 0 && inputCurrency !== 'sats' && (
                <View style={styles.conversionPreview}>
                  <Text style={styles.conversionText}>≈ {previewDisplay.satsDisplay}</Text>
                  {previewDisplay.fiatDisplay && <Text style={styles.conversionFiat}>({previewDisplay.fiatDisplay})</Text>}
                </View>
              )}

              {/* No low-amount warning on the Lightning tab — LN can route
                  arbitrary amounts down to 1 sat. The warning only applies
                  to on-chain sends, where dust-limit + fee economics make
                  very small sends impractical for the receiving wallet. */}

              <Text style={[styles.label, { color: primaryTextColor }]}>{t('send.commentLabel')}</Text>

              <StyledTextInput
                placeholder={t('send.paymentDescriptionPlaceholder')}
                value={comment}
                onChangeText={setComment}
                onFocus={scrollFieldIntoView}
                inputAccessoryViewID={kbAccessoryId}
                returnKeyType="done"
                onSubmitEditing={() => Keyboard.dismiss()}
                style={styles.input}
              />
            </>
          ) : (
            <>
              <Text style={[styles.label, { color: primaryTextColor }]}>{t('send.amountRequiredOnchainLabel')}</Text>

              <View style={styles.amountInputRow}>
                <StyledTextInput
                  label={t('send.amountInCurrency').replace('{{currency}}', currencyLabels[effectiveInputCurrency])}
                  value={amount}
                  onChangeText={setAmount}
                  onFocus={scrollFieldIntoView}
                  inputAccessoryViewID={kbAccessoryId}
                  keyboardType="decimal-pad"
                  editable={!amountLocked}
                  style={[styles.input, styles.amountInput, amountLocked && { opacity: 0.7 }]}
                />

                <TouchableOpacity
                  style={[styles.currencySelector, { backgroundColor: gradientColors[1] || '#16213e' }, amountLocked && { opacity: 0.5 }]}
                  onPress={amountLocked ? undefined : () => setShowCurrencyPicker(true)}
                  disabled={amountLocked}
                >
                  <Text style={styles.currencySelectorText}>{currencyLabels[effectiveInputCurrency]}</Text>
                </TouchableOpacity>
              </View>

              {amountLocked && (
                <Text style={[styles.conversionFiat, { marginTop: 4 }]}>Amount fixed by URI</Text>
              )}

              {previewDisplay && previewSats > 0 && inputCurrency !== 'sats' && (
                <View style={styles.conversionPreview}>
                  <Text style={styles.conversionText}>≈ {previewDisplay.satsDisplay}</Text>
                  {previewDisplay.fiatDisplay && <Text style={styles.conversionFiat}>({previewDisplay.fiatDisplay})</Text>}
                </View>
              )}

              {(() => {
                // On-chain tab is BTC-only; `inputCurrency` is sats/usd/eur here.
                const btcInput = inputCurrency as DisplayCurrency;
                const onchainSats = btcInput === 'sats' ? Math.floor(Number(amount)) : convertToSats(parseFloat(amount) || 0, btcInput);
                if (!(amount.length > 0) || onchainSats <= 0) return null;
                if (onchainSats < 1000) {
                  return (
                    <Text style={{ color: '#f44336', fontSize: 12, marginTop: -4, marginBottom: 4 }}>
                      Minimum on-chain send: 1,000 sats
                    </Text>
                  );
                }
                if (onchainSats < 2000) {
                  return (
                    <Text style={styles.lowAmountWarning}>
                      If you are sending to another Lightning wallet, the recipient may not be able to receive this amount.
                    </Text>
                  );
                }
                return null;
              })()}

              <Text style={[styles.label, { color: primaryTextColor }]}>{t('send.confirmationSpeed')}</Text>
              <View style={styles.speedCardsColumn}>
                {speedOptions.map((option) => {
                  const isSelected = selectedSpeed === option.key;
                  return (
                    <TouchableOpacity
                      key={option.key}
                      onPress={() => setSelectedSpeed(option.key)}
                      style={[
                        styles.speedCard,
                        {
                          borderColor: isSelected ? BRAND_COLOR : 'rgba(255,255,255,0.18)',
                          backgroundColor: isSelected ? 'rgba(255, 193, 7, 0.13)' : 'rgba(255,255,255,0.05)',
                        },
                      ]}
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.speedCardTitle, { color: primaryTextColor }]}>{option.label}</Text>
                        <Text style={[styles.speedCardTime, { color: secondaryTextColor }]}>{option.time}</Text>
                      </View>
                      <Text style={[styles.speedCardFee, { color: onchainFeeQuotes ? primaryTextColor : secondaryTextColor }]}>
                        {isFetchingFees
                          ? '...'
                          : onchainFeeQuotes
                            ? `${option.fee.toLocaleString()} sats${option.satPerVbyte ? ` (${option.satPerVbyte} sat/vB)` : ''}`
                            : '-'}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              <View style={styles.onchainFeeRow}>
                <Text style={[styles.onchainFeeLabel, { color: secondaryTextColor }]}>{t('send.networkFee')}</Text>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={[styles.onchainFeeValue, { color: primaryTextColor }]}> 
                    {isFetchingFees
                      ? '...'
                      : onchainFeeQuotes
                        ? `${getOnchainFeeQuote(selectedSpeed, onchainFeeQuotes).toLocaleString()} sats`
                        : '-'}
                  </Text>
                </View>
              </View>
            </>
          )}

          <Button
            mode="contained"
            onPress={handlePreviewPayment}
            loading={isPreparing}
            disabled={
              isPreparing ||
              !paymentInput.trim() ||
              (!isLightningTab && !amount.trim()) ||
              (!isLightningTab && !!addressError) ||
              (!isLightningTab && Number(amount) > 0 && Number(amount) < 1000) ||
              (isLightningTab && inputCurrency !== 'sats' && isLoadingRates && amount !== '')
            }
            style={styles.previewButton}
            buttonColor={BRAND_COLOR}
            textColor="#1a1a2e"
          >
            {isLightningTab ? t('send.previewPayment') : t('send.previewOnchainCta')}
          </Button>
        </ScrollView>

        {/* Shared bottom-sheet currency picker. Same UX as the Receive
            screen — the asset (BTC vs USDB) decides which native unit
            (sats vs USDB) is offered alongside the fiat conversions. */}
        <CurrencyPickerSheet
          visible={showCurrencyPicker}
          selected={effectiveInputCurrency}
          title={isUsdbAsset ? 'Send amount in' : 'Send amount in'}
          currencies={isUsdbAsset ? ['usdb', 'usd', 'eur'] : ['sats', 'usd', 'eur']}
          onSelect={(next: PickerCurrency) => {
            setInputCurrency(next);
            // Persist the user's preference globally only for the BTC
            // display currencies — 'usdb' is a USDB-only input mode, not
            // a global display preference.
            if (next !== 'usdb') {
              void setDisplayCurrency(next);
            }
          }}
          onClose={() => setShowCurrencyPicker(false)}
        />

        {/* iOS keyboard "Done" bar — lets the user dismiss the keyboard in one
            tap (the address/amount fields are multiline/numeric and have no
            return key to do it). Shows whenever a field with the matching
            inputAccessoryViewID is focused. */}
        {Platform.OS === 'ios' && (
          <InputAccessoryView nativeID="sendKbAccessory">
            <View style={styles.kbAccessoryBar}>
              <TouchableOpacity
                onPress={() => Keyboard.dismiss()}
                style={styles.kbAccessoryDone}
                hitSlop={{ top: 8, bottom: 8, left: 12, right: 12 }}
              >
                <Text style={styles.kbAccessoryDoneText}>{t('common.done')}</Text>
              </TouchableOpacity>
            </View>
          </InputAccessoryView>
        )}
      </SafeAreaView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  gradient: {
    flex: 1,
  },
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.1)',
  },
  backButton: {
    fontSize: 16,
    color: BRAND_COLOR,
    fontWeight: '600',
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#FFFFFF',
  },
  headerSpacer: {
    width: 60,
  },
  tabContainer: {
    flexDirection: 'row',
    marginHorizontal: 24,
    marginTop: 16,
    marginBottom: 8,
    borderRadius: 14,
    padding: 4,
    backgroundColor: 'rgba(255,255,255,0.08)',
    gap: 6,
  },
  tabButton: {
    flex: 1,
    borderWidth: 1,
    borderColor: 'transparent',
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
  },
  tabButtonActive: {
    backgroundColor: BRAND_COLOR,
  },
  tabButtonDisabled: {
    opacity: 0.4,
  },
  recipientAssetSection: {
    marginHorizontal: 24,
    marginTop: 8,
  },
  recipientAssetLabel: {
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 8,
  },
  recipientAssetSelector: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  recipientAssetOption: {
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  recipientAssetOptionSelected: {
    borderColor: BRAND_COLOR,
    backgroundColor: BRAND_COLOR,
  },
  recipientAssetOptionText: {
    fontSize: 12,
    fontWeight: '700',
  },
  destinationNetworkSection: {
    marginTop: 4,
  },
  destinationNetworkHint: {
    fontSize: 12,
    marginBottom: 8,
  },
  usdbBanner: {
    marginHorizontal: 20,
    marginTop: 8,
    marginBottom: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
    backgroundColor: 'rgba(255,255,255,0.06)',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  usdbBannerText: {
    color: '#FFFFFF',
    fontSize: 12,
    flex: 1,
    marginRight: 8,
  },
  usdbBannerAction: {
    color: BRAND_COLOR,
    fontSize: 12,
    fontWeight: '700',
  },
  tabText: {
    fontSize: 14,
    fontWeight: '700',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 24,
    paddingTop: 16,
    paddingBottom: 120,
  },
  balanceContainer: {
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: 12,
    padding: 16,
    marginBottom: 18,
    alignItems: 'center',
  },
  balanceLabel: {
    fontSize: 14,
    color: 'rgba(255, 255, 255, 0.7)',
    marginBottom: 4,
  },
  balanceAmount: {
    fontSize: 24,
    fontWeight: 'bold',
    color: BRAND_COLOR,
  },
  onchainInfoCard: {
    backgroundColor: 'rgba(255, 193, 7, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(255, 193, 7, 0.35)',
    borderRadius: 12,
    padding: 14,
    marginBottom: 12,
  },
  onchainInfoTitle: {
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 4,
  },
  onchainInfoText: {
    fontSize: 13,
    lineHeight: 18,
  },
  label: {
    fontSize: 14,
    color: 'rgba(255, 255, 255, 0.9)',
    marginBottom: 8,
    marginTop: 16,
  },
  sectionLabel: {
    fontSize: 14,
    fontWeight: '500',
    color: 'rgba(255, 255, 255, 0.9)',
    marginBottom: 8,
    marginTop: 10,
  },
  input: {
    marginBottom: 0,
  },
  // Symmetric vertical padding for the paste-address / paste-invoice inputs
  // so the text sits centered when it's a single line and grows top-down
  // when wrapped (paired with `textAlignVertical="top"` on the input).
  pasteInputContent: {
    paddingTop: 12,
    paddingBottom: 12,
  },
  addressErrorText: {
    color: '#ef4444',
    fontSize: 12,
    marginTop: 4,
    marginBottom: 4,
  },
  usdbInlineErrorContainer: {
    marginTop: 4,
    marginBottom: 6,
  },
  usdbInlineErrorText: {
    color: '#ef4444',
    fontSize: 12,
  },
  usdbInlineErrorAction: {
    marginTop: 4,
    color: BRAND_COLOR,
    fontSize: 12,
    fontWeight: '700',
  },
  scanButton: {
    borderColor: BRAND_COLOR,
    marginTop: 10,
    marginBottom: 10,
  },
  previewButton: {
    marginTop: 24,
    marginBottom: 8,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#FFFFFF',
    marginBottom: 24,
  },
  previewContainer: {
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: 12,
    padding: 16,
    marginBottom: 24,
  },
  onchainSelectorContainer: {
    marginBottom: 16,
  },
  speedSelectorRow: {
    flexDirection: 'row',
    gap: 8,
  },
  speedOption: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
  },
  speedOptionTitle: {
    fontSize: 13,
    fontWeight: '600',
  },
  speedOptionSubtitle: {
    fontSize: 12,
    marginTop: 2,
  },
  speedOptionFee: {
    fontSize: 12,
    marginTop: 6,
    fontWeight: '600',
  },
  speedCardsColumn: {
    marginTop: 4,
    gap: 8,
  },
  speedCard: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  speedCardTitle: {
    fontSize: 15,
    fontWeight: '700',
  },
  speedCardTime: {
    marginTop: 3,
    fontSize: 12,
  },
  speedCardFee: {
    fontSize: 14,
    fontWeight: '700',
  },
  onchainFeeRow: {
    marginTop: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
    paddingVertical: 10,
    paddingHorizontal: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  onchainFeeLabel: {
    fontSize: 13,
  },
  onchainFeeValue: {
    fontSize: 14,
    fontWeight: '700',
  },
  previewRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.1)',
  },
  previewLabel: {
    fontSize: 14,
    color: 'rgba(255, 255, 255, 0.7)',
    flex: 1,
  },
  previewValue: {
    fontSize: 14,
    color: '#FFFFFF',
    flex: 2,
    textAlign: 'right',
  },
  previewValueStack: {
    flex: 2,
    alignItems: 'flex-end',
  },
  previewAmount: {
    fontSize: 18,
    fontWeight: '600',
    color: '#FFFFFF',
    textAlign: 'right',
  },
  previewFee: {
    fontSize: 16,
    color: 'rgba(255, 255, 255, 0.8)',
    textAlign: 'right',
  },
  previewFiatEstimate: {
    fontSize: 12,
    marginTop: 3,
    textAlign: 'right',
  },
  previewFiatUnavailable: {
    fontSize: 12,
    textAlign: 'right',
    marginTop: 6,
  },
  previewTotal: {
    borderBottomWidth: 0,
    paddingTop: 16,
    marginTop: 8,
  },
  previewTotalLabel: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#FFFFFF',
  },
  previewTotalStack: {
    flex: 1,
    alignItems: 'flex-end',
  },
  previewTotalAmount: {
    fontSize: 20,
    fontWeight: 'bold',
    color: BRAND_COLOR,
    textAlign: 'right',
  },
  previewTotalFiatEstimate: {
    fontSize: 13,
    marginTop: 4,
    textAlign: 'right',
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 12,
  },
  cancelButton: {
    flex: 1,
    borderColor: 'rgba(255, 255, 255, 0.3)',
  },
  sendButton: {
    flex: 1,
  },
  scannerContainer: {
    flex: 1,
    position: 'relative',
  },
  overlay: {
    flex: 1,
  },
  overlayTop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
  },
  overlayMiddle: {
    flexDirection: 'row',
  },
  overlaySide: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
  },
  scanFrame: {
    width: 250,
    height: 250,
    position: 'relative',
    justifyContent: 'center',
    alignItems: 'center',
  },
  corner: {
    position: 'absolute',
    width: 40,
    height: 40,
    borderColor: BRAND_COLOR,
    borderWidth: 3,
  },
  cornerTopLeft: {
    top: 0,
    left: 0,
    borderRightWidth: 0,
    borderBottomWidth: 0,
  },
  cornerTopRight: {
    top: 0,
    right: 0,
    borderLeftWidth: 0,
    borderBottomWidth: 0,
  },
  cornerBottomLeft: {
    bottom: 0,
    left: 0,
    borderRightWidth: 0,
    borderTopWidth: 0,
  },
  cornerBottomRight: {
    bottom: 0,
    right: 0,
    borderLeftWidth: 0,
    borderTopWidth: 0,
  },
  crosshairHorizontal: {
    position: 'absolute',
    width: 40,
    height: 2,
    backgroundColor: 'rgba(255, 193, 7, 0.8)',
  },
  crosshairVertical: {
    position: 'absolute',
    width: 2,
    height: 40,
    backgroundColor: 'rgba(255, 193, 7, 0.8)',
  },
  overlayBottom: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    alignItems: 'center',
    paddingTop: 32,
  },
  scannerText: {
    fontSize: 16,
    color: '#FFFFFF',
    textAlign: 'center',
  },
  balanceFiat: {
    fontSize: 14,
    color: 'rgba(255, 255, 255, 0.7)',
    marginTop: 4,
  },
  amountInputRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    marginBottom: 16,
  },
  amountInput: {
    flex: 1,
    marginBottom: 0,
    backgroundColor: undefined,
  },
  currencySelector: {
    backgroundColor: '#16213e',
    paddingHorizontal: 14,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: BRAND_COLOR,
    minWidth: 75,
    height: 56,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 6,
  },
  currencySelectorText: {
    color: BRAND_COLOR,
    fontSize: 14,
    fontWeight: '600',
  },
  currencyPickerOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  currencyPickerSheet: {
    width: 240,
    borderRadius: 12,
    paddingVertical: 8,
    paddingHorizontal: 4,
    elevation: 8,
  },
  currencyPickerTitle: {
    fontSize: 13,
    fontWeight: '600',
    paddingHorizontal: 16,
    paddingVertical: 8,
    opacity: 0.6,
  },
  currencyPickerItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 8,
  },
  currencyPickerItemActive: {
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  currencyPickerItemText: {
    fontSize: 16,
    fontWeight: '500',
  },
  conversionPreview: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: 'rgba(255, 193, 7, 0.1)',
    borderRadius: 8,
    marginTop: 8,
    marginBottom: 8,
    gap: 8,
  },
  conversionText: {
    color: BRAND_COLOR,
    fontSize: 16,
    fontWeight: '600',
  },
  conversionFiat: {
    color: 'rgba(255, 255, 255, 0.7)',
    fontSize: 14,
  },
  lowAmountWarning: {
    color: '#ff9800',
    fontSize: 12,
    marginTop: 4,
    marginBottom: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: 'rgba(255, 152, 0, 0.1)',
    borderRadius: 6,
    borderLeftWidth: 3,
    borderLeftColor: '#ff9800',
  },
  selectedContactContainer: {
    backgroundColor: 'rgba(255, 193, 7, 0.12)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 193, 7, 0.3)',
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginBottom: 0,
  },
  selectedContactHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  selectedContactName: {
    fontSize: 16,
    fontWeight: '600',
    color: BRAND_COLOR,
  },
  selectedContactAddress: {
    fontSize: 13,
    color: 'rgba(255, 255, 255, 0.6)',
    marginTop: 2,
  },
  clearContactButton: {
    margin: -8,
  },
  inputWithButtonRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
  },
  inputWithButton: {
    flex: 1,
  },
  addressBookButton: {
    backgroundColor: 'rgba(255, 193, 7, 0.1)',
    borderRadius: 8,
    marginLeft: 8,
    justifyContent: 'center',
    alignItems: 'center',
    width: 52,
    borderWidth: 1,
    borderColor: 'rgba(255, 193, 7, 0.3)',
  },
  addressBookIcon: {
    margin: 0,
  },
  kbAccessoryBar: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    backgroundColor: '#2a2a40',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255, 255, 255, 0.12)',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  kbAccessoryDone: {
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  kbAccessoryDoneText: {
    color: BRAND_COLOR,
    fontSize: 16,
    fontWeight: '700',
  },
});
