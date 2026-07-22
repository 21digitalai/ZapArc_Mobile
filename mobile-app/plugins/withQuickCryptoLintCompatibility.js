const { withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

const lintDisable = "    disable 'UnsafeOptInUsageError'";

/**
 * react-native-quick-crypto 0.7.x uses React Native's FrameworkAPI-marked
 * CallInvoker holder. AGP 8.8 reports this third-party use as a fatal lint
 * error even though the app does not call that API directly. Keep the narrow
 * library-only suppression durable across Expo prebuilds.
 */
module.exports = function withQuickCryptoLintCompatibility(config) {
  return withDangerousMod(config, ['android', (modConfig) => {
    const buildGradle = path.join(
      modConfig.modRequest.projectRoot,
      'node_modules/react-native-quick-crypto/android/build.gradle',
    );
    const source = fs.readFileSync(buildGradle, 'utf8');

    if (!source.includes(lintDisable)) {
      const updated = source.replace(
        "    disable 'GradleCompatible'",
        "    disable 'GradleCompatible'\n" + lintDisable,
      );

      if (updated === source) {
        throw new Error('Unable to configure react-native-quick-crypto lint compatibility');
      }

      fs.writeFileSync(buildGradle, updated);
    }

    return modConfig;
  }]);
};
