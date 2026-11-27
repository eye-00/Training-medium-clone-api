import { ApiProperty } from '@nestjs/swagger';

export class CommentAuthorDto {
    @ApiProperty()
    username!: string;

    @ApiProperty({
        type: String,
        nullable: true,
    })
    bio!: string | null;

    @ApiProperty({
        type: String,
        nullable: true,
    })
    image!: string | null;

    @ApiProperty()
    following!: boolean;
}

export class CommentDetailsDto {
    @ApiProperty({
        type: 'integer',
        minimum: 1,
        maximum: 4294967295,
        example: 1,
    })
    id!: number;

    @ApiProperty({
        type: String,
        format: 'date-time',
    })
    createdAt!: string;

    @ApiProperty({
        type: String,
        format: 'date-time',
    })
    updatedAt!: string;

    @ApiProperty()
    body!: string;

    @ApiProperty({
        type: () => CommentAuthorDto,
    })
    author!: CommentAuthorDto;
}

export class CommentResponseDto {
    @ApiProperty({
        type: () => CommentDetailsDto,
    })
    comment!: CommentDetailsDto;
}
