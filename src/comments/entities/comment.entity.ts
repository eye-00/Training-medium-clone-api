import {
    Column,
    CreateDateColumn,
    Entity,
    Index,
    PrimaryGeneratedColumn,
    UpdateDateColumn,
} from 'typeorm';

@Entity({ name: 'comments' })
@Index('idx_comments_article_created_id', [
    'articleId',
    'createdAt',
    'id',
])
@Index('idx_comments_author', ['authorId'])
export class Comment {
    @PrimaryGeneratedColumn({
        type: 'int',
        unsigned: true,
    })
    id!: number;

    @Column({
        name: 'article_id',
        type: 'varchar',
        length: 36,
    })
    articleId!: string;

    @Column({
        name: 'author_id',
        type: 'varchar',
        length: 36,
    })
    authorId!: string;

    @Column({
        type: 'text',
    })
    body!: string;

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
