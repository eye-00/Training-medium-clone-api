import {
    Transform,
    type TransformFnParams,
} from 'class-transformer';

import {
    IsOptional,
    IsString,
    MaxLength,
    MinLength,
    ValidateIf,
} from 'class-validator';

import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateUserDto {
    @ApiPropertyOptional({
        example: 'new_username',
        minLength: 3,
        maxLength: 100,
    })
    @Transform(({ value }: TransformFnParams) =>
        typeof value === 'string'
            ? value.trim()
            : value,
    )
    @ValidateIf((_object, value: unknown) => value !== undefined)
    @IsString()
    @MinLength(3)
    @MaxLength(100)
    username?: string;

    @ApiPropertyOptional({
        example: 'Backend developer learning NestJS',
        nullable: true,
        maxLength: 500,
    })
    @Transform(({ value }: TransformFnParams) =>
        typeof value === 'string'
            ? value.trim()
            : value,
    )
    @IsOptional()
    @IsString()
    @MaxLength(500)
    bio?: string | null;
}
