import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn
} from 'typeorm';
import { User } from './User.js';
import { Playbook } from './Playbook.js';

export enum ExecutionStatus {
  PENDING = 'pending',
  RUNNING = 'running',
  SUCCESS = 'success',
  FAILED = 'failed',
  CANCELLED = 'cancelled'
}

@Entity('executions')
export class Execution {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  playbookId!: string;

  @ManyToOne(() => Playbook, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'playbookId' })
  playbook!: Playbook;

  @Column({
    type: 'enum',
    enum: ExecutionStatus,
    default: ExecutionStatus.PENDING
  })
  status!: ExecutionStatus;

  @Column('text', { nullable: true })
  output!: string;

  @Column('text', { nullable: true })
  error!: string;

  @Column({ nullable: true })
  inventory!: string;

  @Column('jsonb', { nullable: true })
  extraVars!: Record<string, any>;

  @Column({ default: false })
  checkMode!: boolean;

  @Column('simple-array', { nullable: true })
  tags!: string[];

  @Column({ nullable: true })
  command!: string;

  @CreateDateColumn()
  startedAt!: Date;

  @Column({ nullable: true })
  completedAt!: Date;

  @Column('float', { nullable: true })
  durationSeconds!: number;

  @Column({ nullable: true })
  executedById!: string;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'executedById' })
  executedBy!: User;

  @Column('jsonb', { nullable: true })
  stats!: {
    ok: number;
    changed: number;
    unreachable: number;
    failed: number;
    skipped: number;
  };

  @Column('jsonb', { nullable: true })
  metadata!: Record<string, any>;
}
