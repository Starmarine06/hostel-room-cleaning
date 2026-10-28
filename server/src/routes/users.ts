import { Router, Response } from '../http.js';
import bcrypt from 'bcryptjs';
import { randomInt } from 'node:crypto';
import type { Role } from '../generated/client.js';
import { prisma } from '../db.js';
import { authenticate, AuthRequest, authorize } from '../middleware/auth.js';
import { validate } from '../middleware/validation.js';
import { createUserSchema, importUsersSchema, updateUserSchema } from '../utils/schemas.js';
import { parseCsv } from '../utils/csv.js';
import { parseRoomNumber } from '../utils/rooms.js';
import { mailEnabled, sendLogins, type Login } from '../mail.js';

const router = new Router();
router.use(authenticate, authorize('ADMIN'));

const MAX_IMPORT_ROWS = 5000;
const MAX_ROOM_SIZE = 10;

// No 0/O/1/l/I so a password read off a printout or mail is not misread
const PASSWORD_CHARS = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const tempPassword = () => Array.from({ length: 10 }, () => PASSWORD_CHARS[randomInt(PASSWORD_CHARS.length)]).join('');
const newCredentials = async () => {
  const plain = tempPassword();
  return { plain, hash: await bcrypt.hash(plain, 10) };
};
const withoutPassword = <T extends { password?: string | null }>(u: T) => {
  const { password: _password, ...rest } = u;
  return rest;
};
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ROOM_HINT = 'use the format T-230 (block, dash, room number)';

router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const { page = 1, limit = 20, role } = req.query;
    const skip = (Number(page) - 1) * Number(limit);
    const take = Number(limit);
    const where = role ? { role: role as Role } : {};

    const [users, total] = await Promise.all([
      prisma.user.findMany({ where, skip, take, orderBy: { createdAt: 'desc' }, include: { room: true } }),
      prisma.user.count({ where }),
    ]);

    res.json({ data: users.map(withoutPassword), total, page: Number(page), limit: Number(limit), totalPages: Math.ceil(total / take) });
  } catch (error) {
    console.error('Get users error:', error);
    res.status(500).json({ message: 'Failed to get users' });
  }
});

// Add one person (resident or cleaner) who may then sign in with their Google account
router.post('/', validate(createUserSchema), async (req: AuthRequest, res: Response) => {
  try {
    const { email, name, role, room, regNo } = req.body as { email: string; name?: string; role: Role; room?: string; regNo?: string };

    if (await prisma.user.findUnique({ where: { email } })) {
      return res.status(400).json({ message: 'This email is already added' });
    }
    if (regNo && (await prisma.user.findUnique({ where: { regNo } }))) {
      return res.status(400).json({ message: 'This registration number is already used' });
    }

    let roomId: string | null = null;
    if (room && role === 'RESIDENT') {
      const parsed = parseRoomNumber(room);
      if (!parsed) return res.status(400).json({ message: `Room number: ${ROOM_HINT}` });
      const found = await prisma.room.findUnique({ where: { number: parsed.number }, include: { residents: true } });
      if (!found) return res.status(400).json({ message: `Room ${parsed.number} does not exist` });
      if (found.residents.length >= found.capacity) {
        return res.status(400).json({ message: `Room ${parsed.number} is full` });
      }
      roomId = found.id;
    }

    const creds = await newCredentials();
    const user = await prisma.user.create({
      data: { email, name: name || email.split('@')[0], role, roomId, regNo: regNo || null, password: creds.hash, mustChangePassword: true },
      include: { room: true },
    });
    // When the password was mailed, the admin does not need to see it
    const emailed = (await sendLogins([{ email, name: user.name, password: creds.plain }])).has(email);
    res.status(201).json({ user: withoutPassword(user), tempPassword: emailed ? null : creds.plain, emailed });
  } catch (error) {
    console.error('Add user error:', error);
    res.status(500).json({ message: 'Failed to add person' });
  }
});

interface RowResult {
  row: number;
  email: string;
  status: 'created' | 'assigned' | 'moved' | 'unchanged' | 'failed';
  message?: string;
}

const SIZE_HEADER = /size|capacity|bed|max/;

