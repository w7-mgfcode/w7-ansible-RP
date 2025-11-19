import { Queue, Worker, Job as BullJob } from 'bullmq';
import { AppDataSource } from '../database/connection.js';
import { Job, JobType, JobStatus } from '../database/models/Job.js';
import { Playbook, PlaybookStatus } from '../database/models/Playbook.js';
import { Execution, ExecutionStatus } from '../database/models/Execution.js';
import { getWebSocketManager } from '../index.js';
import { v4 as uuidv4 } from 'uuid';
import * as fs from 'fs/promises';
import * as path from 'path';
import { logger } from '../utils/logger.js';

const AI_GENERATOR_URL = process.env.AI_GENERATOR_URL || 'http://ai-generator:8000';

// Redis connection config
const redisConnection = {
  host: process.env.REDIS_HOST || 'redis',
  port: parseInt(process.env.REDIS_PORT || '6379'),
};

// Job input types
interface GenerateJobInput {
  name?: string;
  prompt: string;
  template?: string;
  description?: string;
  userId: string;
}

interface ValidateJobInput {
  playbookId: string;
  userId: string;
}

interface LintJobInput {
  playbookId: string;
  userId: string;
}

interface ExecuteJobInput {
  playbookId: string;
  inventory: string;
  extraVars?: Record<string, unknown>;
  checkMode?: boolean;
  tags?: string[];
  skipTags?: string[];
  limit?: string;
  diffMode?: boolean;
  verbosity?: number;
  userId: string;
}

interface RefineJobInput {
  playbookId: string;
  feedback: string;
  userId: string;
}

// Repositories
const jobRepository = () => AppDataSource.getRepository(Job);
const playbookRepository = () => AppDataSource.getRepository(Playbook);
const executionRepository = () => AppDataSource.getRepository(Execution);

class JobQueueManager {
  private generateQueue: Queue;
  private validateQueue: Queue;
  private lintQueue: Queue;
  private executeQueue: Queue;
  private refineQueue: Queue;

  private generateWorker: Worker | null = null;
  private validateWorker: Worker | null = null;
  private lintWorker: Worker | null = null;
  private executeWorker: Worker | null = null;
  private refineWorker: Worker | null = null;

  constructor() {
    // Initialize queues
    this.generateQueue = new Queue('generate', { connection: redisConnection });
    this.validateQueue = new Queue('validate', { connection: redisConnection });
    this.lintQueue = new Queue('lint', { connection: redisConnection });
    this.executeQueue = new Queue('execute', { connection: redisConnection });
    this.refineQueue = new Queue('refine', { connection: redisConnection });
  }

  async initialize(): Promise<void> {
    logger.info('Initializing Job Queue Manager');

    // Initialize workers
    this.generateWorker = new Worker('generate', this.processGenerateJob.bind(this), {
      connection: redisConnection,
      concurrency: 2,
    });

    this.validateWorker = new Worker('validate', this.processValidateJob.bind(this), {
      connection: redisConnection,
      concurrency: 5,
    });

    this.lintWorker = new Worker('lint', this.processLintJob.bind(this), {
      connection: redisConnection,
      concurrency: 5,
    });

    this.executeWorker = new Worker('execute', this.processExecuteJob.bind(this), {
      connection: redisConnection,
      concurrency: 3,
    });

    this.refineWorker = new Worker('refine', this.processRefineJob.bind(this), {
      connection: redisConnection,
      concurrency: 2,
    });

    // Set up event handlers for all workers
    const workers = [
      this.generateWorker,
      this.validateWorker,
      this.lintWorker,
      this.executeWorker,
      this.refineWorker,
    ];

    for (const worker of workers) {
      worker.on('completed', this.onJobCompleted.bind(this));
      worker.on('failed', this.onJobFailed.bind(this));
    }

    logger.info('Job Queue Manager initialized successfully');
  }

  async shutdown(): Promise<void> {
    logger.info('Shutting down Job Queue Manager');

    const workers = [
      this.generateWorker,
      this.validateWorker,
      this.lintWorker,
      this.executeWorker,
      this.refineWorker,
    ];

    for (const worker of workers) {
      if (worker) {
        await worker.close();
      }
    }

    await this.generateQueue.close();
    await this.validateQueue.close();
    await this.lintQueue.close();
    await this.executeQueue.close();
    await this.refineQueue.close();

    logger.info('Job Queue Manager shut down');
  }

