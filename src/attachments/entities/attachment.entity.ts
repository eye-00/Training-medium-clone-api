import {
    Column,
    CreateDateColumn,
    Entity,
    Index,
    PrimaryColumn,
} from 'typeorm';
@Entity({ name: 'attachments' })
@Index('idx_attachments_owner', ['ownerType', 'ownerId', 'kind'])
@Index('uq_attachments_storage_key', ['storageKey'], { unique: true })
export class Attachment {
    @PrimaryColumn({
        type: 'varchar',
        length: 36,
    })
    id!: string;
    @Column({
        name: 'owner_type',
        type: 'varchar',
        length: 32,
    })
    ownerType!: string;
    @Column({
        name: 'owner_id',
        type: 'varchar',
        length: 36,
    })
    ownerId!: string;

    @Column({
        type: 'varchar',
        length: 32,
    })
    kind!: string;
    @Column({
        name: 'original_name',
        type: 'varchar',
        length: 255,
    })
    originalName!: string;

    @Column({
        name: 'storage_key',
        type: 'varchar',
        length: 255,
    })
    storageKey!: string;

    @Column({
        name: 'mime_type',
        type: 'varchar',
        length: 100,
    })
    mimeType!: string;

    @Column({
        name: 'size_bytes',
        type: 'int',
        unsigned: true,
    })
    sizeBytes!: number;

    @Column({
        type: 'varchar',
        length: 16,
        default: 'public',
    })
    visibility!: 'public' | 'private';

    @CreateDateColumn({
        name: 'created_at',
        type: 'datetime',
        precision: 6,
        default: () => 'CURRENT_TIMESTAMP(6)',
    })
    createdAt!: Date;
}