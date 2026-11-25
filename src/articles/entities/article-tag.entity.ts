
import {
    Entity,
    Index,
    PrimaryColumn,
} from 'typeorm';

@Entity({ name: 'article_tags' })
@Index(
    'idx_article_tags_tag_article',
    ['tagId', 'articleId'],
)
export class ArticleTag {
    @PrimaryColumn({
        name: 'article_id',
        type: 'varchar',
        length: 36,
    })
    articleId!: string;

    @PrimaryColumn({
        name: 'tag_id',
        type: 'varchar',
        length: 36,
    })
    tagId!: string;
}
