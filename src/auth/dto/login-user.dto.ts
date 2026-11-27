import {Transform, type TransformFnParams} from 'class-transformer';
import {IsEmail, IsNotEmpty, IsString, MaxLength} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class LoginUserDto {
    @ApiProperty({ description: 'Trimmed and converted to lowercase before email validation; the normalized value is limited to 255 characters.' })
    @Transform(({ value }: TransformFnParams) =>
        typeof value === 'string'
    ? value.trim().toLowerCase()
    : value,
    )
    @IsEmail()
    @MaxLength(255)
    email!: string;
    @ApiProperty({ minLength: 1, writeOnly: true, description: 'Passwords over 72 UTF-8 bytes are rejected as invalid credentials.' })
    @IsString()
    @IsNotEmpty()
    password!: string;
}
