import { ApiProperty } from '@nestjs/swagger';

export class TagsResponseDto {
  @ApiProperty({
    type: [String],
    example: ['backend', 'nestjs', 'typescript'],
    description: 'Sorted list of tags used by articles',
  })
  tags!: string[];
}
