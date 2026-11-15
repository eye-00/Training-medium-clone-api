import {
    Column,
    CreateDateColumn,
    Entity,
    Index,
    PrimaryColumn,
    UpdateDateColumn,
} from 'typeorm';

@Entity({ name: 'users' })
@Index('uq_users_email', ['email'], { unique: true })
@Index('uq_users_username', ['username'], { unique: true })
export class User {
    @PrimaryColumn({
        type: 'varchar',
        length: 36,
    })
    id!: string;
    @Column({
        type: 'varchar',
        length: 255,
    })
    email!: string;
    @Column({
        type: 'varchar',
        length: 100,
    })
    username!: string;
    @Column({
        name: 'password_hash',
        type: 'varchar',
        length: 255,
        select: false,
    })
    passwordHash!: string;
    @Column({
        type: 'text',
        nullable: true,
    })
    bio!: string | null;
    @Column({
        type: 'varchar',
        length: 2048,
        nullable: true,
    })
    image!: string | null;
    @CreateDateColumn({
        name: 'created_at',
        type: 'datetime',
        precision: 6,
        default: () => 'CURRENT_TIMESTAMP(6)',
    })
    createdAt!: Date;
    @UpdateDateColumn({
        name: 'updated_at',
        type: 'datetime',
        precision: 6,
        default: () => 'CURRENT_TIMESTAMP(6)',
        onUpdate: 'CURRENT_TIMESTAMP(6)',
    })
    updatedAt!: Date;
}