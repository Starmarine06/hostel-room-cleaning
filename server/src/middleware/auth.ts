import type { Request, Response, NextFunction } from '../http.js';
import jwt from 'jsonwebtoken';
import { prisma } from '../db.js';

export type { AuthRequest } from '../http.js';
type AuthRequest = Request;

export const authenticate = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({ message: 'No token provided' });
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET!, { algorithms: ['HS256'] }) as {
      tv?: number;
      id: string;
      email: string;
      name: string;
      role: string;
      roomId: string | null;
    };

    // Verify user still exists
    const user = await prisma.user.findUnique({
      where: { id: decoded.id },
      select: { id: true, email: true, name: true, role: true, roomId: true, mustChangePassword: true, tokenVersion: true },
    });

    if (!user) {
      return res.status(401).json({ message: 'User not found' });
    }

    // A password change or reset ends every session that was opened before it
    if ((decoded.tv ?? 0) !== user.tokenVersion) {
      return res.status(401).json({ message: 'Your password was changed. Please sign in again.' });
    }

    // An issued password is only good for choosing a new one
    if (user.mustChangePassword && !req.allowPending) {
      return res.status(403).json({ code: 'PASSWORD_CHANGE_REQUIRED', message: 'Please choose your own password to continue' });
    }

    const { mustChangePassword: _must, tokenVersion: _version, ...current } = user;
    req.user = current;
    next();
  } catch (error) {
    return res.status(401).json({ message: 'Invalid token' });
  }
};

// For the few routes a person with an issued password may use: see who they are, and change the password
export const authenticateAllowPending = (req: AuthRequest, res: Response, next: NextFunction) => {
  req.allowPending = true;
  return authenticate(req, res, next);
};

export const authorize = (...roles: string[]) => {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ message: 'Not authenticated' });
    }

    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ message: 'Insufficient permissions' });
    }

    next();
  };
};

export const optionalAuth = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return next();
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET!, { algorithms: ['HS256'] }) as {
      id: string;
      email: string;
      name: string;
      role: string;
      roomId: string | null;
    };

    const user = await prisma.user.findUnique({
      where: { id: decoded.id },
      select: { id: true, email: true, name: true, role: true, roomId: true },
    });

    if (user) {
      req.user = user;
    }
    next();
  } catch {
    next();
  }
};