
import { Transform } from 'class-transformer';
import {
    IsInt,
    IsString,
    Max,
    MaxLength,
    Min,
    MinLength,
    ValidateIf,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

const trimString = ({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value;

const parseInteger = ({ value }: { value: unknown }) =>
    typeof value === 'string' && /^\d+$/.test(value)
        ? Number(value)
        : value;

export class ListArticlesQueryDto {
    @ApiPropertyOptional({ example: 'nestjs', description: 'After trimming, 1–100 characters.' })
    @Transform(trimString)
    @ValidateIf((_object, value: unknown) => value !== undefined)
    @IsString()
    @MinLength(1)
    @MaxLength(100)
    tag?: string;

    @ApiPropertyOptional({ example: 'developer', description: 'After trimming, 1–100 characters.' })
    @Transform(trimString)
    @ValidateIf((_object, value: unknown) => value !== undefined)
    @IsString()
    @MinLength(1)
    @MaxLength(100)
    author?: string;

    @ApiPropertyOptional({ example: 'developer', description: 'After trimming, 1–100 characters.' })
    @Transform(trimString)
    @ValidateIf((_object, value: unknown) => value !== undefined)
    @IsString()
    @MinLength(1)
    @MaxLength(100)
    favorited?: string;

    @ApiPropertyOptional({
        default: 20,
        minimum: 1,
        maximum: 100,
    })
    @Transform(parseInteger)
    @IsInt()
    @Min(1)
    @Max(100)
    limit: number = 20;

    @ApiPropertyOptional({
        default: 0,
        minimum: 0,
        maximum: 100000,
    })
    @Transform(parseInteger)
    @IsInt()
    @Min(0)
    @Max(100000)
    offset: number = 0;
}