  // Queue job methods
  async queueGenerateJob(input: GenerateJobInput): Promise<Job> {
    const job = jobRepository().create({
      type: JobType.GENERATE,
      status: JobStatus.QUEUED,
      input,
      createdById: input.userId,
    });
    await jobRepository().save(job);

    await this.generateQueue.add('generate', { jobId: job.id, ...input });

    this.broadcastJobUpdate(job.id, 0, JobStatus.QUEUED);
    logger.info(`Queued generate job: ${job.id}`);

    return job;
  }

  async queueValidateJob(input: ValidateJobInput): Promise<Job> {
    const job = jobRepository().create({
      type: JobType.VALIDATE,
      status: JobStatus.QUEUED,
      input,
      playbookId: input.playbookId,
      createdById: input.userId,
    });
    await jobRepository().save(job);

    await this.validateQueue.add('validate', { jobId: job.id, ...input });

    this.broadcastJobUpdate(job.id, 0, JobStatus.QUEUED);
    logger.info(`Queued validate job: ${job.id}`);

    return job;
  }

  async queueLintJob(input: LintJobInput): Promise<Job> {
    const job = jobRepository().create({
      type: JobType.LINT,
      status: JobStatus.QUEUED,
      input,
      playbookId: input.playbookId,
      createdById: input.userId,
    });
    await jobRepository().save(job);

    await this.lintQueue.add('lint', { jobId: job.id, ...input });

    this.broadcastJobUpdate(job.id, 0, JobStatus.QUEUED);
    logger.info(`Queued lint job: ${job.id}`);

    return job;
  }

  async queueExecuteJob(input: ExecuteJobInput): Promise<{ job: Job; execution: Execution }> {
    // Create execution record first
    const execution = executionRepository().create({
      playbookId: input.playbookId,
      status: ExecutionStatus.PENDING,
      inventory: input.inventory,
      extraVars: input.extraVars,
      checkMode: input.checkMode || false,
      tags: input.tags || [],
      executedById: input.userId,
    });
    await executionRepository().save(execution);

    // Create job record
    const job = jobRepository().create({
      type: JobType.EXECUTE,
      status: JobStatus.QUEUED,
      input,
      playbookId: input.playbookId,
      executionId: execution.id,
      createdById: input.userId,
    });
    await jobRepository().save(job);

    await this.executeQueue.add('execute', { jobId: job.id, executionId: execution.id, ...input });

    this.broadcastJobUpdate(job.id, 0, JobStatus.QUEUED);
    logger.info(`Queued execute job: ${job.id}, execution: ${execution.id}`);

    return { job, execution };
  }

  async queueRefineJob(input: RefineJobInput): Promise<Job> {
    const job = jobRepository().create({
      type: JobType.REFINE,
      status: JobStatus.QUEUED,
      input,
      playbookId: input.playbookId,
      createdById: input.userId,
    });
    await jobRepository().save(job);

    await this.refineQueue.add('refine', { jobId: job.id, ...input });

    this.broadcastJobUpdate(job.id, 0, JobStatus.QUEUED);
    logger.info(`Queued refine job: ${job.id}`);

    return job;
  }

