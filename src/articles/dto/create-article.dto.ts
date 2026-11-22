
import { Type, Transform } from 'class-transformer';
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

export class CreateArticleFieldsDto {
    @ApiProperty({ example: 'Getting started with NestJS' })
    @Transform(trimString)
    @IsString()
    @MinLength(1)
    @MaxLength(255)
    title!: string;

    @ApiProperty({ example: 'A beginner guide' })
    @Transform(trimString)
    @IsString()
    @MinLength(1)
    @MaxLength(1000)
    description!: string;

    @ApiProperty({ example: 'NestJS is a Node.js framework...' })
    @Transform(trimString)
    @IsString()
    @MinLength(1)
    @MaxLength(100000)
    body!: string;

    @ApiPropertyOptional({
        type: [String],
        example: ['nestjs', 'backend'],
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

export class CreateArticleDto {
    @ApiProperty({ type: () => CreateArticleFieldsDto })
    @IsDefined()
    @IsObject()
    @ValidateNested()
    @Type(() => CreateArticleFieldsDto)
    article!: CreateArticleFieldsDto;
}
