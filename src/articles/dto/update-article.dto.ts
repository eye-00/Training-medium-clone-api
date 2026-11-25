
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
    @ApiPropertyOptional()
    @Transform(trimString)
    @ValidateIf((_object, value: unknown) => value !== undefined)
    @IsString()
    @MinLength(1)
    @MaxLength(255)
    title?: string;

    @ApiPropertyOptional()
    @Transform(trimString)
    @ValidateIf((_object, value: unknown) => value !== undefined)
    @IsString()
    @MinLength(1)
    @MaxLength(1000)
    description?: string;

    @ApiPropertyOptional()
    @Transform(trimString)
    @ValidateIf((_object, value: unknown) => value !== undefined)
    @IsString()
    @MinLength(1)
    @MaxLength(100000)
    body?: string;

    @ApiPropertyOptional({ type: [String] })
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
