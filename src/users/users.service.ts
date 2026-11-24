import {
    BadRequestException,
    ConflictException,
    Injectable,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { hash } from 'bcryptjs';
import { QueryFailedError, type Repository } from 'typeorm';

import { User } from './entities/user.entity.js';
import { RegisterUserDto } from './dto/register-user.dto.js';
import { RegisterResponseDto } from './dto/register-response.dto.js';
import { PublicUserDto } from './dto/register-response.dto.js';

@Injectable()
export class UsersService {
    constructor(
        @InjectRepository(User)
        private readonly usersRepository: Repository<User>,
    ) { }
    async register(
        dto: RegisterUserDto,
    ): Promise<RegisterResponseDto> {
        const email = dto.email.trim().toLowerCase();
        const username = dto.username.trim();
        if (Buffer.byteLength(dto.password, 'utf8') > 72) {
            throw new BadRequestException('Password must not exceed 72 bytes');
        }
        if (username.length < 3 || username.length > 100) {
            throw new BadRequestException('Username must be between 3 and 100 characters');
        }
        const passwordHash = await hash(dto.password, 12);
        const user = this.usersRepository.create({
            id: randomUUID(),
            email,
            username,
            passwordHash,
            bio: null,
            image: null,
        });
        try {
            await this.usersRepository.insert(user);
        } catch (error: unknown) {
            if (error instanceof QueryFailedError) {
                const driverError = error.driverError as {
                    code?: string;
                };
                if (driverError.code === 'ER_DUP_ENTRY') {
                    throw new ConflictException('Email or username already exists');
                }
            }
            throw error;
        }
        return {
            user: {
                id: user.id,
                email: user.email,
                username: user.username,
                bio: user.bio,
                image: user.image,
            }
        }
    };
    async findByEmailForAuth(email: string): Promise<User | null> {
        return this.usersRepository
            .createQueryBuilder('user')
            .addSelect('user.passwordHash')
            .where('user.email = :email', { email: email.trim().toLowerCase() })
            .getOne();
    }

    async findPublicById(id: string): Promise<PublicUserDto | null> {
        const user = await this.usersRepository.findOneBy({ id });

        if (!user) {
            return null;
        }

        return {
            id: user.id,
            email: user.email,
            username: user.username,
            bio: user.bio,
            image: user.image,
        };
    }

}
