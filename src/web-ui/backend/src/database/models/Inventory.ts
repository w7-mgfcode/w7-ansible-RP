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

export enum InventoryType {
  STATIC = 'static',
  DYNAMIC = 'dynamic'
}

@Entity('inventories')
export class Inventory {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  name!: string;

  @Column({ nullable: true })
  description!: string;

  @Column('text')
  content!: string;

  @Column({ nullable: true })
  filePath!: string;

  @Column({
    type: 'enum',
    enum: InventoryType,
    default: InventoryType.STATIC
  })
  type!: InventoryType;

  @Column({ default: 0 })
  hostCount!: number;

  @Column({ default: 0 })
  groupCount!: number;

  @Column('simple-array', { nullable: true })
  groups!: string[];

  @Column({ nullable: true })
  createdById!: string;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'createdById' })
  createdBy!: User;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;

  @Column({ nullable: true })
  lastTestedAt!: Date;

  @Column({ default: false })
  lastTestSuccess!: boolean;

  @Column('jsonb', { nullable: true })
  metadata!: Record<string, unknown>;
}
