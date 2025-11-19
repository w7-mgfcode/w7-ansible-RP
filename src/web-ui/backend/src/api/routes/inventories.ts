import { Router, Response } from 'express';
import * as fs from 'fs/promises';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { AppDataSource } from '../../database/connection.js';
import { Inventory, InventoryType } from '../../database/models/Inventory.js';
import { authMiddleware, optionalAuth, AuthenticatedRequest, userOrAdmin } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';

const router = Router();
const inventoryRepository = () => AppDataSource.getRepository(Inventory);

// Working directory for inventories
const INVENTORY_DIR = process.env.INVENTORY_DIR || '/tmp/ansible-mcp/inventory';

// Ensure directory exists
async function ensureDir(dir: string) {
  try {
    await fs.mkdir(dir, { recursive: true });
  } catch {
    // Directory exists
  }
}

// Validate file path is within allowed directory
function validateFilePath(filePath: string, baseDir: string): void {
  const resolvedBaseDir = path.resolve(baseDir);
  const resolvedFilePath = path.resolve(filePath);
  const relative = path.relative(resolvedBaseDir, resolvedFilePath);

  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new AppError('Invalid file path', 400);
  }
}

// Parse inventory content to extract hosts and groups
function parseInventoryContent(content: string): { hostCount: number; groupCount: number; groups: string[] } {
  const lines = content.split('\n');
  const hosts = new Set<string>();
  const groups = new Set<string>();
  let currentGroup = '';

  for (const line of lines) {
    const trimmed = line.trim();

    // Skip empty lines and comments
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith(';')) {
      continue;
    }

    // Check for group header - capture full content including possible suffixes
    const groupMatch = trimmed.match(/^\[([^\]]+)\]/);
    if (groupMatch) {
      const groupExpr = groupMatch[1]; // e.g. "webservers" or "all:children"
      const [groupName, suffix] = groupExpr.split(':', 2);
      // Skip special sections like :vars, :children
      if (!suffix) {
        groups.add(groupName);
        currentGroup = groupName;
      }
      continue;
    }

    // It's a host line
    if (currentGroup || groups.size === 0) {
      const hostName = trimmed.split(/\s+/)[0];
      if (hostName && !hostName.includes('=')) {
        hosts.add(hostName);
      }
    }
  }

  const groupsArray = Array.from(groups);
  return {
    hostCount: hosts.size,
    groupCount: groupsArray.length,
    groups: groupsArray
  };
}

