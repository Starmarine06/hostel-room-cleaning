// Sends each new person their sign-in details. Any SMTP account works (a Gmail address with an app
// password is free); without SMTP_HOST nothing is sent and the admin hands the passwords out instead.
import nodemailer, { type Transporter } from 'nodemailer';

export const mailEnabled = () => Boolean(process.env.SMTP_HOST);

let transport: Transporter | undefined;
function getTransport() {
  transport ??= nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT) || 587,
    secure: process.env.SMTP_SECURE === 'true',
    ...(process.env.SMTP_USER && { auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } }),
    connectionTimeout: 10_000,
    socketTimeout: 20_000,
  });
  return transport;
}

const siteUrl = () => process.env.APP_URL || (process.env.CLIENT_URL || '').split(',')[0].trim();

export interface Login {
  email: string;
  name: string;
  password: string;
}

// Returns false instead of throwing, so a mail problem never fails the import itself
export async function sendLogin({ email, name, password }: Login): Promise<boolean> {
  try {
    const url = siteUrl();
    await getTransport().sendMail({
      from: process.env.MAIL_FROM || process.env.SMTP_USER,
      to: email,
      subject: 'Your hostel room cleaning login',
      text: [
        `Hello ${name},`,
        '',
        'An account has been made for you on the hostel room cleaning site.',
        url ? `Website: ${url}` : '',
        `Email: ${email}`,
        `Temporary password: ${password}`,
        '',
        'Please change your password from the Profile page after you sign in.',
      ]
        .filter((line, i, all) => line !== '' || all[i - 1] !== '')
        .join('\n'),
    });
    return true;
  } catch (error) {
    console.error(`Could not email ${email}:`, error instanceof Error ? error.message : error);
    return false;
  }
}

// A few at a time: quick enough for a whole hostel, gentle enough for a free mail account
export async function sendLogins(logins: Login[]): Promise<Set<string>> {
  const sent = new Set<string>();
  if (!mailEnabled()) return sent;
  let next = 0;
  const worker = async () => {
    while (next < logins.length) {
      const login = logins[next++];
      if (await sendLogin(login)) sent.add(login.email);
    }
  };
  await Promise.all(Array.from({ length: Math.min(5, logins.length) }, worker));
  return sent;
}
