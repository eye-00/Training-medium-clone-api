import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { compare, hash } from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import { UsersService } from '../users/users.service.js';
import { LoginResponseDto } from './dto/login-response.dto.js';
import { LoginUserDto } from './dto/login-user.dto.js';
import { toAvatarUrl } from '../attachments/avatar-url.js';

@Injectable()
export class AuthService {
    private readonly dummyHashPromise = hash(randomUUID(), 12);

    constructor(
        private readonly jwtService: JwtService,
        private readonly usersService: UsersService,
    ) { }

    async login(dto: LoginUserDto): Promise<LoginResponseDto> {
        const email = dto.email.trim().toLowerCase();
        if (Buffer.byteLength(dto.password, 'utf8') > 72) {
            throw new UnauthorizedException(
                'Invalid email or password',
            );
        }
        const user = await this.usersService.findByEmailForAuth(email);
        const passwordHash = user?.passwordHash ?? await this.dummyHashPromise;
        const passwordMatches = await compare(dto.password, passwordHash);
        if (!user || !passwordMatches) {
            throw new UnauthorizedException(
                'Invalid email or password',
            );
        }
        const accessToken = this.jwtService.signAsync({
            sub: user.id,
            jti: randomUUID(),
        });
        return {
            user: {
                id: user.id,
                email: user.email,
                username: user.username,
                bio: user.bio,
                image: toAvatarUrl(user.image),
            },
            accessToken: await accessToken,
        }
    }


}