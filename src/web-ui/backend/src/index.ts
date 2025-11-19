import 'reflect-metadata';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import * as http from 'http';
import winston from 'winston';
import * as path from 'path';
import { fileURLToPath } from 'url';

import { initializeDatabase } from './database/connection.js';
import { errorHandler, notFoundHandler } from './api/middleware/errorHandler.js';
import { WebSocketManager } from './api/websocket/executor.js';
import { getJobQueueManager } from './services/jobQueueManager.js';

// Import routes
import authRoutes from './api/routes/auth.js';
import playbooksRoutes from './api/routes/playbooks.js';
import executionsRoutes from './api/routes/executions.js';
import templatesRoutes from './api/routes/templates.js';
import jobsRoutes from './api/routes/jobs.js';
import inventoriesRoutes from './api/routes/inventories.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Logger setup
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      )
    })
  ]
});

// Create Express app
const app = express();

// Trust proxy for rate limiting behind reverse proxy
app.set('trust proxy', 1);

// Security middleware
// SECURITY NOTE: 'unsafe-inline' in scriptSrc/styleSrc weakens XSS protection.
// For production hardening, consider:
// 1. Using nonces or hashes for inline scripts (requires build tool config)
// 2. Moving inline styles to external stylesheets
// 3. Configuring Vite to generate CSP-compatible bundles
// Current config is a balance between security and compatibility with React/Vite.
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      // TODO: Replace 'unsafe-inline' with nonces for better XSS protection
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'", "ws:", "wss:"],
      // Disable upgrade-insecure-requests for HTTP access via IP
      upgradeInsecureRequests: null
    }
  },
  // Disable HSTS for HTTP development/testing
  hsts: false,
  // Disable Cross-Origin-Opener-Policy for HTTP
  crossOriginOpenerPolicy: false
}));

// CORS configuration
app.use(cors({
  origin: process.env.CORS_ORIGINS?.split(',') || ['http://localhost:3000', 'http://localhost:5173'],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: { error: 'Too many requests, please try again later.' }
});
app.use('/api/', limiter);

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(compression());

// Request logging
app.use((req, res, next) => {
  logger.info({
    method: req.method,
    path: req.path,
    ip: req.ip
  });
  next();
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/playbooks', playbooksRoutes);
app.use('/api/executions', executionsRoutes);
app.use('/api/templates', templatesRoutes);
app.use('/api/jobs', jobsRoutes);
app.use('/api/inventories', inventoriesRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// System stats
app.get('/api/stats', (req, res) => {
  res.json({
    memory: process.memoryUsage(),
    uptime: process.uptime(),
    version: process.env.npm_package_version || '1.0.0'
  });
});

// Serve static files in production
// Path matches Dockerfile: /app/dist/index.js -> /app/frontend/dist
const frontendPath = path.join(__dirname, '../frontend/dist');
app.use(express.static(frontendPath));

// SPA fallback
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) {
    return next();
  }
  res.sendFile(path.join(frontendPath, 'index.html'), (err) => {
    if (err) {
      // If index.html doesn't exist, continue to 404 handler
      next();
    }
  });
});

// Error handling
app.use(notFoundHandler);
app.use(errorHandler);

// WebSocket manager (will be initialized with server)
let wsManager: WebSocketManager;

/**
 * Get the WebSocket manager instance
 * Use this getter instead of directly accessing wsManager to prevent reassignment
 */
export function getWebSocketManager(): WebSocketManager {
  return wsManager;
}

// Start server
async function startServer() {
  try {
    // Initialize database
    await initializeDatabase();
    logger.info('Database initialized');

    // Create HTTP server
    const server = http.createServer(app);

    // Initialize WebSocket
    wsManager = new WebSocketManager(server);
    logger.info('WebSocket server initialized');

    // Initialize Job Queue Manager
    const jobQueueManager = getJobQueueManager();
    await jobQueueManager.initialize();
    logger.info('Job Queue Manager initialized');

    // Start listening
    const port = parseInt(process.env.WEB_PORT || '3001');
    server.listen(port, () => {
      logger.info(`Web server running on port ${port}`);
      logger.info(`Health check: http://localhost:${port}/api/health`);
      logger.info(`WebSocket: ws://localhost:${port}/ws`);
    });

    // Graceful shutdown
    const shutdown = async () => {
      logger.info('Shutting down...');

      // Shutdown job queue manager
      await jobQueueManager.shutdown();
      logger.info('Job Queue Manager shut down');

      server.close(() => {
        logger.info('HTTP server closed');
        process.exit(0);
      });
    };

    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);

  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
}

// Export for external use
export { app };

// Start if run directly
startServer();
