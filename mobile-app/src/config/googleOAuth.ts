// OAuth client IDs are public identifiers, not secrets. Keep the production
// IDs in source so release builds do not depend on a local, gitignored .env
// file being present.
export const PRODUCTION_GOOGLE_WEB_CLIENT_ID =
  '529067575981-idqk903fa0m3skns1fth85cpoui8cn5k.apps.googleusercontent.com';
export const PRODUCTION_GOOGLE_IOS_CLIENT_ID =
  '529067575981-ojr9h0tco2ucbcn7hg81ra6leqfpn7ea.apps.googleusercontent.com';

export const GOOGLE_WEB_CLIENT_ID = PRODUCTION_GOOGLE_WEB_CLIENT_ID;
export const GOOGLE_IOS_CLIENT_ID = PRODUCTION_GOOGLE_IOS_CLIENT_ID;
