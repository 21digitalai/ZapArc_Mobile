// OAuth client IDs are public identifiers, not secrets. Keep the production
// Android Web client ID in source so release builds do not depend on a local,
// gitignored .env file being present.
export const PRODUCTION_GOOGLE_WEB_CLIENT_ID =
  '529067575981-idqk903fa0m3skns1fth85cpoui8cn5k.apps.googleusercontent.com';

export const GOOGLE_WEB_CLIENT_ID = PRODUCTION_GOOGLE_WEB_CLIENT_ID;
