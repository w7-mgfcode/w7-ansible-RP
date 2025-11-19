import { Router, Response } from 'express';
import * as fs from 'fs/promises';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { AppDataSource } from '../../database/connection.js';
import { Playbook, PlaybookStatus } from '../../database/models/Playbook.js';
import { authMiddleware, optionalAuth, AuthenticatedRequest, userOrAdmin } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';

const router = Router();
const playbookRepository = () => AppDataSource.getRepository(Playbook);

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

    // Validate the resolved path is within PLAYBOOK_DIR (prevent path traversal)
    const resolvedPlaybookDir = path.resolve(PLAYBOOK_DIR);
    const resolvedFilePath = path.resolve(filePath);
    if (!resolvedFilePath.startsWith(resolvedPlaybookDir + path.sep)) {
      throw new AppError('Invalid file path', 400);
    }

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
        // Re-validate path to prevent path traversal attacks
        const resolvedPlaybookDir = path.resolve(PLAYBOOK_DIR);
        const resolvedFilePath = path.resolve(playbook.filePath);
        if (!resolvedFilePath.startsWith(resolvedPlaybookDir + path.sep)) {
          throw new AppError('Invalid file path', 400);
        }
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
      // Re-validate path to prevent path traversal attacks
      const resolvedPlaybookDir = path.resolve(PLAYBOOK_DIR);
      const resolvedFilePath = path.resolve(playbook.filePath);
      if (!resolvedFilePath.startsWith(resolvedPlaybookDir + path.sep)) {
        throw new AppError('Invalid file path', 400);
      }
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
    const { prompt, template, context, provider, model } = req.body;

    if (!prompt) {
      throw new AppError('Prompt is required', 400);
    }

    // Call AI Generator service
    const generateUrl = `${AI_GENERATOR_URL}/generate`;

    const generateRequest = {
      prompt,
      template: template || undefined,
      target_hosts: context?.target_hosts || 'all',
      environment: context?.environment || 'production',
      tags: context?.tags || [],
      provider: provider || process.env.AI_PROVIDER || 'gemini',
      model: model || process.env.AI_MODEL || undefined,
      use_ai: true
    };

    // Make HTTP request to AI Generator
    const response = await fetch(generateUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(generateRequest),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new AppError(`AI Generator error: ${errorText}`, response.status);
    }

    const result = await response.json();

    if (!result.success) {
      throw new AppError(result.error || 'Generation failed', 500);
    }

    // Save the generated playbook to database
    await ensureDir(PLAYBOOK_DIR);

    const filename = `playbook_${Date.now()}_${uuidv4().slice(0, 8)}.yml`;
    const filePath = path.join(PLAYBOOK_DIR, filename);

    // Validate path
    const resolvedPlaybookDir = path.resolve(PLAYBOOK_DIR);
    const resolvedFilePath = path.resolve(filePath);
    if (!resolvedFilePath.startsWith(resolvedPlaybookDir + path.sep)) {
      throw new AppError('Invalid file path', 400);
    }

    // Write to file
    await fs.writeFile(filePath, result.playbook, 'utf-8');

    // Generate name from prompt
    const playbookName = `Generated: ${prompt.substring(0, 50)}${prompt.length > 50 ? '...' : ''}`;

    // Create database entry
    const playbook = playbookRepository().create({
      name: playbookName,
      description: `Generated from prompt: ${prompt}`,
      content: result.playbook,
      filePath,
      prompt,
      template: template || null,
      tags: context?.tags || [],
      status: PlaybookStatus.DRAFT,
      createdById: req.user!.userId
    });

    await playbookRepository().save(playbook);

    res.json({
      success: true,
      playbook,
      playbookType: result.playbook_type,
      message: 'Playbook generated successfully'
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

    // This will be integrated with MCP server's validate_playbook tool
    // For now, return a placeholder
    res.json({
      success: true,
      message: 'Validation request received',
      playbookId: playbook.id
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

    const { inventory, extraVars, checkMode, tags } = req.body;

    // This will be integrated with MCP server's run_playbook tool
    res.json({
      success: true,
      message: 'Execution request received',
      executionId: uuidv4(),
      playbookId: playbook.id,
      inventory,
      extraVars,
      checkMode,
      tags
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

    // This will be integrated with MCP server's lint_playbook tool
    res.json({
      success: true,
      message: 'Lint request received',
      playbookId: playbook.id
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

    // This will be integrated with MCP server's refine_playbook tool
    res.json({
      success: true,
      message: 'Refine request received',
      playbookId: playbook.id,
      feedback
    });
  } catch (error) {
    next(error);
  }
});

export default router;
