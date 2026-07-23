import fs from 'node:fs';
import path from 'node:path';

jest.mock('@expo/config-plugins', () => ({
  withAndroidManifest: (
    config: Record<string, unknown>,
    action: (mod: Record<string, any>) => Record<string, any>,
  ) => action({
    ...config,
    modResults: {
      manifest: {
        application: [{ $: {} }],
      },
    },
  }),
}));

describe('Android back compatibility configuration', () => {
  const appRoot = path.resolve(__dirname, '../../../../..');

  it('keeps predictive back disabled through durable Expo configuration', () => {
    const appConfig = JSON.parse(
      fs.readFileSync(path.join(appRoot, 'app.json'), 'utf8'),
    ) as {
      expo?: {
        plugins?: Array<string | unknown[]>;
        android?: {
          predictiveBackGestureEnabled?: boolean;
        };
      };
    };
    const withLegacyAndroidBackHandler = require(
      path.join(appRoot, 'plugins/withLegacyAndroidBackHandler.js'),
    );
    const pluginResult = withLegacyAndroidBackHandler({});

    expect(appConfig.expo?.android?.predictiveBackGestureEnabled).toBe(false);
    expect(appConfig.expo?.plugins).toContain(
      './plugins/withLegacyAndroidBackHandler',
    );
    expect(
      pluginResult.modResults.manifest.application[0].$[
        'android:enableOnBackInvokedCallback'
      ],
    ).toBe('false');
  });
});
