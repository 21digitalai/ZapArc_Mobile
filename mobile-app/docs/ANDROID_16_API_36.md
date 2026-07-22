# Android 16 / API 36 compatibility

ZapArc targets and compiles against Android API 36. The committed Android sources
are `app.json` (Expo prebuild input) and `android/gradle.properties` (native
build input); both must remain on the same SDK level.

## Decisions

- Edge-to-edge stays enabled through Expo's `edgeToEdgeEnabled` setting. Screen
  content must continue to use the existing safe-area/inset-aware layout rather
  than relying on opaque system bars.
- `MainActivity` remains `singleTask` for QR and `mobile-app://` deep-link
  delivery. Its existing resize-related `configChanges` remain intact.
- Camera scanning is declared as an optional hardware feature. This keeps the
  app installable on ChromeOS and large-screen devices that do not expose a
  camera, while the QR scanner can still request camera access where present.
- Android 16 may ignore app orientation/resizability restrictions on large
  screens. Wallet screens must remain usable in the resulting resized layout;
  device verification is required before release.
- Notifications remain permission-gated in `breezSparkService`. FCM/Breez
  webhook registration is skipped when notification permission or an FCM token
  is unavailable, so a permission denial cannot block wallet initialization.
- Secure-store backup exclusion continues to come from the manifest's
  `secure_store_backup_rules` and `secure_store_data_extraction_rules`.

## Release QA on an API 36 device

- Confirm launch and Breez Spark initialization with the released 0.19.0 SDK.
- Exercise BTC send, receive, payment-state banners, transaction history, QR
  scanning, and `mobile-app://` deep links.
- Check notification permission, FCM/Breez webhook behavior, background/resume,
  and no fatal, UniFFI, foreground-service, notification, or security errors in
  logcat.
- Inspect the merged release manifest: package must be `com.zaparc.app` and the
  resolved target SDK must be 36.

No stablecoin, cross-chain, or swap UI is enabled by this Android-target change.
