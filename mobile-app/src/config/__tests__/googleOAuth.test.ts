import {
  GOOGLE_IOS_CLIENT_ID,
  GOOGLE_WEB_CLIENT_ID,
  PRODUCTION_GOOGLE_IOS_CLIENT_ID,
  PRODUCTION_GOOGLE_WEB_CLIENT_ID,
} from '../googleOAuth';

describe('Google OAuth production configuration', () => {
  it('keeps the Android Web client ID available without build-time environment variables', () => {
    expect(GOOGLE_WEB_CLIENT_ID).toBe(PRODUCTION_GOOGLE_WEB_CLIENT_ID);
    expect(GOOGLE_WEB_CLIENT_ID).toMatch(/\.apps\.googleusercontent\.com$/);
  });

  it('keeps the iOS client ID available without build-time environment variables', () => {
    expect(GOOGLE_IOS_CLIENT_ID).toBe(PRODUCTION_GOOGLE_IOS_CLIENT_ID);
    expect(GOOGLE_IOS_CLIENT_ID).toMatch(/\.apps\.googleusercontent\.com$/);
  });
});