// Bulk add residents from a sheet: reg.no, name, room, room size, email (and an optional role).
// New people get an account and a mailed password. People who already exist only change room: no new
// password, no mail, nothing else is touched, so the yearly block change leaves their logins alone.
router.post('/import', validate(importUsersSchema), async (req: AuthRequest, res: Response) => {
  try {
    const { csv, removeMissing } = req.body as { csv: string; removeMissing: boolean };
    let rows = parseCsv(csv);

    // Optional header row
    let emailCol = 0;
    let roomCol = 1;
    let sizeCol = -1;
    let roleCol = -1;
    let regCol = -1;
    let nameCol = -1;
    const hasHeader = rows.length > 0 && !EMAIL.test(rows[0][0] || '');
    if (hasHeader) {
      const header = rows[0].map((c) => c.toLowerCase());
      emailCol = header.findIndex((c) => c.includes('mail'));
      roomCol = header.findIndex((c) => c.includes('room') && !SIZE_HEADER.test(c));
      sizeCol = header.findIndex((c) => SIZE_HEADER.test(c));
      roleCol = header.findIndex((c) => c.includes('role'));
      regCol = header.findIndex((c) => c.startsWith('reg'));
      nameCol = header.findIndex((c) => c.includes('name'));
      if (emailCol < 0 || roomCol < 0) {
        return res.status(400).json({ message: 'The first row must name an "email" column and a "room" column' });
      }
      rows = rows.slice(1);
    }
    if (rows.length === 0) return res.status(400).json({ message: 'The file has no rows' });
    if (rows.length > MAX_IMPORT_ROWS) {
      return res.status(400).json({ message: `Too many rows (max ${MAX_IMPORT_ROWS} at a time)` });
    }

    const cell = (cells: string[], col: number) => (col >= 0 ? (cells[col] || '').trim() : '');
    const firstRowNumber = hasHeader ? 2 : 1;

    // Students already living somewhere else who this file moves out. Their old bed counts as free, so
    // a room can be refilled in one go when its whole block changes.
    const targets = new Map<string, string>();
    for (const cells of rows) {
      const email = cell(cells, emailCol).toLowerCase();
      const parsed = parseRoomNumber(cell(cells, roomCol));
      if (EMAIL.test(email) && parsed) targets.set(email, parsed.number);
    }
    const current = await prisma.user.findMany({
      where: { email: { in: [...targets.keys()] }, role: 'RESIDENT', roomId: { not: null } },
      include: { room: true },
    });
    const leaving = new Set(current.filter((u) => u.room!.number !== targets.get(u.email)).map((u) => u.email));
    const staying = (room: { residents: { email: string }[] }) => room.residents.filter((r) => !leaving.has(r.email)).length;

    const results: RowResult[] = [];
    const created: Login[] = [];
    const seen = new Set<string>();

    for (let i = 0; i < rows.length; i++) {
      const cells = rows[i];
      const rowNo = firstRowNumber + i;
      const email = cell(cells, emailCol).toLowerCase();
      const roomText = cell(cells, roomCol);
      const sizeText = cell(cells, sizeCol);
      const regNo = cell(cells, regCol);
      const nameText = cell(cells, nameCol);
      const roleText = cell(cells, roleCol).toUpperCase();
      const fail = (message: string) => results.push({ row: rowNo, email, status: 'failed', message });

      if (!EMAIL.test(email)) { fail('Not a valid email address'); continue; }
      if (seen.has(email)) { fail('This email appears more than once in the file'); continue; }
      seen.add(email);

      if (roleText && roleText !== 'CLEANER' && roleText !== 'RESIDENT') {
        fail('Role must be RESIDENT or CLEANER (or left blank)'); continue;
      }
      const role: Role = roleText === 'CLEANER' ? 'CLEANER' : 'RESIDENT';

      const existing = await prisma.user.findUnique({ where: { email } });
      if (existing && existing.role === 'ADMIN') { fail('This person is an admin and cannot be changed here'); continue; }

      // Cleaners do not live in a room
      if (role === 'CLEANER') {
        if (existing && existing.role === 'CLEANER') { results.push({ row: rowNo, email, status: 'unchanged' }); continue; }
        if (existing) { fail('Already added as a resident; change their role from the Users tab'); continue; }
        const creds = await newCredentials();
        const name = nameText || email.split('@')[0];
        await prisma.user.create({ data: { email, name, role: 'CLEANER', password: creds.hash, mustChangePassword: true } });
        created.push({ email, name, password: creds.plain });
        results.push({ row: rowNo, email, status: 'created' });
        continue;
      }

      if (existing && existing.role !== 'RESIDENT') { fail('Already added as a cleaner'); continue; }
      if (!roomText) { fail('Room is missing'); continue; }
      const parsed = parseRoomNumber(roomText);
      if (!parsed) { fail(`"${roomText}" is not a valid room: ${ROOM_HINT}`); continue; }

      // Room size is the most people the room holds; blank keeps the current size (4 for a new room)
      let size: number | undefined;
      if (sizeText) {
        size = Number(sizeText);
        if (!Number.isInteger(size) || size < 1 || size > MAX_ROOM_SIZE) {
          fail(`Room size must be a whole number from 1 to ${MAX_ROOM_SIZE}`); continue;
        }
      }

      // A new person's registration number must not belong to someone else
      if (!existing && regNo && (await prisma.user.findUnique({ where: { regNo } }))) {
        fail(`Registration number ${regNo} belongs to another student`); continue;
      }

      let room = await prisma.room.findUnique({ where: { number: parsed.number }, include: { residents: true } });
      if (!room) {
        room = await prisma.room.create({
          data: { number: parsed.number, building: parsed.building, floor: parsed.floor, capacity: size ?? 4 },
          include: { residents: true },
        });
      } else if (size && size !== room.capacity) {
        if (size < staying(room)) { fail(`Room ${parsed.number} already has ${staying(room)} people, so its size cannot be ${size}`); continue; }
        room = await prisma.room.update({ where: { id: room.id }, data: { capacity: size }, include: { residents: true } });
      }

      if (existing?.roomId === room.id) { results.push({ row: rowNo, email, status: 'unchanged' }); continue; }
      if (staying(room) >= room.capacity) { fail(`Room ${parsed.number} is full`); continue; }

      if (existing) {
        await prisma.user.update({ where: { id: existing.id }, data: { roomId: room.id } });
        results.push({ row: rowNo, email, status: existing.roomId ? 'moved' : 'assigned' });
      } else {
        const creds = await newCredentials();
        const name = nameText || email.split('@')[0];
        await prisma.user.create({
          data: { email, name, role: 'RESIDENT', roomId: room.id, regNo: regNo || null, password: creds.hash, mustChangePassword: true },
        });
        created.push({ email, name, password: creds.plain });
        results.push({ row: rowNo, email, status: 'created' });
      }
    }

    // Optionally delete the students this file leaves out (they have left the hostel). Only students are
    // touched, and nothing is deleted while any row still needs fixing, so a typo cannot remove anyone.
    let removed = 0;
    let removalSkipped: string | undefined;
    if (removeMissing) {
      const failed = results.filter((r) => r.status === 'failed').length;
      if (failed > 0) {
        removalSkipped = `Nobody was removed because ${failed} row(s) need fixing first. Fix them and upload again.`;
      } else {
        removed = (await prisma.user.deleteMany({ where: { role: 'RESIDENT', email: { notIn: [...seen] } } })).count;
      }
    }

    // Mail each new person their password; only the ones it could not reach are shown to the admin
    const emailed = await sendLogins(created);
    const newAccounts = created.filter((c) => !emailed.has(c.email)).map(({ email, password }) => ({ email, password }));

    results.sort((a, b) => a.row - b.row);
    const count = (s: RowResult['status']) => results.filter((r) => r.status === s).length;
    res.json({
      summary: {
        total: results.length,
        created: count('created'),
        assigned: count('assigned'),
        moved: count('moved'),
        unchanged: count('unchanged'),
        failed: count('failed'),
      },
      failures: results.filter((r) => r.status === 'failed'),
      emailed: emailed.size,
      mailEnabled: mailEnabled(),
      removed,
      removalSkipped,
      newAccounts,
    });
  } catch (error) {
    console.error('Import users error:', error);
    res.status(500).json({ message: 'Import failed' });
  }
});

