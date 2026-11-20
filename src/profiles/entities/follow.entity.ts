import {
    CreateDateColumn,
    Entity,
    Index,
    PrimaryColumn,
} from 'typeorm';
@Entity({ name: 'follows' })
@Index('idx_follows_followed_id', ['followedId'])
export class Follow {
    @PrimaryColumn({
        name: 'follower_id',
        type: 'varchar',
        length: 36,
    })
    followerId!: string;
    @PrimaryColumn({
        name: 'followed_id',
        type: 'varchar',
        length: 36,
    })
    followedId!: string;
    @CreateDateColumn({
        name: 'created_at',
        type: 'datetime',
        precision: 6,
        default: () => 'CURRENT_TIMESTAMP(6)',
    })
    createdAt!: Date;
}