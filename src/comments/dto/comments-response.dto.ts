import { ApiProperty } from '@nestjs/swagger';
import { CommentDetailsDto } from './comment-response.dto.js';

export class CommentsResponseDto {
    @ApiProperty({
        type: [CommentDetailsDto],
    })
    comments!: CommentDetailsDto[];
}
