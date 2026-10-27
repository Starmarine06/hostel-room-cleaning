import { Router, Response } from '../http.js';
import bcrypt from 'bcryptjs';
import jwt, { SignOptions } from 'jsonwebtoken';
import { OAuth2Client } from 'google-auth-library';
import { prisma } from '../db.js';
import { authenticate, AuthRequest } from '../middleware/auth.js';
import { validate } from '../middleware/validation.js';
import { googleLoginSchema, loginSchema, changePasswordSchema, updateProfileSchema } from '../utils/schemas.js';

const router = new Router();

const googleClientId = process.env.GOOGLE_CLIENT_ID || '';
const googleClient = new OAuth2Client(googleClientId);
const adminEmails = (process.env.ADMIN_EMAILS || '')
  .split(',')
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);
const generateToken = (user: { id: string; email: string; name: string; role: string; roomId: string | null }) =>
  jwt.sign(
    { id: user.id, email: user.email, name: user.name, role: user.role, roomId: user.roomId },
    process.env.JWT_SECRET!,
    { expiresIn: (process.env.JWT_EXPIRES_IN || '7d') as SignOptions['expiresIn'] }
  );

const NOT_REGISTERED =
  "This email isn't registered for the cleaning service. Please ask the hostel office to add you.";

// Finds the person behind a verified email. Admins listed in ADMIN_EMAILS are created on first sign-in;
// everyone else must already have been added by an admin (CSV upload or the Add person form).
async function signInVerifiedEmail(email: string, googleName?: string) {
  let user = await prisma.user.findUnique({ where: { email } });

  if (!user && adminEmails.includes(email)) {
    user = await prisma.user.create({
      data: { email, name: googleName || email.split('@')[0], role: 'ADMIN', activatedAt: new Date() },
    });
  }
  if (!user) return null;

  // First sign-in: replace the placeholder name with the real Google name
  const data: { activatedAt?: Date; name?: string } = {};
  if (!user.activatedAt) {
    data.activatedAt = new Date();
    if (googleName) data.name = googleName;
  }
  if (Object.keys(data).length) user = await prisma.user.update({ where: { id: user.id }, data });

  const withRoom = await prisma.user.findUniqueOrThrow({ where: { id: user.id }, include: { room: true } });
  const { password: _password, ...safe } = withRoom;
  return { user: safe, token: generateToken(withRoom) };
}

// What the login page needs to know
router.get('/config', (_req, res: Response) => {
  res.json({ googleClientId: googleClientId || null });
});

router.post('/google', validate(googleLoginSchema), async (req: AuthRequest, res: Response) => {
  if (!googleClientId) {
    return res.status(503).json({ message: 'Google sign-in is not configured on the server' });
  }
  try {
    const ticket = await googleClient.verifyIdToken({ idToken: req.body.credential, audience: googleClientId });
    const payload = ticket.getPayload();
    if (!payload?.email || !payload.email_verified) {
      return res.status(401).json({ message: 'Your Google email is not verified' });
    }

    const result = await signInVerifiedEmail(payload.email.toLowerCase(), payload.name);
    if (!result) return res.status(403).json({ message: NOT_REGISTERED });
    res.json(result);
  } catch (error) {
    console.error('Google sign-in error:', error);
    res.status(401).json({ message: 'Google sign-in failed. Please try again.' });
  }
});

router.post('/login', validate(loginSchema), async (req: AuthRequest, res: Response) => {
  try {
    const { email, password } = req.body as { email: string; password: string };
    const user = await prisma.user.findUnique({ where: { email }, include: { room: true } });

    // Same answer for "no such email", "no password set" and "wrong password"
    const ok = !!user?.password && (await bcrypt.compare(password, user.password));
    if (!user || !ok) return res.status(401).json({ message: 'Invalid email or password' });

    if (!user.activatedAt) await prisma.user.update({ where: { id: user.id }, data: { activatedAt: new Date() } });
    const { password: _password, ...safe } = user;
    res.json({ user: safe, token: generateToken(user) });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ message: 'Login failed' });
  }
});

router.get('/me', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user!.id }, include: { room: true } });
    if (!user) return res.status(404).json({ message: 'User not found' });
    const { password: _password, ...safe } = user;
    res.json(safe);
  } catch (error) {
    console.error('Get me error:', error);
    res.status(500).json({ message: 'Failed to get user' });
  }
});

router.patch('/profile', authenticate, validate(updateProfileSchema), async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.update({
      where: { id: req.user!.id },
      data: { name: req.body.name },
      include: { room: true },
    });
    const { password: _password, ...safe } = user;
    res.json(safe);
  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({ message: 'Failed to update profile' });
  }
});

router.post('/change-password', authenticate, validate(changePasswordSchema), async (req: AuthRequest, res: Response) => {
  try {
    const { currentPassword, newPassword } = req.body as { currentPassword: string; newPassword: string };
    const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
    if (!user?.password || !(await bcrypt.compare(currentPassword, user.password))) {
      return res.status(400).json({ message: 'Current password is incorrect' });
    }
    await prisma.user.update({ where: { id: user.id }, data: { password: await bcrypt.hash(newPassword, 12) } });
    res.json({ message: 'Password changed successfully' });
  } catch (error) {
    console.error('Change password error:', error);
    res.status(500).json({ message: 'Failed to change password' });
  }
});

export default router;
