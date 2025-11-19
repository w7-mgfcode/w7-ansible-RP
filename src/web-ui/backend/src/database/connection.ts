import 'reflect-metadata';
import { DataSource } from 'typeorm';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { User } from './models/User.js';
import { Playbook } from './models/Playbook.js';
import { Execution } from './models/Execution.js';
import { Job } from './models/Job.js';
import { Inventory } from './models/Inventory.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const isDevelopment = process.env.NODE_ENV === 'development';
const isProduction = process.env.NODE_ENV === 'production';

// Fail-fast: require credentials in production environment
if (isProduction) {
  if (!process.env.DB_PASSWORD) {
    throw new Error('DB_PASSWORD environment variable is required in production');
  }
  if (!process.env.DB_NAME) {
    throw new Error('DB_NAME environment variable is required in production');
  }
  if (!process.env.DB_USER) {
    throw new Error('DB_USER environment variable is required in production');
  }
}

// TODO: In production, synchronize MUST be false. Use migrations for schema updates.
// Migrations should be placed in ./migrations directory and run via:
// npx typeorm migration:run -d dist/database/connection.js
export const AppDataSource = new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  // Only use insecure defaults in development
  username: process.env.DB_USER || (isDevelopment ? 'postgres' : ''),
  password: process.env.DB_PASSWORD || (isDevelopment ? 'postgres' : ''),
  database: process.env.DB_NAME || (isDevelopment ? 'ansible_mcp_dev' : ''),
  // CRITICAL: synchronize must be false in production - use migrations instead
  synchronize: isDevelopment,
  logging: isDevelopment,
  entities: [User, Playbook, Execution, Job, Inventory],
  migrations: [path.join(__dirname, '../migrations/*.js')],
  subscribers: [],
});

export async function initializeDatabase(): Promise<void> {
  try {
    if (isProduction && AppDataSource.options.synchronize) {
      throw new Error('CRITICAL: synchronize must be false in production. Use migrations instead.');
    }
    await AppDataSource.initialize();
    console.log('Database connection established');
  } catch (error) {
    console.error('Error connecting to database:', error);
    throw error;
  }
}

export { User, Playbook, Execution, Job, Inventory };
