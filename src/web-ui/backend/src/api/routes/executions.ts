import { Router, Response } from 'express';
import { AppDataSource } from '../../database/connection.js';
import { Execution, ExecutionStatus } from '../../database/models/Execution.js';
import { authMiddleware, optionalAuth, AuthenticatedRequest, userOrAdmin } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';

const router = Router();
const executionRepository = () => AppDataSource.getRepository(Execution);

// GET /api/executions - List executions
router.get('/', optionalAuth, async (req: AuthenticatedRequest, res: Response, next) => {
  try {
    const { status, playbookId } = req.query;

    // Sanitize and clamp pagination parameters
    const parsedPage = parseInt(req.query.page as string, 10) || 1;
    const parsedLimit = parseInt(req.query.limit as string, 10) || 20;
    const clampedPage = Math.max(1, parsedPage);
    const clampedLimit = Math.min(100, Math.max(1, parsedLimit));

    // Whitelist allowed sort fields to prevent SQL injection
    const allowedSortFields = ['startedAt', 'completedAt', 'status'];
    const requestedSortBy = req.query.sortBy as string;
    const normalizedSortBy = allowedSortFields.includes(requestedSortBy) ? requestedSortBy : 'startedAt';

    // Validate sort order
    const requestedSortOrder = (req.query.sortOrder as string)?.toUpperCase();
    const normalizedSortOrder: 'ASC' | 'DESC' = requestedSortOrder === 'ASC' ? 'ASC' : 'DESC';

    const queryBuilder = executionRepository()
      .createQueryBuilder('execution')
      .leftJoinAndSelect('execution.playbook', 'playbook')
      .leftJoinAndSelect('execution.executedBy', 'executedBy');

    if (status) {
      // Validate status against ExecutionStatus enum
      const validStatuses = Object.values(ExecutionStatus);
      if (!validStatuses.includes(status as ExecutionStatus)) {
        throw new AppError(`Invalid status filter. Must be one of: ${validStatuses.join(', ')}`, 400);
      }
      queryBuilder.andWhere('execution.status = :status', { status });
    }

    if (playbookId) {
      queryBuilder.andWhere('execution.playbookId = :playbookId', { playbookId });
    }

    const total = await queryBuilder.getCount();

    queryBuilder
      .orderBy(`execution.${normalizedSortBy}`, normalizedSortOrder)
      .skip((clampedPage - 1) * clampedLimit)
      .take(clampedLimit);

    const executions = await queryBuilder.getMany();

    res.json({
      executions,
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

// GET /api/executions/stats/summary - Get execution statistics
// NOTE: This route must be defined before /:id to avoid "stats" being treated as an ID
router.get('/stats/summary', optionalAuth, async (req: AuthenticatedRequest, res: Response, next) => {
  try {
    const total = await executionRepository().count();
    const running = await executionRepository().count({ where: { status: ExecutionStatus.RUNNING } });
    const success = await executionRepository().count({ where: { status: ExecutionStatus.SUCCESS } });
    const failed = await executionRepository().count({ where: { status: ExecutionStatus.FAILED } });

    const avgDuration = await executionRepository()
      .createQueryBuilder('execution')
      .select('AVG(execution.durationSeconds)', 'avg')
      .where('execution.durationSeconds IS NOT NULL')
      .getRawOne();

    res.json({
      total,
      running,
      success,
      failed,
      successRate: total > 0 ? parseFloat((success / total * 100).toFixed(2)) : 0,
      averageDuration: avgDuration?.avg ? parseFloat(parseFloat(avgDuration.avg).toFixed(2)) : 0
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/executions/:id - Get execution by ID
router.get('/:id', optionalAuth, async (req: AuthenticatedRequest, res: Response, next) => {
  try {
    const execution = await executionRepository().findOne({
      where: { id: req.params.id },
      relations: ['playbook', 'executedBy']
    });

    if (!execution) {
      throw new AppError('Execution not found', 404);
    }

    res.json(execution);
  } catch (error) {
    next(error);
  }
});

// GET /api/executions/:id/output - Get execution output
router.get('/:id/output', optionalAuth, async (req: AuthenticatedRequest, res: Response, next) => {
  try {
    const execution = await executionRepository().findOne({
      where: { id: req.params.id }
    });

    if (!execution) {
      throw new AppError('Execution not found', 404);
    }

    res.json({
      id: execution.id,
      status: execution.status,
      output: execution.output,
      error: execution.error,
      stats: execution.stats
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/executions/:id/logs - Get execution logs
router.get('/:id/logs', optionalAuth, async (req: AuthenticatedRequest, res: Response, next) => {
  try {
    const execution = await executionRepository().findOne({
      where: { id: req.params.id }
    });

    if (!execution) {
      throw new AppError('Execution not found', 404);
    }

    res.json({
      id: execution.id,
      output: execution.output,
      error: execution.error,
      command: execution.command
    });
  } catch (error) {
    next(error);
  }
});

// POST /api/executions/:id/stop - Stop running execution
router.post('/:id/stop', authMiddleware, userOrAdmin, async (req: AuthenticatedRequest, res: Response, next) => {
  try {
    const execution = await executionRepository().findOne({
      where: { id: req.params.id }
    });

    if (!execution) {
      throw new AppError('Execution not found', 404);
    }

    if (execution.status !== ExecutionStatus.RUNNING) {
      throw new AppError('Execution is not running', 400);
    }

    // Mark execution as cancelled in DB
    // TODO: Implement actual process cancellation via WebSocket/signal mechanism
    // Currently this only updates the database state - the actual ansible-playbook
    // process may continue running until it completes or times out.
    execution.status = ExecutionStatus.CANCELLED;
    execution.completedAt = new Date();
    execution.error = 'Execution cancelled by user';
    await executionRepository().save(execution);

    res.json({
      success: true,
      message: 'Execution stopped',
      execution
    });
  } catch (error) {
    next(error);
  }
});

export default router;
