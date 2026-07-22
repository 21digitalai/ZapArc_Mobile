const { withAndroidManifest } = require('@expo/config-plugins');

/**
 * Expo Camera adds CAMERA permission but does not declare that a camera is
 * optional. Keeping it optional preserves ChromeOS/large-screen install
 * compatibility and satisfies Android lint for release builds.
 */
module.exports = function withOptionalCameraFeature(config) {
  return withAndroidManifest(config, (mod) => {
    const manifest = mod.modResults.manifest;
    const features = manifest['uses-feature'] || [];
    const cameraFeature = features.find(
      (feature) => feature.$ && feature.$['android:name'] === 'android.hardware.camera',
    );

    if (cameraFeature) {
      cameraFeature.$['android:required'] = 'false';
    } else {
      features.push({
        $: {
          'android:name': 'android.hardware.camera',
          'android:required': 'false',
        },
      });
    }

    manifest['uses-feature'] = features;
    return mod;
  });
};
