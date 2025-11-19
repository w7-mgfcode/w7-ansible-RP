import { Router, Response } from 'express';
import * as fs from 'fs/promises';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { AppDataSource } from '../../database/connection.js';
import { Playbook, PlaybookStatus } from '../../database/models/Playbook.js';
import { Execution, ExecutionStatus } from '../../database/models/Execution.js';
import { authMiddleware, optionalAuth, AuthenticatedRequest, userOrAdmin } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';
import { getWebSocketManager } from '../../index.js';
import { getJobQueueManager } from '../../services/jobQueueManager.js';

const router = Router();
const playbookRepository = () => AppDataSource.getRepository(Playbook);
const executionRepository = () => AppDataSource.getRepository(Execution);

// AI Generator service URL
const AI_GENERATOR_URL = process.env.AI_GENERATOR_URL || 'http://ai-generator:8000';

// Working directory for playbooks
const PLAYBOOK_DIR = process.env.PLAYBOOK_DIR || '/tmp/ansible-mcp/playbooks';

// Ensure directory exists
async function ensureDir(dir: string) {
  try {
    await fs.mkdir(dir, { recursive: true });
  } catch {
    // Directory exists
  }
}

// Validate file path is within allowed directory (prevent path traversal)
function validateFilePath(filePath: string, baseDir: string): void {
  const resolvedBaseDir = path.resolve(baseDir);
  const resolvedFilePath = path.resolve(filePath);
  const relative = path.relative(resolvedBaseDir, resolvedFilePath);

  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new AppError('Invalid file path', 400);
  }
}

