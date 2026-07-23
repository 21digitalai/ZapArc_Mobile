import fs from 'node:fs';
import path from 'node:path';

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
    const plugin = fs.readFileSync(
      path.join(appRoot, 'plugins/withLegacyAndroidBackHandler.js'),
      'utf8',
    );

    expect(appConfig.expo?.android?.predictiveBackGestureEnabled).toBe(false);
    expect(appConfig.expo?.plugins).toContain(
      './plugins/withLegacyAndroidBackHandler',
    );
    expect(plugin).toContain(
      "application.$['android:enableOnBackInvokedCallback'] = 'false'",
    );
  });
});
