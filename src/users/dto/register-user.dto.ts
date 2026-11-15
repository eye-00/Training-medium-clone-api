import { Transform, type TransformFnParams } from 'class-transformer';
import {
    IsEmail,
    IsString,
    MaxLength,
    MinLength,
} from 'class-validator';

export class RegisterUserDto {
    @Transform(({ value }: TransformFnParams) =>
        typeof value === 'string'
            ? value.trim().toLowerCase()
            : value,
    )
    @IsEmail()
    @MaxLength(255)
    email!: string;


    @Transform(({ value }: TransformFnParams) =>
        typeof value === 'string'
            ? value.trim()
            : value,
    )
    @IsString()
    @MinLength(3)
    @MaxLength(100)
    username!: string;

    @IsString()
    @MinLength(8)
    @MaxLength(72)
    password!: string;
}