// User Feedback Components
// Toast notifications, loading indicators, and confirmation dialogs

import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useRef,
  useEffect,
} from 'react';
import {
  View,
  StyleSheet,
  Modal,
  ActivityIndicator,
} from 'react-native';
import { Text, Button } from 'react-native-paper';
import { setGlobalErrorSink } from '../../../utils/globalErrorSink';
import { BRAND_COLOR } from '../../../utils/theme-helpers';
import { ToastBanner, type ToastTone } from './ToastBanner';

// =============================================================================
// Types
// =============================================================================

type ToastType = 'success' | 'error' | 'warning' | 'info';

// Map the simple feedback types onto the heads-up ToastBanner tone + glyph so
// every showSuccess/showError/showWarning/showInfo across the app renders with
// the same top "new" toast (no more bottom-positioned Snackbar-style toasts).
const TYPE_TO_TONE: Record<ToastType, ToastTone> = {
  success: 'success',
  error: 'danger',
  warning: 'warn',
  info: 'info',
};
const TYPE_TO_ICON: Record<ToastType, string> = {
  success: '✓',
  error: '✕',
  warning: '!',
  info: 'ℹ',
};

interface Toast {
  id: string;
  type: ToastType;
  message: string;
  duration: number;
}

interface ConfirmationOptions {
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  confirmStyle?: 'default' | 'destructive';
  icon?: string;
}

interface LoadingOptions {
  message?: string;
  timeout?: number;
}

interface FeedbackContextValue {
  showToast: (type: ToastType, message: string, duration?: number) => void;
  showSuccess: (message: string) => void;
  showError: (message: string) => void;
  showWarning: (message: string) => void;
  showInfo: (message: string) => void;
  showLoading: (options?: LoadingOptions) => () => void;
  hideLoading: () => void;
  confirm: (options: ConfirmationOptions) => Promise<boolean>;
}

// =============================================================================
// Context
// =============================================================================

const FeedbackContext = createContext<FeedbackContextValue | null>(null);

export function useFeedback(): FeedbackContextValue {
  const context = useContext(FeedbackContext);
  if (!context) {
    throw new Error('useFeedback must be used within a FeedbackProvider');
  }
  return context;
}

// =============================================================================
// Provider Component
// =============================================================================

interface FeedbackProviderProps {
  children: React.ReactNode;
}

