import { defineConfig } from '@neon/config/v1';

// Secrets come from the env file passed to `neon deploy --env <file>`; a missing value stops the deploy
const required = (name: string) => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set in the env file`);
  return value;
};

export default defineConfig({
  functions: {
    api: {
      name: 'hostel cleaning api',
      source: '../server/src/function.ts',
      env: {
        JWT_SECRET: required('JWT_SECRET'),
        CLIENT_URL: required('CLIENT_URL'),
        ADMIN_EMAIL: required('ADMIN_EMAIL'),
        ADMIN_PASSWORD: required('ADMIN_PASSWORD'),
        LOGIN_RATE_LIMIT: process.env.LOGIN_RATE_LIMIT ?? '10',
        GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID ?? '',
      },
    },
  },
});
