const { withAndroidManifest } = require('@expo/config-plugins');

/**
 * React Native 0.79 still delivers Android system Back through the legacy
 * BackHandler path. Apps targeting API 36 must temporarily opt out of Android
 * 16 predictive back so those callbacks continue to reach JavaScript.
 */
module.exports = function withLegacyAndroidBackHandler(config) {
  return withAndroidManifest(config, (mod) => {
    const application = mod.modResults.manifest.application?.[0];

    if (!application?.$) {
      throw new Error('Unable to configure Android back handling: application missing');
    }

    application.$['android:enableOnBackInvokedCallback'] = 'false';
    return mod;
  });
};
