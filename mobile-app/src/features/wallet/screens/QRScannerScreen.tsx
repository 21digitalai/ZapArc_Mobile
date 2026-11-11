// QR Scanner Screen
// Camera-based QR scanning for Lightning invoices, LNURL, and addresses

import React, { useState, useCallback, useMemo, useRef } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Keyboard,
  BackHandler,
} from 'react-native';
import { StyledTextInput } from '../../../components';
import { useKeyboardAwareScroll } from '../../../hooks/useKeyboardAwareScroll';
import { Text, IconButton, Button, ActivityIndicator } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { CameraView, useCameraPermissions, BarcodeScanningResult } from 'expo-camera';
import { BRAND_COLOR } from '../../../utils/theme-helpers';
import { BreezSparkService, extractSdkErrorMessage, normalizeLightningInput } from '../../../services/breezSparkService';
import { recordSdkSupportLog, sanitizeSdkLogMessage } from '../../../services/paymentDiagnostics';
import { MULTI_ASSET_UI_ENABLED } from '../../../config/features';
import { createSafeBackHandler } from '../utils/safeBack';
import { pickSingleGalleryQr } from '../utils/galleryQr';
import { t } from '../../../services/i18nService';
import { getReceiveClaimFixture } from '../../../services/receiveClaimFixture';
import { useFeedback } from '../components/FeedbackComponents';


// =============================================================================
// Types
// =============================================================================

type ScanMode = 'camera' | 'manual';
type ScanSource = 'camera' | 'manual' | 'gallery';

type ScannerProcessingStage = 'parse' | 'receive-validation' | 'route';

interface ParsedQRData {
  type: 'invoice' | 'lnurl' | 'lnurlWithdraw' | 'address' | 'sparkAddress' | 'sparkInvoice' | 'bitcoinAddress' | 'unknown';
  value: string;
  tokenIdentifier?: string;
}

/**
 * Retain only diagnostic metadata for the generic scanner error. QR payloads
 * and provider URLs may be sensitive, so support logs get a sanitized message
 * and stack fingerprint instead of the original exception object.
 */
function captureScannerProcessingFailure(
  source: ScanSource,
  stage: ScannerProcessingStage,
  error: unknown,
): void {
  const message = sanitizeSdkLogMessage(extractSdkErrorMessage(error, 'scanner processing failed'));
  const stack = error instanceof Error ? sanitizeSdkLogMessage(error.stack) : { redacted: false };
  recordSdkSupportLog('warn', JSON.stringify({
    event: 'scanner_processing_failed',
    source,
    stage,
    errorName: error instanceof Error ? error.name : undefined,
    errorFingerprint: message.fingerprint,
    stackFingerprint: stack.fingerprint,
  }));
}

// =============================================================================
// Component
// =============================================================================

