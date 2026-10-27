import { Router, Response } from '../http.js';
import { Prisma, type CleaningStatus } from '../generated/client.js';
import { prisma } from '../db.js';
import { publish } from '../realtime.js';
import { authenticate, AuthRequest, authorize } from '../middleware/auth.js';
import { validate, validateQuery } from '../middleware/validation.js';
import { createRequestSchema, paginationSchema, rejectRequestSchema } from '../utils/schemas.js';

const router = new Router();
router.use(authenticate);

// Get all requests with filters
router.get('/', validateQuery(paginationSchema), async (req: AuthRequest, res: Response) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const skip = (Number(page) - 1) * Number(limit);
    const take = Number(limit);

    const filters = req.query as {
      status?: CleaningStatus;
      roomId?: string;
      cleanerId?: string;
    };

    const where: Prisma.CleaningRequestWhereInput = {
      ...(filters.status && { status: filters.status }),
      ...(filters.roomId && { roomId: filters.roomId }),
      ...(filters.cleanerId && { cleanerId: filters.cleanerId }),
    };

    // Role scope is ANDed in last so query filters can never widen it
    if (req.user!.role === 'RESIDENT') {
      where.AND = [{ roomId: req.user!.roomId ?? '' }];
    } else if (req.user!.role === 'CLEANER') {
      // Cleaners see pending requests + their own claimed requests
      where.AND = [{ OR: [{ status: 'PENDING', cleanerId: null }, { cleanerId: req.user!.id }] }];
    }
    // Admin sees all

    const [requests, total] = await Promise.all([
      prisma.cleaningRequest.findMany({
        where,
        skip,
        take,
        orderBy: { requestedAt: 'desc' },
        include: {
          room: { select: { id: true, number: true, building: true, floor: true } },
          requester: { select: { id: true, name: true, email: true } },
          cleaner: { select: { id: true, name: true, email: true } },
          confirmer: { select: { id: true, name: true, email: true } },
        },
      }),
      prisma.cleaningRequest.count({ where }),
    ]);

    res.json({
      data: requests,
      total,
      page: Number(page),
      limit: Number(limit),
      totalPages: Math.ceil(total / take),
    });
  } catch (error) {
    console.error('Get requests error:', error);
    res.status(500).json({ message: 'Failed to get requests' });
  }
});

// Get request by ID
router.get('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    const request = await prisma.cleaningRequest.findUnique({
      where: { id },
      include: {
        room: {
          select: {
            id: true,
            number: true,
            building: true,
            floor: true,
            capacity: true,
            residents: { select: { id: true, name: true, email: true } },
          },
        },
        requester: { select: { id: true, name: true, email: true } },
        cleaner: { select: { id: true, name: true, email: true } },
        confirmer: { select: { id: true, name: true, email: true } },
      },
    });

    if (!request) {
      return res.status(404).json({ message: 'Request not found' });
    }

    // Check access
    if (req.user!.role === 'RESIDENT' && req.user!.roomId !== request.roomId) {
      return res.status(403).json({ message: 'Access denied' });
    }
    if (req.user!.role === 'CLEANER' && 
        request.status !== 'PENDING' && 
        request.cleanerId !== req.user!.id) {
      return res.status(403).json({ message: 'Access denied' });
    }

    res.json(request);
  } catch (error) {
    console.error('Get request error:', error);
    res.status(500).json({ message: 'Failed to get request' });
  }
});

// Create cleaning request (resident only)
router.post('/', authorize('RESIDENT'), validate(createRequestSchema), async (req: AuthRequest, res: Response) => {
  try {
    const { roomId } = req.body;
    const userId = req.user!.id;

    // Verify user belongs to this room
    if (req.user!.roomId !== roomId) {
      return res.status(403).json({ message: 'You can only request cleaning for your own room' });
    }

    // Check for existing active request for this room
    const existingRequest = await prisma.cleaningRequest.findFirst({
      where: {
        roomId,
        status: { in: ['PENDING', 'IN_PROGRESS', 'CLEANED'] },
      },
    });

    if (existingRequest) {
      return res.status(400).json({ 
        message: 'A cleaning request is already active for this room',
        existingRequest: {
          id: existingRequest.id,
          status: existingRequest.status,
          requestedAt: existingRequest.requestedAt,
        }
      });
    }

    const request = await prisma.cleaningRequest.create({
      data: {
        roomId,
        requestedBy: userId,
        status: 'PENDING',
      },
      include: {
        room: { select: { id: true, number: true, building: true, floor: true } },
        requester: { select: { id: true, name: true, email: true } },
      },
    });

    // Emit real-time event
    await publish([`room:${roomId}`, 'cleaners'], 'request:created', request);

    res.status(201).json(request);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return res.status(400).json({ message: 'A cleaning request is already active for this room' });
    }
    console.error('Create request error:', error);
    res.status(500).json({ message: 'Failed to create request' });
  }
});

// Claim request (cleaner only)
router.post('/:id/claim', authorize('CLEANER'), async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const userId = req.user!.id;

    const request = await prisma.cleaningRequest.findUnique({
      where: { id },
      include: {
        room: true,
        requester: true,
      },
    });

    if (!request) {
      return res.status(404).json({ message: 'Request not found' });
    }

    if (request.status !== 'PENDING') {
      return res.status(400).json({ message: 'Request is not available for claiming' });
    }

    if (request.cleanerId) {
      return res.status(400).json({ message: 'Request already claimed' });
    }

    const claimed = await prisma.cleaningRequest.updateMany({
      where: { id, status: 'PENDING', cleanerId: null },
      data: { cleanerId: userId, status: 'IN_PROGRESS', claimedAt: new Date() },
    });

    if (claimed.count === 0) {
      return res.status(400).json({ message: 'Request already claimed' });
    }

    const updatedRequest = await prisma.cleaningRequest.findUniqueOrThrow({
      where: { id },
      include: {
        room: { select: { id: true, number: true, building: true, floor: true } },
        requester: { select: { id: true, name: true, email: true } },
        cleaner: { select: { id: true, name: true, email: true } },
      },
    });

    // Emit real-time events
    await publish([`room:${request.roomId}`, 'cleaners'], 'request:updated', updatedRequest);

    res.json(updatedRequest);
  } catch (error) {
    console.error('Claim request error:', error);
    res.status(500).json({ message: 'Failed to claim request' });
  }
});