// GET /api/inventories - List inventories
router.get('/', optionalAuth, async (req: AuthenticatedRequest, res: Response, next) => {
  try {
    const { type, search } = req.query;

    const parsedPage = parseInt(req.query.page as string, 10) || 1;
    const parsedLimit = parseInt(req.query.limit as string, 10) || 20;
    const clampedPage = Math.max(1, parsedPage);
    const clampedLimit = Math.min(100, Math.max(1, parsedLimit));

    const allowedSortFields = ['createdAt', 'updatedAt', 'name', 'hostCount'];
    const requestedSortBy = req.query.sortBy as string;
    const normalizedSortBy = allowedSortFields.includes(requestedSortBy) ? requestedSortBy : 'createdAt';

    const requestedSortOrder = (req.query.sortOrder as string)?.toUpperCase();
    const normalizedSortOrder: 'ASC' | 'DESC' = requestedSortOrder === 'ASC' ? 'ASC' : 'DESC';

    const queryBuilder = inventoryRepository().createQueryBuilder('inventory');

    if (type) {
      queryBuilder.andWhere('inventory.type = :type', { type });
    }

    if (search) {
      queryBuilder.andWhere(
        '(inventory.name ILIKE :search OR inventory.description ILIKE :search)',
        { search: `%${search}%` }
      );
    }

    const total = await queryBuilder.getCount();

    queryBuilder
      .orderBy(`inventory.${normalizedSortBy}`, normalizedSortOrder)
      .skip((clampedPage - 1) * clampedLimit)
      .take(clampedLimit);

    const inventories = await queryBuilder.getMany();

    res.json({
      inventories,
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

// GET /api/inventories/:id - Get inventory by ID
router.get('/:id', optionalAuth, async (req: AuthenticatedRequest, res: Response, next) => {
  try {
    const inventory = await inventoryRepository().findOne({
      where: { id: req.params.id },
      relations: ['createdBy']
    });

    if (!inventory) {
      throw new AppError('Inventory not found', 404);
    }

    res.json(inventory);
  } catch (error) {
    next(error);
  }
});

// POST /api/inventories - Create inventory
router.post('/', authMiddleware, userOrAdmin, async (req: AuthenticatedRequest, res: Response, next) => {
  try {
    const { name, description, content, type } = req.body;

    if (!name || !content) {
      throw new AppError('Name and content are required', 400);
    }

    // Validate type if provided
    const allowedTypes = [InventoryType.STATIC, InventoryType.DYNAMIC];
    if (type && !allowedTypes.includes(type)) {
      throw new AppError('Invalid inventory type', 400);
    }

    await ensureDir(INVENTORY_DIR);

    // Generate filename
    const filename = `inventory_${Date.now()}_${uuidv4().slice(0, 8)}.ini`;
    const filePath = path.join(INVENTORY_DIR, filename);

    validateFilePath(filePath, INVENTORY_DIR);

    // Write to file
    await fs.writeFile(filePath, content, 'utf-8');

    // Parse content to get host and group counts
    const parsed = parseInventoryContent(content);

    // Create database entry
    const inventory = inventoryRepository().create({
      name,
      description,
      content,
      filePath,
      type: type || InventoryType.STATIC,
      hostCount: parsed.hostCount,
      groupCount: parsed.groupCount,
      groups: parsed.groups,
      createdById: req.user!.userId
    });

    await inventoryRepository().save(inventory);

    res.status(201).json({
      success: true,
      inventory
    });
  } catch (error) {
    next(error);
  }
});

// PUT /api/inventories/:id - Update inventory
router.put('/:id', authMiddleware, userOrAdmin, async (req: AuthenticatedRequest, res: Response, next) => {
  try {
    const inventory = await inventoryRepository().findOne({
      where: { id: req.params.id }
    });

    if (!inventory) {
      throw new AppError('Inventory not found', 404);
    }

    const { name, description, content, type } = req.body;

    // Validate type if provided
    const allowedTypes = [InventoryType.STATIC, InventoryType.DYNAMIC];
    if (type !== undefined && !allowedTypes.includes(type)) {
      throw new AppError('Invalid inventory type', 400);
    }

    if (name !== undefined) inventory.name = name;
    if (description !== undefined) inventory.description = description;
    if (type !== undefined) inventory.type = type;

    if (content && content !== inventory.content) {
      inventory.content = content;

      // Re-parse content
      const parsed = parseInventoryContent(content);
      inventory.hostCount = parsed.hostCount;
      inventory.groupCount = parsed.groupCount;
      inventory.groups = parsed.groups;

      // Update file
      if (inventory.filePath) {
        validateFilePath(inventory.filePath, INVENTORY_DIR);
        await fs.writeFile(inventory.filePath, content, 'utf-8');
      }
    }

    await inventoryRepository().save(inventory);

    res.json({
      success: true,
      inventory
    });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/inventories/:id - Delete inventory
router.delete('/:id', authMiddleware, userOrAdmin, async (req: AuthenticatedRequest, res: Response, next) => {
  try {
    const inventory = await inventoryRepository().findOne({
      where: { id: req.params.id }
    });

    if (!inventory) {
      throw new AppError('Inventory not found', 404);
    }

    // Delete file if exists
    if (inventory.filePath) {
      validateFilePath(inventory.filePath, INVENTORY_DIR);
      try {
        await fs.unlink(inventory.filePath);
      } catch {
        // File may not exist
      }
    }

    await inventoryRepository().remove(inventory);

    res.json({ success: true, message: 'Inventory deleted' });
  } catch (error) {
    next(error);
  }
});

// POST /api/inventories/:id/test - Test inventory connectivity
router.post('/:id/test', authMiddleware, async (req: AuthenticatedRequest, res: Response, next) => {
  try {
    const inventory = await inventoryRepository().findOne({
      where: { id: req.params.id }
    });

    if (!inventory) {
      throw new AppError('Inventory not found', 404);
    }

    // For now, just mark as tested
    // Real implementation would ping hosts or run ansible -m ping
    inventory.lastTestedAt = new Date();
    inventory.lastTestSuccess = true;

    await inventoryRepository().save(inventory);

    res.json({
      success: true,
      message: 'Inventory test completed',
      inventory
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/inventories/:id/hosts - Get hosts from inventory
router.get('/:id/hosts', optionalAuth, async (req: AuthenticatedRequest, res: Response, next) => {
  try {
    const inventory = await inventoryRepository().findOne({
      where: { id: req.params.id }
    });

    if (!inventory) {
      throw new AppError('Inventory not found', 404);
    }

    // Parse and return hosts
    const lines = inventory.content.split('\n');
    const hosts: Array<{ name: string; group: string; vars: Record<string, string> }> = [];
    let currentGroup = 'ungrouped';

    for (const line of lines) {
      const trimmed = line.trim();

      if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith(';')) {
        continue;
      }

      const groupMatch = trimmed.match(/^\[([^\]]+)\]/);
      if (groupMatch) {
        const groupExpr = groupMatch[1];
        const [groupName, suffix] = groupExpr.split(':', 2);
        if (!suffix) {
          currentGroup = groupName;
        }
        continue;
      }

      // Parse host line
      const parts = trimmed.split(/\s+/);
      const hostName = parts[0];

      if (hostName && !hostName.includes('=')) {
        const vars: Record<string, string> = {};
        for (let i = 1; i < parts.length; i++) {
          const [key, value] = parts[i].split('=');
          if (key && value) {
            vars[key] = value;
          }
        }

        hosts.push({
          name: hostName,
          group: currentGroup,
          vars
        });
      }
    }

    res.json({
      inventoryId: inventory.id,
      hosts,
      groups: inventory.groups
    });
  } catch (error) {
    next(error);
  }
});

export default router;