export function QRScannerScreen(): React.JSX.Element {
  const { showError } = useFeedback();
  const isGalleryScanningRef = useRef(false);
  const isScanProcessingRef = useRef(false);
  // A camera keeps emitting while a QR remains visible. Latch a failed value
  // until focus is deliberately re-entered or the camera sees a different QR;
  // a timer would repeatedly reset the error toast for a held failing code.
  const lastCameraFailurePayloadRef = useRef<string | null>(null);
  const safeBack = useMemo(() => createSafeBackHandler({
    canGoBack: () => router.canGoBack(),
    back: () => router.back(),
    replace: (route) => router.replace(route),
  }, '/wallet/home'), []);
  useFocusEffect(useCallback(() => {
    // Returning to this screen is an intentional retry boundary. Keep the
    // failure latch while this camera view stays focused, but let a user who
    // leaves and deliberately re-enters scan the same code again.
    lastCameraFailurePayloadRef.current = null;
    const subscription = BackHandler.addEventListener('hardwareBackPress', safeBack);
    return () => subscription.remove();
  }, [safeBack]));
  const params = useLocalSearchParams<{ asset?: string | string[]; mode?: string | string[]; fixture?: string | string[] }>();
  const receiveModeRaw = Array.isArray(params.mode) ? params.mode[0] : params.mode;
  const isReceiveMode = receiveModeRaw === 'receive';
  const fixtureRaw = Array.isArray(params.fixture) ? params.fixture[0] : params.fixture;
  const receiveQaFixture = fixtureRaw && getReceiveClaimFixture(fixtureRaw) ? fixtureRaw : null;
  // State
  const [permission, requestPermission] = useCameraPermissions();
  // Manual keyboard avoidance for the manual-entry form (the multiline code
  // field would otherwise be typed blind under the keyboard).
  const kb = useKeyboardAwareScroll();
  const [scanMode, setScanMode] = useState<ScanMode>('camera');
  const [manualInput, setManualInput] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [flashEnabled, setFlashEnabled] = useState(false);
  const [scanned, setScanned] = useState(false);

  // ========================================
  // QR Code Parsing
  // ========================================

  const parseQRData = useCallback(async (data: string): Promise<ParsedQRData> => {
    const raw = data.trim();
    const trimmed = raw.toLowerCase();

    const tokenFromText = (() => {
      const match = raw.match(/tokenIdentifier=([^&\s]+)/i);
      return match && match[1] ? decodeURIComponent(match[1]) : undefined;
    })();

    try {
      const parsed = await BreezSparkService.parsePaymentRequest(raw);
      const parsedWithToken = parsed as typeof parsed & { tokenIdentifier?: string };
      if (parsed.isValid) {
        if (parsed.type === 'sparkAddress') {
          return { type: 'sparkAddress', value: raw, tokenIdentifier: parsedWithToken.tokenIdentifier || tokenFromText };
        }
        if (parsed.type === 'bitcoinAddress') {
          return { type: 'bitcoinAddress', value: raw };
        }
        if (parsed.type === 'bolt11') {
          return { type: 'invoice', value: raw };
        }
        if (parsed.type === 'lnurl') {
          return { type: 'lnurl', value: raw };
        }
        if (parsed.type === 'lnurlWithdraw') {
          return { type: 'lnurlWithdraw', value: raw };
        }
        if (parsed.type === 'lightningAddress') {
          return { type: 'address', value: raw };
        }
      }
    } catch {
      // fallback below
    }

    // Only send a URI-wrapped value to the invoice flow after the wrapper has
    // been removed and the payload still has a BOLT11 prefix. A `lightning:`
    // prefix can also wrap an LNURL, which must never be treated as a payment.
    const lightningPayload = normalizeLightningInput(raw);
    const lightningPayloadLower = lightningPayload.toLowerCase();
    if (lightningPayloadLower.startsWith('lnbc') || lightningPayloadLower.startsWith('lntb') || lightningPayloadLower.startsWith('lnbcrt')) {
      const invoice = lightningPayload;
      return { type: 'invoice', value: invoice };
    }

    // Preserve the distinction between an unresolvable LNURL and an unrelated
    // QR payload. The native parser can fail for a valid encoded LNURL when
    // the provider is unavailable or the tag is not a withdraw request.
    if (lightningPayloadLower.startsWith('lnurl1')) {
      return { type: 'lnurl', value: lightningPayload };
    }

    if (trimmed.startsWith('sp1')) {
      return { type: 'sparkAddress', value: raw, tokenIdentifier: tokenFromText };
    }

    if (trimmed.startsWith('spark:') || trimmed.includes('tokenidentifier=')) {
      return { type: 'sparkInvoice', value: raw, tokenIdentifier: tokenFromText };
    }

    // An LNURL that the SDK could not classify is intentionally unresolved.
    // It may be pay, withdraw, auth, or unavailable; routing it to a fictional
    // generic page (or to Send) would make a security-sensitive guess.

    // Lightning Address (user@domain format)
    if (trimmed.includes('@') && trimmed.includes('.')) {
      return { type: 'address', value: raw };
    }

    // Bitcoin on-chain
    if (trimmed.startsWith('bitcoin:') || trimmed.startsWith('bc1') || trimmed.startsWith('1') || trimmed.startsWith('3')) {
      return { type: 'bitcoinAddress', value: raw };
    }

    return { type: 'unknown', value: raw };
  }, []);

  // ========================================
  // Handle Scanned Data
  // ========================================

  const handleScannedData = useCallback(
    async (data: string, source: ScanSource = 'manual') => {
      const payload = data.trim();
      const isRepeatedCameraFailure = source === 'camera'
        && lastCameraFailurePayloadRef.current === payload;
      if (scanned || isScanProcessingRef.current || isRepeatedCameraFailure) return;

      isScanProcessingRef.current = true;
      setScanned(true);
      setIsProcessing(true);
      let failed = false;
      let stage: ScannerProcessingStage = 'parse';

      try {
        const parsed = await parseQRData(data);
        stage = 'receive-validation';
        if (isReceiveMode && parsed.type !== 'lnurlWithdraw') {
          if (parsed.type === 'lnurl') {
            showError(t('receive.unresolvedLnurl'));
            failed = true;
            setScanned(false);
            setIsProcessing(false);
            return;
          }
          const isOutgoingPayment = parsed.type === 'invoice'
            || parsed.type === 'bitcoinAddress'
            || parsed.type === 'address'
            || parsed.type === 'sparkAddress'
            || parsed.type === 'sparkInvoice';
          showError(t(isOutgoingPayment ? 'receive.unsupportedReceiveQr' : 'receive.unknownQr'));
          failed = true;
          setScanned(false);
          setIsProcessing(false);
          return;
        }
        const requestedAssetRaw = Array.isArray(params.asset) ? params.asset[0] : params.asset;
        const requestedAsset = (requestedAssetRaw || '').toUpperCase() === 'USDB' ? 'USDB' : 'BTC';
        const tokenLooksUsdb = !!parsed.tokenIdentifier && parsed.tokenIdentifier.toLowerCase().includes('usdb');
        // v1: when multi-asset UI is gated off, refuse USDB-denominated QR
        // codes outright. Sending into a hidden asset path would either
        // silently fail or land the user on a hidden tab. Better to show a
        // clear "not supported in this version" message.
        if (!MULTI_ASSET_UI_ENABLED && tokenLooksUsdb) {
          showError(t('receive.usdbUnsupported'));
          failed = true;
          setScanned(false);
          setIsProcessing(false);
          return;
        }
        const sparkAsset = tokenLooksUsdb || requestedAsset === 'USDB' ? 'USDB' : 'BTC';

        stage = 'route';
        switch (parsed.type) {
          case 'lnurlWithdraw':
            router.push({ pathname: '/wallet/receive-claim', params: { lnurl: parsed.value } });
            break;
          case 'invoice':
            router.push({
              pathname: '/wallet/send',
              params: {
                asset: 'BTC',
                tab: 'lightning',
                paymentInput: parsed.value,
              },
            });
            break;

          case 'bitcoinAddress':
            router.push({
              pathname: '/wallet/send',
              params: {
                asset: 'BTC',
                tab: 'onchain',
                paymentInput: parsed.value,
              },
            });
            break;

          case 'lnurl':
            showError(t('receive.unresolvedLnurl'));
            failed = true;
            setScanned(false);
            setIsProcessing(false);
            break;

          case 'address':
          case 'sparkAddress':
          case 'sparkInvoice':
            router.push({
              pathname: '/wallet/send',
              params: {
                asset: sparkAsset,
                tab: 'lightning',
                paymentInput: parsed.value,
              },
            });
            break;

          case 'unknown':
            showError(t('receive.unknownQr'));
            failed = true;
            setScanned(false);
            setIsProcessing(false);
            break;
        }
      } catch (error) {
        captureScannerProcessingFailure(source, stage, error);
        showError(t('receive.processQrFailed'));
        failed = true;
        setScanned(false);
      } finally {
        if (failed && source === 'camera') {
          lastCameraFailurePayloadRef.current = payload;
        }
        isScanProcessingRef.current = false;
        setIsProcessing(false);
      }
    },
    [isProcessing, scanned, parseQRData, params.asset, isReceiveMode, showError]
  );

  const openReceiveQaFixture = useCallback(() => {
    if (!receiveQaFixture || !isReceiveMode) return;
    router.push({ pathname: '/wallet/receive-claim', params: { lnurl: receiveQaFixture } });
  }, [isReceiveMode, receiveQaFixture]);

  // ========================================
  // Camera Barcode Handler
  // ========================================

  const handleBarcodeScanned = useCallback(
    (result: BarcodeScanningResult) => {
      if (result.data && !scanned) {
        handleScannedData(result.data, 'camera');
      }
    },
    [handleScannedData, scanned]
  );

  // ========================================
  // Manual Input Handler
  // ========================================

  const handleManualSubmit = useCallback(() => {
    Keyboard.dismiss();
    if (manualInput.trim()) {
      handleScannedData(manualInput.trim(), 'manual');
    }
  }, [manualInput, handleScannedData]);

  const handleScanFromGallery = useCallback(async () => {
    if (isGalleryScanningRef.current || isProcessing || scanned) return;

    isGalleryScanningRef.current = true;
    setIsProcessing(true);

    try {
      const result = await pickSingleGalleryQr();
      if (result.kind === 'cancelled') return;
      if (result.kind === 'missing') {
        showError(t('receive.galleryUnreadable'));
        return;
      }

      if (result.kind === 'empty') {
        showError(t('receive.galleryEmpty'));
        return;
      }

      if (result.kind === 'multiple') {
        showError(t('receive.galleryMultiple'));
        return;
      }

      if (result.kind === 'payload') {
        await handleScannedData(result.payload, 'gallery');
      }
    } catch {
      showError(t('receive.galleryScanFailed'));
    } finally {
      isGalleryScanningRef.current = false;
      setIsProcessing(false);
    }
  }, [handleScannedData, isProcessing, scanned, showError]);

  // ========================================
  // Permission Request
  // ========================================

  if (!permission) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color={BRAND_COLOR} />
      </View>
    );
  }

  if (!permission.granted && scanMode === 'camera') {
    return (
      <SafeAreaView style={styles.permissionContainer}>
        <View style={styles.permissionContent}>
          <Text style={styles.permissionIcon}>📷</Text>
          <Text style={styles.permissionTitle}>Camera Access</Text>
          <Text style={styles.permissionText}>
            We use the camera only to scan QR codes for Lightning payments. You'll see the standard iOS permission prompt next.
          </Text>
          {/* Per App Review guideline 5.1.1(iv), the button preceding a
              system permission prompt must use neutral wording ("Continue",
              "Next") rather than "Grant Permission" / "Allow", which Apple
              interprets as the app directing the user's decision. */}
          <Button
            mode="contained"
            onPress={requestPermission}
            style={styles.permissionButton}
            labelStyle={styles.permissionButtonLabel}
          >
            Continue
          </Button>
          <Button
            mode="text"
            onPress={handleScanFromGallery}
            disabled={isProcessing}
            loading={isProcessing}
            labelStyle={styles.manualEntryLink}
          >
            Scan from gallery
          </Button>
          <Button
            mode="text"
            onPress={() => setScanMode('manual')}
            disabled={isProcessing}
            labelStyle={styles.manualEntryLink}
          >
            Enter code manually instead
          </Button>
        </View>
      </SafeAreaView>
    );
  }

  // ========================================
  // Render
  // ========================================

  return (
    <View style={styles.container}>
      {/* Header */}
      <SafeAreaView style={styles.header} edges={['top']}>
        <IconButton
          icon="close"
          iconColor="#FFFFFF"
          size={24}
          onPress={safeBack}
          style={styles.closeButton}
        />
        <Text style={styles.headerTitle}>Scan QR Code</Text>
        <View style={styles.headerSpacer} />
      </SafeAreaView>

      {/* Camera or Manual Input */}
      {scanMode === 'camera' ? (
        <View style={styles.cameraContainer}>
          <CameraView
            style={styles.camera}
            facing="back"
            barcodeScannerSettings={{
              barcodeTypes: ['qr'],
            }}
            onBarcodeScanned={scanned ? undefined : handleBarcodeScanned}
            enableTorch={flashEnabled}
          >
            {/* Scan Frame Overlay */}
            <View style={styles.overlay}>
              <View style={styles.overlayTop} />
              <View style={styles.overlayMiddle}>
                <View style={styles.overlaySide} />
                <View style={styles.scanFrame}>
                  {/* Corner decorations */}
                  <View style={[styles.corner, styles.cornerTopLeft]} />
                  <View style={[styles.corner, styles.cornerTopRight]} />
                  <View style={[styles.corner, styles.cornerBottomLeft]} />
                  <View style={[styles.corner, styles.cornerBottomRight]} />
                  {/* Crosshair for easy aiming */}
                  <View style={styles.crosshairHorizontal} />
                  <View style={styles.crosshairVertical} />
                </View>
                <View style={styles.overlaySide} />
              </View>
              <View style={styles.overlayBottom}>
                <Text style={styles.scanHint}>
                  Point your camera at a Lightning QR code
                </Text>
              </View>
            </View>

            {/* Processing Indicator */}
            {isProcessing && (
              <View style={styles.processingOverlay}>
                <ActivityIndicator size="large" color={BRAND_COLOR} />
                <Text style={styles.processingText}>Processing...</Text>
              </View>
            )}
          </CameraView>
        </View>
      ) : (
        <ScrollView
          ref={kb.scrollRef}
          style={styles.manualInputScroll}
          contentContainerStyle={[styles.manualInputContainer, kb.contentPadding]}
          keyboardShouldPersistTaps="handled"
          scrollEventThrottle={16}
          onScroll={kb.onScroll}
        >
          <Text style={styles.manualInputTitle}>Enter Payment Code</Text>
          <Text style={styles.manualInputSubtitle}>
            Paste a Lightning invoice, LNURL, or Lightning address
          </Text>

          <StyledTextInput
            style={styles.manualInput}
            value={manualInput}
            onChangeText={setManualInput}
            label="Payment Code"
            placeholder="lnbc... or LNURL... or user@domain.com"
            onFocus={kb.scrollFieldIntoView}
            multiline
            numberOfLines={4}
            autoCapitalize="none"
            autoCorrect={false}
            mode="outlined"
          />

          <Button
            mode="contained"
            onPress={handleManualSubmit}
            disabled={!manualInput.trim() || isProcessing}
            loading={isProcessing}
            style={styles.submitButton}
            labelStyle={styles.submitButtonLabel}
          >
            Continue
          </Button>
        </ScrollView>
      )}

      {/* Bottom Actions */}
      <SafeAreaView style={styles.bottomActions} edges={['bottom']}>
        {scanMode === 'camera' && (
          <View style={styles.cameraActions}>
            {receiveQaFixture && isReceiveMode && (
              <TouchableOpacity style={styles.qaFixtureButton} onPress={openReceiveQaFixture}>
                <Text style={styles.qaFixtureButtonText}>Use receive QA fixture</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={styles.actionButton}
              onPress={() => setFlashEnabled(!flashEnabled)}
              disabled={isProcessing}
            >
              <IconButton
                icon={flashEnabled ? 'flashlight' : 'flashlight-off'}
                iconColor="#FFFFFF"
                size={24}
              />
              <Text style={styles.actionButtonText}>
                {flashEnabled ? 'Flash On' : 'Flash Off'}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.actionButton}
              onPress={handleScanFromGallery}
              disabled={isProcessing}
            >
              <IconButton icon="image" iconColor="#FFFFFF" size={24} />
              <Text style={styles.actionButtonText}>Scan from Gallery</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.actionButton}
              onPress={() => setScanMode('manual')}
              disabled={isProcessing}
            >
              <IconButton icon="keyboard" iconColor="#FFFFFF" size={24} />
              <Text style={styles.actionButtonText}>Enter Manually</Text>
            </TouchableOpacity>

            {scanned && (
              <TouchableOpacity
                style={styles.rescanButton}
                onPress={() => setScanned(false)}
              >
                <Text style={styles.rescanButtonText}>Scan Again</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {scanMode === 'manual' && (
          <View style={styles.manualActions}>
            <TouchableOpacity
              style={styles.switchModeButton}
              onPress={handleScanFromGallery}
              disabled={isProcessing}
            >
              <IconButton icon="image" iconColor={BRAND_COLOR} size={20} />
              <Text style={styles.switchModeText}>Scan from Gallery</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.switchModeButton}
              onPress={() => setScanMode('camera')}
              disabled={isProcessing}
            >
              <IconButton icon="camera" iconColor={BRAND_COLOR} size={20} />
              <Text style={styles.switchModeText}>Use Camera Instead</Text>
            </TouchableOpacity>
          </View>
        )}
      </SafeAreaView>
    </View>
  );
}

// =============================================================================
// Styles
// =============================================================================

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#1a1a2e',
  },
  permissionContainer: {
    flex: 1,
    backgroundColor: '#1a1a2e',
  },
  permissionContent: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  permissionIcon: {
    fontSize: 64,
    marginBottom: 24,
  },
  permissionTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#FFFFFF',
    marginBottom: 12,
  },
  permissionText: {
    fontSize: 16,
    color: 'rgba(255, 255, 255, 0.6)',
    textAlign: 'center',
    marginBottom: 32,
    lineHeight: 24,
  },
  permissionButton: {
    backgroundColor: BRAND_COLOR,
    borderRadius: 12,
    paddingHorizontal: 32,
  },
  permissionButtonLabel: {
    color: '#1a1a2e',
    fontWeight: '600',
  },
  manualEntryLink: {
    color: 'rgba(255, 255, 255, 0.6)',
    marginTop: 16,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
    paddingVertical: 8,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
  },
  closeButton: {
    margin: 0,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  headerSpacer: {
    width: 48,
  },
  cameraContainer: {
    flex: 1,
  },
  camera: {
    flex: 1,
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
    backgroundColor: 'rgba(247, 147, 26, 0.8)',
    top: '50%',
    left: '50%',
    marginLeft: -20,
    marginTop: -1,
  },
  crosshairVertical: {
    position: 'absolute',
    width: 2,
    height: 40,
    backgroundColor: 'rgba(247, 147, 26, 0.8)',
    top: '50%',
    left: '50%',
    marginLeft: -1,
    marginTop: -20,
  },
  overlayBottom: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    alignItems: 'center',
    paddingTop: 32,
  },
  scanHint: {
    color: 'rgba(255, 255, 255, 0.8)',
    fontSize: 14,
  },
  processingOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  processingText: {
    color: '#FFFFFF',
    fontSize: 16,
    marginTop: 16,
  },
  manualInputScroll: {
    flex: 1,
    backgroundColor: '#1a1a2e',
  },
  manualInputContainer: {
    padding: 24,
    paddingTop: 100,
  },
  manualInputTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#FFFFFF',
    marginBottom: 8,
  },
  manualInputSubtitle: {
    fontSize: 14,
    color: 'rgba(255, 255, 255, 0.6)',
    marginBottom: 24,
  },
  manualInput: {
    padding: 16,
    minHeight: 120,
    textAlignVertical: 'top' as const,
    marginBottom: 24,
  },
  submitButton: {
    backgroundColor: BRAND_COLOR,
    borderRadius: 12,
  },
  submitButtonLabel: {
    color: '#1a1a2e',
    fontWeight: '600',
  },
  bottomActions: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    paddingTop: 16,
  },
  cameraActions: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 32,
    paddingBottom: 16,
  },
  actionButton: {
    alignItems: 'center',
  },
  actionButtonText: {
    color: 'rgba(255, 255, 255, 0.7)',
    fontSize: 12,
  },
  rescanButton: {
    alignItems: 'center',
    padding: 8,
  },
  rescanButtonText: {
    color: BRAND_COLOR,
    fontSize: 14,
    fontWeight: '600',
  },
  qaFixtureButton: {
    borderColor: BRAND_COLOR,
    borderRadius: 8,
    borderWidth: 1,
    marginBottom: 12,
    padding: 10,
  },
  qaFixtureButtonText: {
    color: BRAND_COLOR,
    fontWeight: '600',
    textAlign: 'center',
  },
  switchModeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
  },
  manualActions: {
    flexDirection: 'row',
    justifyContent: 'space-around',
  },
  switchModeText: {
    color: BRAND_COLOR,
    fontSize: 16,
  },
});