router.patch('/:id', validate(updateUserSchema), async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { name, email, role, roomId } = req.body;

    if (roomId) {
      const room = await prisma.room.findUnique({ where: { id: roomId }, include: { residents: true } });
      if (!room) return res.status(400).json({ message: 'Room not found' });
      if (!room.residents.some((r) => r.id === id) && room.residents.length >= room.capacity) {
        return res.status(400).json({ message: 'Room is at full capacity' });
      }
    }

    const user = await prisma.user.update({
      where: { id },
      data: { name, email, role, roomId },
      include: { room: true },
    });
    res.json(withoutPassword(user));
  } catch (error) {
    console.error('Update user error:', error);
    res.status(500).json({ message: 'Failed to update user' });
  }
});

// Forgotten password: issue a fresh temporary one
router.post('/:id/reset-password', async (req: AuthRequest, res: Response) => {
  try {
    const creds = await newCredentials();
    const user = await prisma.user.update({ where: { id: req.params.id }, data: { password: creds.hash, mustChangePassword: true, tokenVersion: { increment: 1 } } });
    const emailed = (await sendLogins([{ email: user.email, name: user.name, password: creds.plain }])).has(user.email);
    res.json({ email: user.email, tempPassword: emailed ? null : creds.plain, emailed });
  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).json({ message: 'Failed to reset password' });
  }
});

router.delete('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    if (id === req.user!.id) {
      return res.status(400).json({ message: 'Cannot delete your own account' });
    }
    await prisma.user.delete({ where: { id } });
    res.json({ message: 'User deleted successfully' });
  } catch (error) {
    console.error('Delete user error:', error);
    res.status(500).json({ message: 'Failed to delete user' });
  }
});

export default router;
