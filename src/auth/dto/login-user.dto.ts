import {Transform, type TransformFnParams} from 'class-transformer';
import {IsEmail, IsNotEmpty, IsString, MaxLength} from 'class-validator';

export class LoginUserDto {
    @Transform(({ value }: TransformFnParams) =>
        typeof value === 'string'
    ? value.trim().toLowerCase()
    : value,
    )
    @IsEmail()
    @MaxLength(255)
    email!: string;
    @IsString()
    @IsNotEmpty()
    password!: string;
}