export function FeedbackProvider({ children }: FeedbackProviderProps): React.JSX.Element {
  const [toast, setToast] = useState<Toast | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState<string | undefined>();
  const [confirmState, setConfirmState] = useState<{
    visible: boolean;
    options: ConfirmationOptions | null;
    resolve: ((value: boolean) => void) | null;
  }>({ visible: false, options: null, resolve: null });

  const loadingTimeoutRef = useRef<ReturnType<typeof global.setTimeout> | null>(null);

  // ========================================
  // Toast Functions
  // ========================================

  const showToast = useCallback(
    (type: ToastType, message: string, duration: number = 3000) => {
      const id = `toast_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      // Single current toast — ToastBanner owns the on-screen duration + the
      // enter/exit animation and calls onDismiss when it's done.
      setToast({ id, type, message, duration });
    },
    []
  );

  const showSuccess = useCallback(
    (message: string) => showToast('success', message),
    [showToast]
  );

  const showError = useCallback(
    (message: string) => showToast('error', message, 4000),
    [showToast]
  );

  // Register this provider as the global error sink so callers outside
  // the React tree (background services, the global RN error handler in
  // globalErrorSink.ts) can surface errors to the same Snackbar surface.
  // Re-registers if `showError` identity changes; clears on unmount.
  useEffect(() => {
    setGlobalErrorSink(showError);
    return () => setGlobalErrorSink(null);
  }, [showError]);

  const showWarning = useCallback(
    (message: string) => showToast('warning', message),
    [showToast]
  );

  const showInfo = useCallback(
    (message: string) => showToast('info', message),
    [showToast]
  );

  // ========================================
  // Loading Functions
  // ========================================

  const showLoading = useCallback((options: LoadingOptions = {}) => {
    setLoadingMessage(options.message);
    setIsLoading(true);

    // Optional timeout
    if (options.timeout) {
      loadingTimeoutRef.current = global.setTimeout(() => {
        setIsLoading(false);
      }, options.timeout);
    }

    // Return hide function
    return () => {
      setIsLoading(false);
      if (loadingTimeoutRef.current) {
        global.clearTimeout(loadingTimeoutRef.current);
      }
    };
  }, []);

  const hideLoading = useCallback(() => {
    setIsLoading(false);
    if (loadingTimeoutRef.current) {
      global.clearTimeout(loadingTimeoutRef.current);
    }
  }, []);

  // ========================================
  // Confirmation Functions
  // ========================================

  const confirm = useCallback(
    (options: ConfirmationOptions): Promise<boolean> => {
      return new Promise((resolve) => {
        setConfirmState({
          visible: true,
          options,
          resolve,
        });
      });
    },
    []
  );

  const handleConfirm = useCallback(() => {
    confirmState.resolve?.(true);
    setConfirmState({ visible: false, options: null, resolve: null });
  }, [confirmState]);

  const handleCancel = useCallback(() => {
    confirmState.resolve?.(false);
    setConfirmState({ visible: false, options: null, resolve: null });
  }, [confirmState]);

  // ========================================
  // Context Value
  // ========================================

  const value: FeedbackContextValue = {
    showToast,
    showSuccess,
    showError,
    showWarning,
    showInfo,
    showLoading,
    hideLoading,
    confirm,
  };

  return (
    <FeedbackContext.Provider value={value}>
      {children}

      {/* Global toast — the heads-up ToastBanner, docked at the top. Every
          showSuccess/showError/showWarning/showInfo call routes through here. */}
      <ToastBanner
        visible={!!toast}
        onDismiss={() => setToast(null)}
        title={toast?.message ?? ''}
        tone={toast ? TYPE_TO_TONE[toast.type] : 'info'}
        icon={toast ? TYPE_TO_ICON[toast.type] : undefined}
        duration={toast?.duration ?? 3000}
        position="top"
      />

      {/* Loading Modal */}
      <Modal visible={isLoading} transparent animationType="fade">
        <View style={styles.loadingOverlay}>
          <View style={styles.loadingContent}>
            <ActivityIndicator size="large" color={BRAND_COLOR} />
            {loadingMessage && (
              <Text style={styles.loadingText}>{loadingMessage}</Text>
            )}
          </View>
        </View>
      </Modal>

      {/* Confirmation Modal */}
      <Modal
        visible={confirmState.visible}
        transparent
        animationType="fade"
        onRequestClose={handleCancel}
      >
        <View style={styles.confirmOverlay}>
          <View style={styles.confirmContent}>
            {confirmState.options?.icon && (
              <Text style={styles.confirmIcon}>{confirmState.options.icon}</Text>
            )}
            <Text style={styles.confirmTitle}>
              {confirmState.options?.title}
            </Text>
            <Text style={styles.confirmMessage}>
              {confirmState.options?.message}
            </Text>
            <View style={styles.confirmButtons}>
              <Button
                mode="outlined"
                onPress={handleCancel}
                style={styles.cancelButton}
                labelStyle={styles.cancelButtonLabel}
              >
                {confirmState.options?.cancelText || 'Cancel'}
              </Button>
              <Button
                mode="contained"
                onPress={handleConfirm}
                style={[
                  styles.confirmButton,
                  confirmState.options?.confirmStyle === 'destructive' &&
                    styles.destructiveButton,
                ]}
                labelStyle={styles.confirmButtonLabel}
              >
                {confirmState.options?.confirmText || 'Confirm'}
              </Button>
            </View>
          </View>
        </View>
      </Modal>
    </FeedbackContext.Provider>
  );
}

// =============================================================================
// Standalone Components (for use outside Provider)
// =============================================================================

interface LoadingOverlayProps {
  visible: boolean;
  message?: string;
}

export function LoadingOverlay({
  visible,
  message,
}: LoadingOverlayProps): React.JSX.Element | null {
  if (!visible) return null;

  return (
    <View style={styles.loadingOverlay}>
      <View style={styles.loadingContent}>
        <ActivityIndicator size="large" color={BRAND_COLOR} />
        {message && <Text style={styles.loadingText}>{message}</Text>}
      </View>
    </View>
  );
}

interface InlineLoadingProps {
  message?: string;
  size?: 'small' | 'large';
}

export function InlineLoading({
  message,
  size = 'small',
}: InlineLoadingProps): React.JSX.Element {
  return (
    <View style={styles.inlineLoading}>
      <ActivityIndicator size={size} color={BRAND_COLOR} />
      {message && <Text style={styles.inlineLoadingText}>{message}</Text>}
    </View>
  );
}

// =============================================================================
// Styles
// =============================================================================

const styles = StyleSheet.create({
  loadingOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingContent: {
    backgroundColor: '#1a1a2e',
    padding: 32,
    borderRadius: 16,
    alignItems: 'center',
    minWidth: 140,
  },
  loadingText: {
    color: '#FFFFFF',
    fontSize: 14,
    marginTop: 16,
    textAlign: 'center',
  },
  confirmOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  confirmContent: {
    backgroundColor: '#1a1a2e',
    borderRadius: 20,
    padding: 24,
    width: '100%',
    maxWidth: 340,
    alignItems: 'center',
  },
  confirmIcon: {
    fontSize: 48,
    marginBottom: 16,
  },
  confirmTitle: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 12,
    textAlign: 'center',
  },
  confirmMessage: {
    color: 'rgba(255, 255, 255, 0.7)',
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 24,
    lineHeight: 20,
  },
  confirmButtons: {
    flexDirection: 'row',
    gap: 12,
  },
  cancelButton: {
    flex: 1,
    borderColor: 'rgba(255, 255, 255, 0.3)',
    borderRadius: 12,
  },
  cancelButtonLabel: {
    color: 'rgba(255, 255, 255, 0.7)',
  },
  confirmButton: {
    flex: 1,
    backgroundColor: BRAND_COLOR,
    borderRadius: 12,
  },
  destructiveButton: {
    backgroundColor: '#F44336',
  },
  confirmButtonLabel: {
    color: '#1a1a2e',
    fontWeight: '600',
  },
  inlineLoading: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
  },
  inlineLoadingText: {
    color: 'rgba(255, 255, 255, 0.6)',
    fontSize: 14,
    marginLeft: 12,
  },
});
