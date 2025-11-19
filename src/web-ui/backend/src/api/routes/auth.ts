import { Router, Response } from 'express';
import bcrypt from 'bcryptjs';
import { AppDataSource } from '../../database/connection.js';
import { User, UserRole } from '../../database/models/User.js';
import { generateToken, authMiddleware, AuthenticatedRequest } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';

const router = Router();
const userRepository = () => AppDataSource.getRepository(User);

// POST /api/auth/register
router.post('/register', async (req, res: Response, next) => {
  try {
    const { username, email, password } = req.body;

    if (!username || !email || !password) {
      throw new AppError('Username, email and password are required', 400);
    }

    // Check if user exists
    const existingUser = await userRepository().findOne({
      where: [{ username }, { email }]
    });

    if (existingUser) {
      throw new AppError('User already exists', 409);
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, 12);

    // Create user - always assign USER role, admin roles must be set by admins
    const user = userRepository().create({
      username,
      email,
      passwordHash,
      role: UserRole.USER
    });

    await userRepository().save(user);

    // Generate token
    const token = generateToken({
      userId: user.id,
      username: user.username,
      email: user.email,
      role: user.role
    });

    res.status(201).json({
      success: true,
      token,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role
      }
    });
  } catch (error) {
    next(error);
  }
});

// POST /api/auth/login
router.post('/login', async (req, res: Response, next) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      throw new AppError('Username and password are required', 400);
    }

    // Find user
    const user = await userRepository().findOne({
      where: [{ username }, { email: username }]
    });

    if (!user) {
      throw new AppError('Invalid credentials', 401);
    }

    // Check password
    const isValid = await bcrypt.compare(password, user.passwordHash);

    if (!isValid) {
      throw new AppError('Invalid credentials', 401);
    }

    // Update last login
    user.lastLoginAt = new Date();
    await userRepository().save(user);

    // Generate token
    const token = generateToken({
      userId: user.id,
      username: user.username,
      email: user.email,
      role: user.role
    });

    res.json({
      success: true,
      token,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role
      }
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/auth/me
router.get('/me', authMiddleware, async (req: AuthenticatedRequest, res: Response, next) => {
  try {
    if (!req.user) {
      throw new AppError('Not authenticated', 401);
    }

    const user = await userRepository().findOne({
      where: { id: req.user.userId }
    });

    if (!user) {
      throw new AppError('User not found', 404);
    }

    res.json({
      id: user.id,
      username: user.username,
      email: user.email,
      role: user.role,
      createdAt: user.createdAt,
      lastLoginAt: user.lastLoginAt
    });
  } catch (error) {
    next(error);
  }
});

// POST /api/auth/logout
router.post('/logout', authMiddleware, (req: AuthenticatedRequest, res: Response) => {
  // In a real app, you'd invalidate the token in Redis
  res.json({ success: true, message: 'Logged out successfully' });
});

// PUT /api/auth/password
router.put('/password', authMiddleware, async (req: AuthenticatedRequest, res: Response, next) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      throw new AppError('Current and new password are required', 400);
    }

    if (!req.user) {
      throw new AppError('Not authenticated', 401);
    }

    const user = await userRepository().findOne({
      where: { id: req.user.userId }
    });

    if (!user) {
      throw new AppError('User not found', 404);
    }

    // Verify current password
    const isValid = await bcrypt.compare(currentPassword, user.passwordHash);

    if (!isValid) {
      throw new AppError('Current password is incorrect', 401);
    }

    // Update password
    user.passwordHash = await bcrypt.hash(newPassword, 12);
    await userRepository().save(user);

    res.json({ success: true, message: 'Password updated successfully' });
  } catch (error) {
    next(error);
  }
});

export default router;
