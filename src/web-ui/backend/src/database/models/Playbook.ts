import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn
} from 'typeorm';
import { User } from './User.js';

export enum PlaybookStatus {
  DRAFT = 'draft',
  VALIDATED = 'validated',
  FAILED = 'failed'
}

@Entity('playbooks')
export class Playbook {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  name!: string;

  @Column({ nullable: true })
  description!: string;

  @Column('text')
  content!: string;

  @Column({ default: 1 })
  version!: number;

  @Column({
    type: 'enum',
    enum: PlaybookStatus,
    default: PlaybookStatus.DRAFT
  })
  status!: PlaybookStatus;

  @Column({ nullable: true })
  filePath!: string;

  @Column({ nullable: true })
  template!: string;

  @Column({ nullable: true })
  prompt!: string;

  @Column('simple-array', { nullable: true })
  tags!: string[];

  @Column({ nullable: true })
  createdById!: string;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'createdById' })
  createdBy!: User;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;

  @Column('jsonb', { nullable: true })
  validationResults!: {
    yamlValid: boolean;
    syntaxValid: boolean;
    warnings: string[];
    errors: string[];
  };

  @Column('jsonb', { nullable: true })
  metadata!: Record<string, any>;
}
