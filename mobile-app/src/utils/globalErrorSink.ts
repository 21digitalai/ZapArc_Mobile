// Global error sink — bridges runtime errors that fire outside any React
// render scope (unhandled promise rejections, the global JS error handler,
// background service catches) into the user-visible Snackbar driven by
// FeedbackProvider.
//
// Why a module-level singleton: React Context isn't reachable from
// outside the component tree. The FeedbackProvider mounts once at app
// boot and registers itself here; afterwards every screen + service can
// route errors to the same surface without import gymnastics.
//
// We deliberately do NOT suppress, swallow, or rate-limit the errors —
// the design goal is "if something throws, the user knows". A noisy
// toast is better than a frozen UI of unknown cause.

type Sink = (message: string) => void;

let sink: Sink | null = null;
// Buffer messages that arrive before the FeedbackProvider mounts (e.g.
// from initializeDeepLinking running before the provider tree settles).
// Once a sink registers, the buffer drains.
const pendingBeforeMount: string[] = [];

export function setGlobalErrorSink(next: Sink | null): void {
  sink = next;
  if (next) {
    for (const msg of pendingBeforeMount.splice(0)) next(msg);
  }
}

/**
 * Report an error to the user. Accepts either an Error or a string.
 * Falls back to console.warn if the FeedbackProvider hasn't mounted yet
 * (and queues the message for replay once it does).
 */
export function reportError(label: string, error: unknown): void {
  const detail = error instanceof Error
    ? error.message
    : typeof error === 'string'
      ? error
      : '';
  const message = detail ? `${label}: ${detail}` : label;

  // Always log — keeps stack traces accessible to a developer reading
  // logcat / device console, regardless of UI surfacing.
  console.warn(`❗ [globalErrorSink] ${message}`, error);

  if (sink) {
    sink(message);
  } else {
    pendingBeforeMount.push(message);
  }
}

/**
 * Install a global handler for JS errors that escape React's error
 * boundaries (e.g. a stray unhandled promise rejection in a background
 * effect). Call once at app boot.
 *
 * We chain to the previous handler so React Native's red-box (dev) and
 * crash analytics (later) keep working.
 */
export function installGlobalErrorHandler(): void {
  // ErrorUtils is a global object in React Native that we redefine here
  // because TS doesn't ship its type by default.
  const RNErrorUtils = (globalThis as unknown as {
    ErrorUtils?: {
      setGlobalHandler: (handler: (err: Error, isFatal?: boolean) => void) => void;
      getGlobalHandler: () => (err: Error, isFatal?: boolean) => void;
    };
  }).ErrorUtils;

  if (!RNErrorUtils) return;

  const previous = RNErrorUtils.getGlobalHandler();
  RNErrorUtils.setGlobalHandler((error, isFatal) => {
    reportError(
      isFatal ? 'A fatal error occurred' : 'An unexpected error occurred',
      error,
    );
    previous?.(error, isFatal);
  });

  // Unhandled promise rejections (the typical "silent failure" path).
  // React Native polyfills `process` partially; the polyfilled
  // promise library hooks `unhandledrejection` on a global event bus.
  const proc = (globalThis as unknown as {
    process?: { on?: (evt: string, cb: (reason: unknown) => void) => void };
  }).process;
  if (proc?.on) {
    proc.on('unhandledRejection', (reason: unknown) => {
      reportError('Unhandled promise rejection', reason);
    });
  }
}
