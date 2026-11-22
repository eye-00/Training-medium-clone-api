
import {
    ApiProperty,
    OmitType,
} from '@nestjs/swagger';

import { ArticleDetailsDto } from './article-response.dto.js';

export class ArticleListItemDto extends OmitType(
    ArticleDetailsDto,
    ['body'] as const,
) { }

export class ArticlesResponseDto {
    @ApiProperty({
        type: [ArticleListItemDto],
    })
    articles!: ArticleListItemDto[];

    @ApiProperty({ minimum: 0 })
    articlesCount!: number;
}
