
import {
    Column,
    CreateDateColumn,
    Entity,
    Index,
    PrimaryColumn,
    UpdateDateColumn,
} from 'typeorm';

@Entity({ name: 'articles' })
@Index('uq_articles_slug', ['slug'], {
    unique: true,
})
@Index('idx_articles_created_id', [
    'createdAt',
    'id',
])
@Index('idx_articles_author_created_id', [
    'authorId',
    'createdAt',
    'id',
])
export class Article {
    @PrimaryColumn({
        type: 'varchar',
        length: 36,
    })
    id!: string;

    @Column({
        type: 'varchar',
        length: 255,
    })
    slug!: string;

    @Column({
        type: 'varchar',
        length: 255,
    })
    title!: string;

    @Column({
        type: 'text',
    })
    description!: string;

    @Column({
        type: 'longtext',
    })
    body!: string;

    @Column({
        name: 'author_id',
        type: 'varchar',
        length: 36,
    })
    authorId!: string;

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
