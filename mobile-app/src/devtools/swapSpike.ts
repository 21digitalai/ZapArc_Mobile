import { getRawSdkInstanceForDevtools } from '../services/breezSparkService';

type SpikeLine = string;

const PREFIX = '[swap-spike]';

function logLine(lines: SpikeLine[], message: string, payload?: unknown): void {
  if (payload !== undefined) {
    const rendered = typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2);
    const line = `${message} ${rendered}`;
    console.log(PREFIX, line);
    lines.push(line);
    return;
  }
  console.log(PREFIX, message);
  lines.push(message);
}

function extractUsdbIdentifierFromUnknown(input: unknown): string | null {
  if (!input) return null;
  const flat = JSON.stringify(input).toLowerCase();
  if (!flat.includes('usdb')) return null;

  const walk = (value: unknown): string | null => {
    if (!value) return null;
    if (typeof value === 'string') {
      return value.toLowerCase().includes('usdb') ? value : null;
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        const hit = walk(item);
        if (hit) return hit;
      }
      return null;
    }
    if (typeof value === 'object') {
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        const keyHit = k.toLowerCase().includes('tokenidentifier') && typeof v === 'string' ? v : null;
        if (keyHit) return keyHit;
        const hit = walk(v);
        if (hit) return hit;
      }
    }
    return null;
  };

  return walk(input);
}

export async function runSwapSpike(): Promise<{ ok: boolean; lines: SpikeLine[] }> {
  const lines: SpikeLine[] = [];

  if (!__DEV__) {
    logLine(lines, 'Refusing run outside __DEV__.');
    return { ok: false, lines };
  }

  const sdk = getRawSdkInstanceForDevtools() as Record<string, unknown> | null;
  if (!sdk) {
    logLine(lines, 'SDK instance missing. Connect wallet first, then retry.');
    return { ok: false, lines };
  }

  let usdbId: string | null = null;

  try {
    if (typeof sdk.getInfo === 'function') {
      const info = await (sdk.getInfo as (arg: object) => Promise<unknown>)({ ensureSynced: true });
      logLine(lines, 'getInfo() =>', info);
      usdbId = extractUsdbIdentifierFromUnknown(info);
      if (usdbId) logLine(lines, `USDB identifier found via getInfo(): ${usdbId}`);
    }

    if (!usdbId && typeof sdk.fetchConversionLimits === 'function') {
      const limits = await (sdk.fetchConversionLimits as () => Promise<unknown>)();
      logLine(lines, 'fetchConversionLimits() =>', limits);
      usdbId = extractUsdbIdentifierFromUnknown(limits);
      if (usdbId) logLine(lines, `USDB identifier found via fetchConversionLimits(): ${usdbId}`);
    }

    if (!usdbId && typeof sdk.getTokenIssuer === 'function') {
      const issuer = await (sdk.getTokenIssuer as () => Promise<unknown>)();
      logLine(lines, 'getTokenIssuer() =>', issuer);
      usdbId = extractUsdbIdentifierFromUnknown(issuer);
      if (usdbId) logLine(lines, `USDB identifier found via getTokenIssuer(): ${usdbId}`);
    }

    if (!usdbId) {
      logLine(lines, 'USDB identifier not discovered. Abort before prepare/send.');
      return { ok: false, lines };
    }

    if (typeof sdk.receivePayment !== 'function') {
      logLine(lines, 'receivePayment() unavailable on SDK instance.');
      return { ok: false, lines };
    }

    const recv = await (sdk.receivePayment as (arg: object) => Promise<{ paymentRequest: string }> )({
      paymentMethod: { tag: 'SparkAddress', inner: { tokenIdentifier: usdbId } },
    });
    logLine(lines, 'receivePayment(SparkAddress) =>', recv);

    if (typeof sdk.prepareSendPayment !== 'function') {
      logLine(lines, 'prepareSendPayment() unavailable on SDK instance.');
      return { ok: false, lines };
    }

    const prep = await (sdk.prepareSendPayment as (arg: object) => Promise<unknown>)({
      paymentRequest: recv.paymentRequest,
      amount: 1000n,
      conversionOptions: {
        conversionType: { tag: 'FromBitcoin' },
        maxSlippageBps: 1,
        completionTimeoutSecs: 30,
      },
    });
    logLine(lines, 'prepareSendPayment() =>', prep);

    if (typeof sdk.sendPayment !== 'function') {
      logLine(lines, 'sendPayment() unavailable on SDK instance.');
      return { ok: false, lines };
    }

    try {
      const result = await (sdk.sendPayment as (arg: object) => Promise<unknown>)({ preparedPayment: prep });
      logLine(lines, 'sendPayment() resolved =>', result);
      return { ok: true, lines };
    } catch (error) {
      logLine(lines, 'sendPayment() threw =>', error);
      return { ok: true, lines };
    }
  } catch (error) {
    logLine(lines, 'Spike execution failed =>', error);
    return { ok: false, lines };
  }
}