  // Job processors
  private async processGenerateJob(bullJob: BullJob): Promise<void> {
    const { jobId, prompt, template, name, description, userId } = bullJob.data;

    const job = await jobRepository().findOne({ where: { id: jobId } });
    if (!job) throw new Error(`Job not found: ${jobId}`);

    // Update to processing
    job.status = JobStatus.PROCESSING;
    await jobRepository().save(job);
    this.broadcastJobUpdate(jobId, 10, JobStatus.PROCESSING);
    await bullJob.updateProgress(10);

    try {
      // Call AI Generator
      const response = await fetch(`${AI_GENERATOR_URL}/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, template }),
      });

      await bullJob.updateProgress(70);
      this.broadcastJobUpdate(jobId, 70, JobStatus.PROCESSING);

      if (!response.ok) {
        throw new Error(`AI Generator error: ${await response.text()}`);
      }

      const result = await response.json() as {
        playbook: string;
        playbook_type: string;
        validation: { valid: boolean; errors: string[] };
      };

      await bullJob.updateProgress(80);

      // Save playbook to file
      const filename = `playbook_${Date.now()}_${uuidv4().slice(0, 8)}.yml`;
      const playbookDir = '/tmp/ansible-mcp/playbooks';
      await fs.mkdir(playbookDir, { recursive: true });
      const filePath = path.join(playbookDir, filename);
      await fs.writeFile(filePath, result.playbook);

      // Create playbook record
      const playbook = playbookRepository().create({
        name: name || `Generated: ${prompt.slice(0, 50)}`,
        description: description || `Generated from prompt: ${prompt}`,
        content: result.playbook,
        filePath,
        template: template || null,
        prompt,
        status: result.validation?.valid ? PlaybookStatus.VALIDATED : PlaybookStatus.DRAFT,
        createdById: userId,
      });
      await playbookRepository().save(playbook);

      await bullJob.updateProgress(100);

      // Update job with result
      job.status = JobStatus.COMPLETED;
      job.progress = 100;
      job.result = {
        playbookId: playbook.id,
        playbookType: result.playbook_type,
        validation: result.validation,
      };
      job.playbookId = playbook.id;
      job.completedAt = new Date();
      await jobRepository().save(job);

      this.broadcastJobUpdate(jobId, 100, JobStatus.COMPLETED, job.result);

      // Broadcast playbook creation
      try {
        const wsManager = getWebSocketManager();
        wsManager.broadcastPlaybookUpdate(playbook.id, 'created', { playbook });
      } catch {
        // WebSocket may not be initialized
      }

    } catch (error) {
      job.status = JobStatus.FAILED;
      job.error = error instanceof Error ? error.message : 'Unknown error';
      job.completedAt = new Date();
      await jobRepository().save(job);

      this.broadcastJobUpdate(jobId, job.progress, JobStatus.FAILED, { error: job.error });
      throw error;
    }
  }

  private async processValidateJob(bullJob: BullJob): Promise<void> {
    const { jobId, playbookId } = bullJob.data;

    const job = await jobRepository().findOne({ where: { id: jobId } });
    if (!job) throw new Error(`Job not found: ${jobId}`);

    const playbook = await playbookRepository().findOne({ where: { id: playbookId } });
    if (!playbook) throw new Error(`Playbook not found: ${playbookId}`);

    job.status = JobStatus.PROCESSING;
    await jobRepository().save(job);
    this.broadcastJobUpdate(jobId, 10, JobStatus.PROCESSING);
    await bullJob.updateProgress(10);

    try {
      const response = await fetch(`${AI_GENERATOR_URL}/validate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playbook_content: playbook.content }),
      });

      await bullJob.updateProgress(80);

      if (!response.ok) {
        throw new Error(`Validation service error: ${await response.text()}`);
      }

      const result = await response.json() as {
        valid: boolean;
        yaml_valid: boolean;
        syntax_valid: boolean;
        errors: string[];
        warnings: string[];
      };

      // Update playbook status
      playbook.status = result.valid ? PlaybookStatus.VALIDATED : PlaybookStatus.INVALID;
      playbook.validationResults = {
        yamlValid: result.yaml_valid,
        syntaxValid: result.syntax_valid,
        errors: result.errors,
        warnings: result.warnings,
      };
      await playbookRepository().save(playbook);

      await bullJob.updateProgress(100);

      job.status = JobStatus.COMPLETED;
      job.progress = 100;
      job.result = result;
      job.completedAt = new Date();
      await jobRepository().save(job);

      this.broadcastJobUpdate(jobId, 100, JobStatus.COMPLETED, result);

    } catch (error) {
      job.status = JobStatus.FAILED;
      job.error = error instanceof Error ? error.message : 'Unknown error';
      job.completedAt = new Date();
      await jobRepository().save(job);

      this.broadcastJobUpdate(jobId, job.progress, JobStatus.FAILED, { error: job.error });
      throw error;
    }
  }

  private async processLintJob(bullJob: BullJob): Promise<void> {
    const { jobId, playbookId } = bullJob.data;

    const job = await jobRepository().findOne({ where: { id: jobId } });
    if (!job) throw new Error(`Job not found: ${jobId}`);

    const playbook = await playbookRepository().findOne({ where: { id: playbookId } });
    if (!playbook) throw new Error(`Playbook not found: ${playbookId}`);

    job.status = JobStatus.PROCESSING;
    await jobRepository().save(job);
    this.broadcastJobUpdate(jobId, 10, JobStatus.PROCESSING);
    await bullJob.updateProgress(10);

    try {
      const response = await fetch(`${AI_GENERATOR_URL}/lint`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playbook_content: playbook.content }),
      });

      await bullJob.updateProgress(80);

      if (!response.ok) {
        throw new Error(`Lint service error: ${await response.text()}`);
      }

      const result = await response.json() as Record<string, unknown>;

      await bullJob.updateProgress(100);

      job.status = JobStatus.COMPLETED;
      job.progress = 100;
      job.result = result as Record<string, unknown>;
      job.completedAt = new Date();
      await jobRepository().save(job);

      this.broadcastJobUpdate(jobId, 100, JobStatus.COMPLETED, result);

    } catch (error) {
      job.status = JobStatus.FAILED;
      job.error = error instanceof Error ? error.message : 'Unknown error';
      job.completedAt = new Date();
      await jobRepository().save(job);

      this.broadcastJobUpdate(jobId, job.progress, JobStatus.FAILED, { error: job.error });
      throw error;
    }
  }

  private async processExecuteJob(bullJob: BullJob): Promise<void> {
    const { jobId, executionId, playbookId, inventory, extraVars, checkMode, tags, skipTags, limit, diffMode, verbosity } = bullJob.data;

    const job = await jobRepository().findOne({ where: { id: jobId } });
    if (!job) throw new Error(`Job not found: ${jobId}`);

    const playbook = await playbookRepository().findOne({ where: { id: playbookId } });
    if (!playbook) throw new Error(`Playbook not found: ${playbookId}`);

    const execution = await executionRepository().findOne({ where: { id: executionId } });
    if (!execution) throw new Error(`Execution not found: ${executionId}`);

    // Update statuses
    job.status = JobStatus.PROCESSING;
    await jobRepository().save(job);

    execution.status = ExecutionStatus.RUNNING;
    await executionRepository().save(execution);

    this.broadcastJobUpdate(jobId, 10, JobStatus.PROCESSING);
    await bullJob.updateProgress(10);

    // Broadcast execution started
    try {
      const wsManager = getWebSocketManager();
      wsManager.broadcastExecutionOutput(executionId, 'Execution started...', 'running');
    } catch {
      // WebSocket may not be initialized
    }

    try {
      const response = await fetch(`${AI_GENERATOR_URL}/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          playbook_content: playbook.content,
          inventory,
          extra_vars: extraVars,
          limit,
          tags,
          skip_tags: skipTags,
          check_mode: checkMode || false,
          diff_mode: diffMode || false,
          verbosity: verbosity || 0,
        }),
      });

      await bullJob.updateProgress(80);

      if (!response.ok) {
        const errorText = await response.text();
        execution.status = ExecutionStatus.FAILED;
        execution.error = errorText;
        execution.completedAt = new Date();
        await executionRepository().save(execution);
        throw new Error(`Execution service error: ${errorText}`);
      }

      const result = await response.json() as {
        success: boolean;
        output: string;
        error?: string;
        stats?: Record<string, unknown>;
        duration_seconds?: number;
      };

      await bullJob.updateProgress(100);

      // Update execution
      execution.status = result.success ? ExecutionStatus.SUCCESS : ExecutionStatus.FAILED;
      execution.output = result.output;
      execution.error = result.error || '';
      execution.durationSeconds = result.duration_seconds || 0;
      execution.completedAt = new Date();
      await executionRepository().save(execution);

      // Update playbook execution count atomically to prevent race conditions
      await playbookRepository().increment(
        { id: playbook.id },
        'executionCount',
        1
      );
      await playbookRepository().update(
        { id: playbook.id },
        { lastExecutedAt: new Date() }
      );

      // Update job
      job.status = JobStatus.COMPLETED;
      job.progress = 100;
      job.result = {
        success: result.success,
        output: result.output,
        error: result.error,
        durationSeconds: result.duration_seconds,
      };
      job.completedAt = new Date();
      await jobRepository().save(job);

      this.broadcastJobUpdate(jobId, 100, JobStatus.COMPLETED, job.result);

      // Broadcast execution completed
      try {
        const wsManager = getWebSocketManager();
        wsManager.broadcastExecutionOutput(executionId, result.output, execution.status);
      } catch {
        // WebSocket may not be initialized
      }

    } catch (error) {
      job.status = JobStatus.FAILED;
      job.error = error instanceof Error ? error.message : 'Unknown error';
      job.completedAt = new Date();
      await jobRepository().save(job);

      this.broadcastJobUpdate(jobId, job.progress, JobStatus.FAILED, { error: job.error });
      throw error;
    }
  }

  private async processRefineJob(bullJob: BullJob): Promise<void> {
    const { jobId, playbookId, feedback, userId } = bullJob.data;

    const job = await jobRepository().findOne({ where: { id: jobId } });
    if (!job) throw new Error(`Job not found: ${jobId}`);

    const playbook = await playbookRepository().findOne({ where: { id: playbookId } });
    if (!playbook) throw new Error(`Playbook not found: ${playbookId}`);

    job.status = JobStatus.PROCESSING;
    await jobRepository().save(job);
    this.broadcastJobUpdate(jobId, 10, JobStatus.PROCESSING);
    await bullJob.updateProgress(10);

    try {
      // Build refinement prompt
      const refinementPrompt = `Please refine this Ansible playbook based on the following feedback:

Current playbook:
\`\`\`yaml
${playbook.content}
\`\`\`

Feedback: ${feedback}

Please provide the improved playbook.`;

      const response = await fetch(`${AI_GENERATOR_URL}/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: refinementPrompt }),
      });

      await bullJob.updateProgress(70);

      if (!response.ok) {
        throw new Error(`Refinement service error: ${await response.text()}`);
      }

      const result = await response.json() as {
        playbook: string;
        playbook_type: string;
        validation: { valid: boolean; errors: string[] };
      };

      await bullJob.updateProgress(90);

      // Update playbook with refined content
      playbook.content = result.playbook;
      playbook.version = (playbook.version || 1) + 1;
      playbook.status = result.validation?.valid ? PlaybookStatus.VALIDATED : PlaybookStatus.DRAFT;

      // Save to file
      if (playbook.filePath) {
        await fs.writeFile(playbook.filePath, result.playbook);
      }

      await playbookRepository().save(playbook);

      await bullJob.updateProgress(100);

      job.status = JobStatus.COMPLETED;
      job.progress = 100;
      job.result = {
        playbookId: playbook.id,
        version: playbook.version,
        validation: result.validation,
      };
      job.completedAt = new Date();
      await jobRepository().save(job);

      this.broadcastJobUpdate(jobId, 100, JobStatus.COMPLETED, job.result);

      // Broadcast playbook update
      try {
        const wsManager = getWebSocketManager();
        wsManager.broadcastPlaybookUpdate(playbook.id, 'updated', { playbook });
      } catch {
        // WebSocket may not be initialized
      }

    } catch (error) {
      job.status = JobStatus.FAILED;
      job.error = error instanceof Error ? error.message : 'Unknown error';
      job.completedAt = new Date();
      await jobRepository().save(job);

      this.broadcastJobUpdate(jobId, job.progress, JobStatus.FAILED, { error: job.error });
      throw error;
    }
  }

  // Event handlers
  private async onJobCompleted(bullJob: BullJob): Promise<void> {
    logger.info(`Job completed: ${bullJob.data.jobId}`);
  }

  private async onJobFailed(bullJob: BullJob | undefined, error: Error): Promise<void> {
    if (bullJob) {
      logger.error(`Job failed: ${bullJob.data.jobId}`, { error: error.message });
    }
  }

  // Utility methods
  private broadcastJobUpdate(jobId: string, progress: number, status: string, result?: unknown): void {
    try {
      const wsManager = getWebSocketManager();
      wsManager.broadcastJobProgress(jobId, progress, status);

      if (result) {
        wsManager.broadcast(`job:${jobId}`, {
          type: 'result',
          jobId,
          progress,
          status,
          result,
        });
      }
    } catch {
      // WebSocket may not be initialized
    }
  }
}

// Singleton instance
let jobQueueManager: JobQueueManager | null = null;

export function getJobQueueManager(): JobQueueManager {
  if (!jobQueueManager) {
    jobQueueManager = new JobQueueManager();
  }
  return jobQueueManager;
}

export { JobQueueManager };