// Mark as cleaned (cleaner only - must be assigned cleaner)
router.post('/:id/cleaned', authorize('CLEANER'), async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const userId = req.user!.id;

    const request = await prisma.cleaningRequest.findUnique({
      where: { id },
      include: {
        room: true,
        requester: true,
        cleaner: true,
      },
    });

    if (!request) {
      return res.status(404).json({ message: 'Request not found' });
    }

    if (request.cleanerId !== userId) {
      return res.status(403).json({ message: 'Only the assigned cleaner can mark as cleaned' });
    }

    if (request.status !== 'IN_PROGRESS') {
      return res.status(400).json({ message: 'Request must be in progress to mark as cleaned' });
    }

    const updatedRequest = await prisma.cleaningRequest.update({
      where: { id },
      data: {
        status: 'CLEANED',
        cleanedAt: new Date(),
      },
      include: {
        room: { select: { id: true, number: true, building: true, floor: true } },
        requester: { select: { id: true, name: true, email: true } },
        cleaner: { select: { id: true, name: true, email: true } },
      },
    });

    // Emit real-time events
    await publish([`room:${request.roomId}`, 'cleaners'], 'request:updated', updatedRequest);

    res.json(updatedRequest);
  } catch (error) {
    console.error('Mark cleaned error:', error);
    res.status(500).json({ message: 'Failed to mark as cleaned' });
  }
});

// Confirm cleaning (resident/admin - NOT the cleaner)
router.post('/:id/confirm', authorize('RESIDENT', 'ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const userId = req.user!.id;

    const request = await prisma.cleaningRequest.findUnique({
      where: { id },
      include: {
        room: true,
        requester: true,
        cleaner: true,
        confirmer: true,
      },
    });

    if (!request) {
      return res.status(404).json({ message: 'Request not found' });
    }

    if (request.status !== 'CLEANED') {
      return res.status(400).json({ message: 'Request must be cleaned before confirmation' });
    }

    // Prevent cleaner from confirming their own work
    if (request.cleanerId === userId) {
      return res.status(403).json({ message: 'Cleaners cannot confirm their own work' });
    }

    // Residents can only confirm for their own room
    if (req.user!.role === 'RESIDENT' && req.user!.roomId !== request.roomId) {
      return res.status(403).json({ message: 'You can only confirm cleaning for your own room' });
    }

    const updatedRequest = await prisma.cleaningRequest.update({
      where: { id },
      data: {
        status: 'CONFIRMED',
        confirmedBy: userId,
        confirmedAt: new Date(),
      },
      include: {
        room: { select: { id: true, number: true, building: true, floor: true } },
        requester: { select: { id: true, name: true, email: true } },
        cleaner: { select: { id: true, name: true, email: true } },
        confirmer: { select: { id: true, name: true, email: true } },
      },
    });

    // Emit real-time events
    await publish([`room:${request.roomId}`, 'cleaners'], 'request:updated', updatedRequest);

    res.json(updatedRequest);
  } catch (error) {
    console.error('Confirm cleaning error:', error);
    res.status(500).json({ message: 'Failed to confirm cleaning' });
  }
});

// Reject cleaning (resident/admin - NOT the cleaner)
router.post('/:id/reject', authorize('RESIDENT', 'ADMIN'), validate(rejectRequestSchema), async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { reason } = req.body as { reason?: string };
    const userId = req.user!.id;

    const request = await prisma.cleaningRequest.findUnique({
      where: { id },
      include: {
        room: true,
        requester: true,
        cleaner: true,
      },
    });

    if (!request) {
      return res.status(404).json({ message: 'Request not found' });
    }

    if (request.status !== 'CLEANED') {
      return res.status(400).json({ message: 'Only cleaned requests can be rejected' });
    }

    // Prevent cleaner from rejecting their own work
    if (request.cleanerId === userId) {
      return res.status(403).json({ message: 'Cleaners cannot reject their own work' });
    }

    // Residents can only reject for their own room
    if (req.user!.role === 'RESIDENT' && req.user!.roomId !== request.roomId) {
      return res.status(403).json({ message: 'You can only reject cleaning for your own room' });
    }

    const updatedRequest = await prisma.cleaningRequest.update({
      where: { id },
      data: {
        status: 'REJECTED',
        confirmedBy: userId,
        confirmedAt: new Date(),
        rejectReason: reason || null,
      },
      include: {
        room: { select: { id: true, number: true, building: true, floor: true } },
        requester: { select: { id: true, name: true, email: true } },
        cleaner: { select: { id: true, name: true, email: true } },
        confirmer: { select: { id: true, name: true, email: true } },
      },
    });

    // Emit real-time events
    await publish([`room:${request.roomId}`, 'cleaners'], 'request:updated', updatedRequest);

    res.json(updatedRequest);
  } catch (error) {
    console.error('Reject cleaning error:', error);
    res.status(500).json({ message: 'Failed to reject cleaning' });
  }
});

export default router;