
import {
    CreateDateColumn,
    Entity,
    Index,
    PrimaryColumn,
} from 'typeorm';

@Entity({ name: 'article_favorites' })
@Index(
    'idx_article_favorites_article_user',
    ['articleId', 'userId'],
)
export class ArticleFavorite {
    @PrimaryColumn({
        name: 'user_id',
        type: 'varchar',
        length: 36,
    })
    userId!: string;

    @PrimaryColumn({
        name: 'article_id',
        type: 'varchar',
        length: 36,
    })
    articleId!: string;

    @CreateDateColumn({
        name: 'created_at',
        type: 'datetime',
        precision: 6,
        default: () => 'CURRENT_TIMESTAMP(6)',
    })
    createdAt!: Date;
}
