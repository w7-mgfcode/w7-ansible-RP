import { Router, Response } from 'express';
import { AppDataSource } from '../../database/connection.js';
import { Job, JobStatus } from '../../database/models/Job.js';
import { authMiddleware, optionalAuth, AuthenticatedRequest, userOrAdmin } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';

const router = Router();
const jobRepository = () => AppDataSource.getRepository(Job);

// GET /api/jobs - List jobs
router.get('/', optionalAuth, async (req: AuthenticatedRequest, res: Response, next) => {
  try {
    const { status, type } = req.query;

    // Sanitize and clamp pagination parameters
    const parsedPage = parseInt(req.query.page as string, 10) || 1;
    const parsedLimit = parseInt(req.query.limit as string, 10) || 20;
    const clampedPage = Math.max(1, parsedPage);
    const clampedLimit = Math.min(100, Math.max(1, parsedLimit));

    // Whitelist allowed sort fields to prevent SQL injection
    const allowedSortFields = ['createdAt', 'status', 'type'];
    const requestedSortBy = req.query.sortBy as string;
    const normalizedSortBy = allowedSortFields.includes(requestedSortBy) ? requestedSortBy : 'createdAt';

    // Validate sort order
    const requestedSortOrder = (req.query.sortOrder as string)?.toUpperCase();
    const normalizedSortOrder: 'ASC' | 'DESC' = requestedSortOrder === 'ASC' ? 'ASC' : 'DESC';

    const queryBuilder = jobRepository().createQueryBuilder('job');

    if (status) {
      queryBuilder.andWhere('job.status = :status', { status });
    }

    if (type) {
      queryBuilder.andWhere('job.type = :type', { type });
    }

    const total = await queryBuilder.getCount();

    queryBuilder
      .orderBy(`job.${normalizedSortBy}`, normalizedSortOrder)
      .skip((clampedPage - 1) * clampedLimit)
      .take(clampedLimit);

    const jobs = await queryBuilder.getMany();

    res.json({
      jobs,
      pagination: {
        page: clampedPage,
        limit: clampedLimit,
        total,
        pages: Math.ceil(total / clampedLimit)
      }
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/jobs/stats/queue - Get queue statistics
// NOTE: This route must be defined before /:id to avoid "stats" being treated as an ID
router.get('/stats/queue', optionalAuth, async (req: AuthenticatedRequest, res: Response, next) => {
  try {
    // Use single grouped query instead of four separate queries
    const stats = await jobRepository()
      .createQueryBuilder('job')
      .select('job.status', 'status')
      .addSelect('COUNT(*)', 'count')
      .groupBy('job.status')
      .getRawMany();

    // Convert to object format with defaults for missing statuses
    const result = {
      queued: 0,
      processing: 0,
      completed: 0,
      failed: 0
    };

    for (const stat of stats) {
      const status = stat.status.toLowerCase();
      if (status in result) {
        result[status as keyof typeof result] = parseInt(stat.count, 10);
      }
    }

    res.json(result);
  } catch (error) {
    next(error);
  }
});

// GET /api/jobs/:id - Get job by ID
router.get('/:id', optionalAuth, async (req: AuthenticatedRequest, res: Response, next) => {
  try {
    const job = await jobRepository().findOne({
      where: { id: req.params.id }
    });

    if (!job) {
      throw new AppError('Job not found', 404);
    }

    // Authorization check: if user is authenticated, verify ownership or admin role
    if (req.user) {
      const isOwner = job.createdById === req.user.userId;
      const isAdmin = req.user.role === 'admin';

      if (!isOwner && !isAdmin) {
        throw new AppError('Not authorized to view this job', 403);
      }
    }

    res.json(job);
  } catch (error) {
    next(error);
  }
});

// POST /api/jobs/:id/cancel - Cancel job
router.post('/:id/cancel', authMiddleware, userOrAdmin, async (req: AuthenticatedRequest, res: Response, next) => {
  try {
    const job = await jobRepository().findOne({
      where: { id: req.params.id }
    });

    if (!job) {
      throw new AppError('Job not found', 404);
    }

    if (job.status !== JobStatus.QUEUED && job.status !== JobStatus.PROCESSING) {
      throw new AppError('Job cannot be cancelled', 400);
    }

    job.status = JobStatus.CANCELLED;
    job.completedAt = new Date();
    await jobRepository().save(job);

    res.json({
      success: true,
      message: 'Job cancelled',
      job
    });
  } catch (error) {
    next(error);
  }
});

export default router;
