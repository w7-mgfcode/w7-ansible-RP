import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn
} from 'typeorm';

export enum JobType {
  GENERATE = 'generate',
  VALIDATE = 'validate',
  LINT = 'lint',
  REFINE = 'refine',
  EXECUTE = 'execute'
}

export enum JobStatus {
  QUEUED = 'queued',
  PROCESSING = 'processing',
  COMPLETED = 'completed',
  FAILED = 'failed',
  CANCELLED = 'cancelled'
}

@Entity('jobs')
export class Job {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({
    type: 'enum',
    enum: JobType
  })
  type!: JobType;

  @Column({
    type: 'enum',
    enum: JobStatus,
    default: JobStatus.QUEUED
  })
  status!: JobStatus;

  @Column({ default: 0 })
  progress!: number;

  @Column({ nullable: true })
  executionId!: string;

  @Column({ nullable: true })
  playbookId!: string;

  @Column('jsonb', { nullable: true })
  input!: Record<string, any>;

  @Column('jsonb', { nullable: true })
  result!: Record<string, any>;

  @Column({ nullable: true })
  error!: string;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;

  @Column({ nullable: true })
  completedAt!: Date;

  @Column({ nullable: true })
  createdById!: string;
}
