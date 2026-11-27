import { Transform, type TransformFnParams } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import {
    IsEmail,
    IsString,
    MaxLength,
    MinLength,
} from 'class-validator';

export class RegisterUserDto {
    @ApiProperty({ description: 'Trimmed and converted to lowercase before email validation; the normalized value is limited to 255 characters.' })
    @Transform(({ value }: TransformFnParams) =>
        typeof value === 'string'
            ? value.trim().toLowerCase()
            : value,
    )
    @IsEmail()
    @MaxLength(255)
    email!: string;


    @ApiProperty({ description: 'After trimming, must satisfy the 3–100 character validator and contain at most 100 Unicode code points.' })
    @Transform(({ value }: TransformFnParams) =>
        typeof value === 'string'
            ? value.trim()
            : value,
    )
    @IsString()
    @MinLength(3)
    @MaxLength(100)
    username!: string;

    @ApiProperty({ minLength: 8, maxLength: 72, writeOnly: true, description: 'Must also be at most 72 UTF-8 bytes.' })
    @IsString()
    @MinLength(8)
    @MaxLength(72)
    password!: string;
}
