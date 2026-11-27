
import { ApiProperty } from '@nestjs/swagger';

export class ArticleAuthorDto {
    @ApiProperty()
    username!: string;

    @ApiProperty({ nullable: true })
    bio!: string | null;

    @ApiProperty({ nullable: true })
    image!: string | null;

    @ApiProperty()
    following!: boolean;
}

export class ArticleDetailsDto {
    @ApiProperty()
    slug!: string;

    @ApiProperty()
    title!: string;

    @ApiProperty()
    description!: string;

    @ApiProperty()
    body!: string;

    @ApiProperty({ type: [String] })
    tagList!: string[];

    @ApiProperty()
    createdAt!: string;

    @ApiProperty()
    updatedAt!: string;

    @ApiProperty()
    favorited!: boolean;

    @ApiProperty()
    favoritesCount!: number;

    @ApiProperty({ type: () => ArticleAuthorDto })
    author!: ArticleAuthorDto;
}

export class ArticleResponseDto {
    @ApiProperty({ type: () => ArticleDetailsDto })
    article!: ArticleDetailsDto;
}
