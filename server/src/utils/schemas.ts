import { z } from 'zod';
import { parseRoomNumber } from './rooms.js';

const roomNumber = z
  .string()
  .refine((v) => parseRoomNumber(v) !== null, 'Room number must look like T-230 (block, dash, room number)')
  .transform((v) => parseRoomNumber(v)!.number);

export const googleLoginSchema = z.object({
  credential: z.string().min(1, 'Google credential is required'),
});

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required'),
  newPassword: z.string().min(10, 'New password must be at least 10 characters').max(100),
});

export const createRoomSchema = z.object({
  number: roomNumber,
  capacity: z.number().int().min(1).max(10).default(4),
});

export const updateRoomSchema = z.object({
  number: roomNumber.optional(),
  capacity: z.number().int().min(1).max(10).optional(),
});

export const updateProfileSchema = z.object({
  name: z.string().trim().min(2).max(100),
});

export const createUserSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  name: z.string().trim().min(2).max(100).optional(),
  role: z.enum(['RESIDENT', 'CLEANER']).default('RESIDENT'),
  room: z.string().optional(),
  regNo: z.string().trim().min(1).max(40).optional(),
});

export const importUsersSchema = z.object({
  csv: z.string().min(1, 'CSV is empty').max(1_000_000),
  removeMissing: z.boolean().default(false),
});

export const createRequestSchema = z.object({
  roomId: z.string().min(1, 'Room ID is required'),
});

export const confirmRequestSchema = z.object({
  rating: z.number().int().min(1, 'Rating is from 1 to 5').max(5, 'Rating is from 1 to 5').optional(),
  feedback: z.string().trim().max(1000).optional(),
});

export const rejectRequestSchema = z.object({
  reason: z.string().trim().max(500).optional(),
});

export const updateUserSchema = z.object({
  name: z.string().min(2).max(100).optional(),
  email: z.string().email().optional(),
  role: z.enum(['RESIDENT', 'CLEANER', 'ADMIN']).optional(),
  roomId: z.string().nullable().optional(),
});

// A date (2026-10-01) or a full timestamp; a bare end date covers that whole day
const reportDate = z.string().refine((v) => !Number.isNaN(new Date(v).getTime()), 'Not a valid date');

export const reportQuerySchema = z.object({
  from: reportDate.optional(),
  to: reportDate.optional(),
  block: z.string().trim().toUpperCase().max(4).optional(),
});

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(500).default(20),
  role: z.enum(['RESIDENT', 'CLEANER', 'ADMIN']).optional(),
  status: z.enum(['PENDING', 'IN_PROGRESS', 'CLEANED', 'CONFIRMED', 'REJECTED']).optional(),
  roomId: z.string().optional(),
  cleanerId: z.string().optional(),
});