// GET /api/playbooks - List playbooks
router.get('/', optionalAuth, async (req: AuthenticatedRequest, res: Response, next) => {
  try {
    const { status, search } = req.query;

    // Sanitize and clamp pagination parameters
    const parsedPage = parseInt(req.query.page as string, 10) || 1;
    const parsedLimit = parseInt(req.query.limit as string, 10) || 20;
    const clampedPage = Math.max(1, parsedPage);
    const clampedLimit = Math.min(100, Math.max(1, parsedLimit));

    // Whitelist allowed sort fields to prevent SQL injection
    const allowedSortFields = ['createdAt', 'updatedAt', 'name', 'status'];
    const requestedSortBy = req.query.sortBy as string;
    const normalizedSortBy = allowedSortFields.includes(requestedSortBy) ? requestedSortBy : 'createdAt';

    // Validate sort order
    const requestedSortOrder = (req.query.sortOrder as string)?.toUpperCase();
    const normalizedSortOrder: 'ASC' | 'DESC' = requestedSortOrder === 'ASC' ? 'ASC' : 'DESC';

    const queryBuilder = playbookRepository().createQueryBuilder('playbook');

    if (status) {
      queryBuilder.andWhere('playbook.status = :status', { status });
    }

    if (search) {
      queryBuilder.andWhere(
        '(playbook.name ILIKE :search OR playbook.description ILIKE :search)',
        { search: `%${search}%` }
      );
    }

    const total = await queryBuilder.getCount();

    queryBuilder
      .orderBy(`playbook.${normalizedSortBy}`, normalizedSortOrder)
      .skip((clampedPage - 1) * clampedLimit)
      .take(clampedLimit);

    const playbooks = await queryBuilder.getMany();

    res.json({
      playbooks,
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

// GET /api/playbooks/:id - Get playbook by ID
router.get('/:id', optionalAuth, async (req: AuthenticatedRequest, res: Response, next) => {
  try {
    const playbook = await playbookRepository().findOne({
      where: { id: req.params.id },
      relations: ['createdBy']
    });

    if (!playbook) {
      throw new AppError('Playbook not found', 404);
    }

    res.json(playbook);
  } catch (error) {
    next(error);
  }
});

// POST /api/playbooks - Create playbook
router.post('/', authMiddleware, userOrAdmin, async (req: AuthenticatedRequest, res: Response, next) => {
  try {
    const { name, description, content, prompt, template, tags } = req.body;

    if (!name || !content) {
      throw new AppError('Name and content are required', 400);
    }

    await ensureDir(PLAYBOOK_DIR);

    // Generate filename
    const filename = `playbook_${Date.now()}_${uuidv4().slice(0, 8)}.yml`;
    const filePath = path.join(PLAYBOOK_DIR, filename);

    // Validate path to prevent path traversal
    validateFilePath(filePath, PLAYBOOK_DIR);

    // Write to file
    await fs.writeFile(filePath, content, 'utf-8');

    // Create database entry
    const playbook = playbookRepository().create({
      name,
      description,
      content,
      filePath,
      prompt,
      template,
      tags: tags || [],
      status: PlaybookStatus.DRAFT,
      createdById: req.user!.userId
    });

    await playbookRepository().save(playbook);

    res.status(201).json({
      success: true,
      playbook
    });
  } catch (error) {
    next(error);
  }
});

// PUT /api/playbooks/:id - Update playbook
router.put('/:id', authMiddleware, userOrAdmin, async (req: AuthenticatedRequest, res: Response, next) => {
  try {
    const playbook = await playbookRepository().findOne({
      where: { id: req.params.id }
    });

    if (!playbook) {
      throw new AppError('Playbook not found', 404);
    }

    const { name, description, content, tags } = req.body;

    // Use explicit undefined checks to allow setting fields to falsy values (empty string, empty array)
    if (name !== undefined) playbook.name = name;
    if (description !== undefined) playbook.description = description;
    if (tags !== undefined) playbook.tags = tags;

    if (content && content !== playbook.content) {
      playbook.content = content;
      playbook.version += 1;
      playbook.status = PlaybookStatus.DRAFT;

      // Update file
      if (playbook.filePath) {
        validateFilePath(playbook.filePath, PLAYBOOK_DIR);
        await fs.writeFile(playbook.filePath, content, 'utf-8');
      }
    }

    await playbookRepository().save(playbook);

    res.json({
      success: true,
      playbook
    });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/playbooks/:id - Delete playbook
router.delete('/:id', authMiddleware, userOrAdmin, async (req: AuthenticatedRequest, res: Response, next) => {
  try {
    const playbook = await playbookRepository().findOne({
      where: { id: req.params.id }
    });

    if (!playbook) {
      throw new AppError('Playbook not found', 404);
    }

    // Delete file if exists
    if (playbook.filePath) {
      validateFilePath(playbook.filePath, PLAYBOOK_DIR);
      try {
        await fs.unlink(playbook.filePath);
      } catch {
        // File may not exist
      }
    }

    await playbookRepository().remove(playbook);

    res.json({ success: true, message: 'Playbook deleted' });
  } catch (error) {
    next(error);
  }
});

// POST /api/playbooks/generate - Generate playbook from prompt using AI
router.post('/generate', authMiddleware, userOrAdmin, async (req: AuthenticatedRequest, res: Response, next) => {
  try {
    const { prompt, template, name, description } = req.body;

    if (!prompt) {
      throw new AppError('Prompt is required', 400);
    }

    // Queue the generation job
    const jobQueueManager = getJobQueueManager();
    const job = await jobQueueManager.queueGenerateJob({
      prompt,
      template,
      name,
      description,
      userId: req.user!.userId,
    });

    res.status(202).json({
      success: true,
      jobId: job.id,
      status: job.status,
      message: 'Generation job queued. Subscribe to WebSocket channel job:' + job.id + ' for updates.'
    });
  } catch (error) {
    next(error);
  }
});

// POST /api/playbooks/:id/validate - Validate playbook
router.post('/:id/validate', authMiddleware, async (req: AuthenticatedRequest, res: Response, next) => {
  try {
    const playbook = await playbookRepository().findOne({
      where: { id: req.params.id }
    });

    if (!playbook) {
      throw new AppError('Playbook not found', 404);
    }

    // Queue the validation job
    const jobQueueManager = getJobQueueManager();
    const job = await jobQueueManager.queueValidateJob({
      playbookId: playbook.id,
      userId: req.user!.userId,
    });

    res.status(202).json({
      success: true,
      jobId: job.id,
      playbookId: playbook.id,
      status: job.status,
      message: 'Validation job queued. Subscribe to WebSocket channel job:' + job.id + ' for updates.'
    });
  } catch (error) {
    next(error);
  }
});

// POST /api/playbooks/:id/execute - Execute playbook
router.post('/:id/execute', authMiddleware, userOrAdmin, async (req: AuthenticatedRequest, res: Response, next) => {
  try {
    const playbook = await playbookRepository().findOne({
      where: { id: req.params.id }
    });

    if (!playbook) {
      throw new AppError('Playbook not found', 404);
    }

    const { inventory, extraVars, checkMode, tags, skipTags, limit, diffMode, verbosity } = req.body;

    // Queue the execution job
    const jobQueueManager = getJobQueueManager();
    const { job, execution } = await jobQueueManager.queueExecuteJob({
      playbookId: playbook.id,
      inventory: inventory || 'localhost,',
      extraVars,
      checkMode,
      tags,
      skipTags,
      limit,
      diffMode,
      verbosity,
      userId: req.user!.userId,
    });

    res.status(202).json({
      success: true,
      jobId: job.id,
      executionId: execution.id,
      playbookId: playbook.id,
      status: job.status,
      message: 'Execution job queued. Subscribe to WebSocket channels job:' + job.id + ' or execution:' + execution.id + ' for updates.'
    });
  } catch (error) {
    next(error);
  }
});

// POST /api/playbooks/:id/lint - Lint playbook
router.post('/:id/lint', authMiddleware, async (req: AuthenticatedRequest, res: Response, next) => {
  try {
    const playbook = await playbookRepository().findOne({
      where: { id: req.params.id }
    });

    if (!playbook) {
      throw new AppError('Playbook not found', 404);
    }

    // Queue the lint job
    const jobQueueManager = getJobQueueManager();
    const job = await jobQueueManager.queueLintJob({
      playbookId: playbook.id,
      userId: req.user!.userId,
    });

    res.status(202).json({
      success: true,
      jobId: job.id,
      playbookId: playbook.id,
      status: job.status,
      message: 'Lint job queued. Subscribe to WebSocket channel job:' + job.id + ' for updates.'
    });
  } catch (error) {
    next(error);
  }
});

// POST /api/playbooks/:id/refine - Refine playbook
router.post('/:id/refine', authMiddleware, userOrAdmin, async (req: AuthenticatedRequest, res: Response, next) => {
  try {
    const playbook = await playbookRepository().findOne({
      where: { id: req.params.id }
    });

    if (!playbook) {
      throw new AppError('Playbook not found', 404);
    }

    const { feedback } = req.body;

    if (!feedback) {
      throw new AppError('Feedback is required', 400);
    }

    // Queue the refine job
    const jobQueueManager = getJobQueueManager();
    const job = await jobQueueManager.queueRefineJob({
      playbookId: playbook.id,
      feedback,
      userId: req.user!.userId,
    });

    res.status(202).json({
      success: true,
      jobId: job.id,
      playbookId: playbook.id,
      status: job.status,
      message: 'Refine job queued. Subscribe to WebSocket channel job:' + job.id + ' for updates.'
    });
  } catch (error) {
    next(error);
  }
});

export default router;
