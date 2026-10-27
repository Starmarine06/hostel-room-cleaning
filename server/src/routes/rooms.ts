import { Router, Response } from 'express';
import { Prisma } from '@prisma/client';
import { parseRoomNumber } from '../utils/rooms.js';
import { prisma } from '../index.js';
import { authenticate, AuthRequest, authorize } from '../middleware/auth.js';
import { validate, validateQuery } from '../middleware/validation.js';
import { createRoomSchema, updateRoomSchema, paginationSchema } from '../utils/schemas.js';

const router = Router();

// All routes require authentication
router.use(authenticate);

// Get all rooms (admin sees all, residents/cleaners see their room)
router.get('/', validateQuery(paginationSchema), async (req: AuthRequest, res: Response) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const skip = (Number(page) - 1) * Number(limit);
    const take = Number(limit);

    const where: Prisma.RoomWhereInput = {};

    // Non-admin users only see their room
    if (req.user!.role !== 'ADMIN') {
      if (req.user!.roomId) {
        where.id = req.user!.roomId;
      } else {
        where.id = 'no-room'; // Will return empty
      }
    }

    const [rooms, total] = await Promise.all([
      prisma.room.findMany({
        where,
        skip,
        take,
        orderBy: { number: 'asc' },
        include: {
          residents: {
            select: { id: true, name: true, email: true, role: true },
          },
          _count: { select: { requests: true } },
        },
      }),
      prisma.room.count({ where }),
    ]);

    res.json({
      data: rooms,
      total,
      page: Number(page),
      limit: Number(limit),
      totalPages: Math.ceil(total / take),
    });
  } catch (error) {
    console.error('Get rooms error:', error);
    res.status(500).json({ message: 'Failed to get rooms' });
  }
});

// Get room by ID
router.get('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    const room = await prisma.room.findUnique({
      where: { id },
      include: {
        residents: {
          select: { id: true, name: true, email: true, role: true },
        },
        requests: {
          orderBy: { requestedAt: 'desc' },
          take: 10,
          include: {
            requester: { select: { id: true, name: true } },
            cleaner: { select: { id: true, name: true } },
            confirmer: { select: { id: true, name: true } },
          },
        },
      },
    });

    if (!room) {
      return res.status(404).json({ message: 'Room not found' });
    }

    // Check access
    if (req.user!.role !== 'ADMIN' && req.user!.roomId !== id) {
      return res.status(403).json({ message: 'Access denied' });
    }

    res.json(room);
  } catch (error) {
    console.error('Get room error:', error);
    res.status(500).json({ message: 'Failed to get room' });
  }
});

// Create room (admin only)
router.post('/', authorize('ADMIN'), validate(createRoomSchema), async (req: AuthRequest, res: Response) => {
  try {
    const { number, capacity } = req.body;
    const { building, floor } = parseRoomNumber(number)!;

    // Check if room number already exists
    const existingRoom = await prisma.room.findUnique({ where: { number } });
    if (existingRoom) {
      return res.status(400).json({ message: 'Room number already exists' });
    }

    const room = await prisma.room.create({
      data: { number, building, floor, capacity },
      include: { residents: true },
    });

    res.status(201).json(room);
  } catch (error) {
    console.error('Create room error:', error);
    res.status(500).json({ message: 'Failed to create room' });
  }
});

// Update room (admin only)
router.patch('/:id', authorize('ADMIN'), validate(updateRoomSchema), async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { number, capacity } = req.body;
    const parsed = number ? parseRoomNumber(number) : null;

    // Check if new number conflicts
    if (number) {
      const existingRoom = await prisma.room.findFirst({
        where: { number, NOT: { id } },
      });
      if (existingRoom) {
        return res.status(400).json({ message: 'Room number already exists' });
      }
    }

    // If reducing capacity, ensure current residents don't exceed new capacity
    if (capacity) {
      const room = await prisma.room.findUnique({
        where: { id },
        include: { residents: true },
      });
      if (room && room.residents.length > capacity) {
        return res.status(400).json({ 
          message: `Cannot reduce capacity below current residents (${room.residents.length})` 
        });
      }
    }

    const room = await prisma.room.update({
      where: { id },
      data: { number, building: parsed?.building, floor: parsed?.floor, capacity },
      include: { residents: true },
    });

    res.json(room);
  } catch (error) {
    console.error('Update room error:', error);
    res.status(500).json({ message: 'Failed to update room' });
  }
});

// Delete room (admin only)
router.delete('/:id', authorize('ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    const room = await prisma.room.findUnique({
      where: { id },
      include: { residents: true },
    });

    if (!room) {
      return res.status(404).json({ message: 'Room not found' });
    }

    if (room.residents.length > 0) {
      return res.status(400).json({ message: 'Cannot delete room with residents. Remove residents first.' });
    }

    await prisma.room.delete({ where: { id } });
    res.json({ message: 'Room deleted successfully' });
  } catch (error) {
    console.error('Delete room error:', error);
    res.status(500).json({ message: 'Failed to delete room' });
  }
});

// Assign resident to room (admin only)
router.post('/:id/residents', authorize('ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { userId } = req.body;

    if (!userId) {
      return res.status(400).json({ message: 'User ID is required' });
    }

    const room = await prisma.room.findUnique({
      where: { id },
      include: { residents: true },
    });

    if (!room) {
      return res.status(404).json({ message: 'Room not found' });
    }

    if (room.residents.length >= room.capacity) {
      return res.status(400).json({ message: 'Room is at full capacity' });
    }

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    if (user.role !== 'RESIDENT') {
      return res.status(400).json({ message: 'Only residents can be assigned to rooms' });
    }

    if (user.roomId === id) {
      return res.status(400).json({ message: 'User already assigned to this room' });
    }

    // Remove from previous room if any
    if (user.roomId) {
      await prisma.user.update({
        where: { id: userId },
        data: { roomId: null },
      });
    }

    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: { roomId: id },
      include: { room: true },
    });

    const { password: _, ...userWithoutPassword } = updatedUser;
    res.json(userWithoutPassword);
  } catch (error) {
    console.error('Assign resident error:', error);
    res.status(500).json({ message: 'Failed to assign resident' });
  }
});

// Remove resident from room (admin only)
router.delete('/:id/residents/:userId', authorize('ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    const { id, userId } = req.params;

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    if (user.roomId !== id) {
      return res.status(400).json({ message: 'User not assigned to this room' });
    }

    await prisma.user.update({
      where: { id: userId },
      data: { roomId: null },
    });

    res.json({ message: 'Resident removed successfully' });
  } catch (error) {
    console.error('Remove resident error:', error);
    res.status(500).json({ message: 'Failed to remove resident' });
  }
});

export default router;