import { Transform, Type } from 'class-transformer';
import {
    IsDefined,
    IsObject,
    IsString,
    MinLength,
    MaxLength,
    ValidateNested,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateCommentFieldsDto {
    @ApiProperty({
        example: 'This is a great article!',
        description: 'After trimming, 1–5000 characters.',
    })
    @Transform(({ value }: { value: unknown }) =>
        typeof value === 'string'
            ? value.trim()
            : value,
    )
    @IsString()
    @MinLength(1)
    @MaxLength(5000)
    body!: string;
}

export class CreateCommentDto {
    @ApiProperty({
        type: () => CreateCommentFieldsDto,
    })
    @IsDefined()
    @IsObject()
    @ValidateNested()
    @Type(() => CreateCommentFieldsDto)
    comment!: CreateCommentFieldsDto;
}
