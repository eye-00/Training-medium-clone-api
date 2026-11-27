
import { Transform, Type } from 'class-transformer';
import {
    ArrayMaxSize,
    IsArray,
    IsDefined,
    IsObject,
    IsString,
    MaxLength,
    MinLength,
    ValidateIf,
    ValidateNested,
} from 'class-validator';
import {
    ApiProperty,
    ApiPropertyOptional,
} from '@nestjs/swagger';

const trimString = ({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value;

export class UpdateArticleFieldsDto {
    @ApiPropertyOptional({ description: 'After trimming, 1–255 characters and at most 255 Unicode code points.' })
    @Transform(trimString)
    @ValidateIf((_object, value: unknown) => value !== undefined)
    @IsString()
    @MinLength(1)
    @MaxLength(255)
    title?: string;

    @ApiPropertyOptional({ description: 'After trimming, 1–1000 characters.' })
    @Transform(trimString)
    @ValidateIf((_object, value: unknown) => value !== undefined)
    @IsString()
    @MinLength(1)
    @MaxLength(1000)
    description?: string;

    @ApiPropertyOptional({ description: 'After trimming, 1–100000 characters.' })
    @Transform(trimString)
    @ValidateIf((_object, value: unknown) => value !== undefined)
    @IsString()
    @MinLength(1)
    @MaxLength(100000)
    body?: string;

    @ApiPropertyOptional({
        type: 'array', maxItems: 10, items: { type: 'string' },
        description: 'Each tag must be 1–100 characters after trimming. Tags are lowercased and deduplicated; each normalized tag must contain at most 100 Unicode code points. An empty array removes all tags.',
    })
    @Transform(({ value }: { value: unknown }) =>
        Array.isArray(value)
            ? value.map((item: unknown) =>
                typeof item === 'string' ? item.trim() : item,
            )
            : value,
    )
    @ValidateIf((_object, value: unknown) => value !== undefined)
    @IsArray()
    @ArrayMaxSize(10)
    @IsString({ each: true })
    @MinLength(1, { each: true })
    @MaxLength(100, { each: true })
    tagList?: string[];
}

export class UpdateArticleDto {
    @ApiProperty({ type: () => UpdateArticleFieldsDto })
    @IsDefined()
    @IsObject()
    @ValidateNested()
    @Type(() => UpdateArticleFieldsDto)
    article!: UpdateArticleFieldsDto;
}
