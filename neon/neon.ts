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
        SMTP_HOST: process.env.SMTP_HOST ?? '',
        SMTP_PORT: process.env.SMTP_PORT ?? '587',
        SMTP_USER: process.env.SMTP_USER ?? '',
        SMTP_PASS: process.env.SMTP_PASS ?? '',
        MAIL_FROM: process.env.MAIL_FROM ?? '',
        APP_URL: process.env.APP_URL ?? '',
        CRON_SECRET: process.env.CRON_SECRET ?? '',
        GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID ?? '',
      },
    },
  },
});
