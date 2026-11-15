
import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { hash } from 'bcryptjs';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import type { User } from '../users/entities/user.entity.js';
import { UsersService } from '../users/users.service.js';
import { AuthService } from './auth.service.js';

const validDto = {
    email: 'test@example.com',
    password: 'ExamplePass123!',
};

let storedUser: User;

beforeAll(async () => {
    storedUser = {
        id: '308fac1d-401f-4a06-b2bd-32dd50234048',
        email: 'test@example.com',
        username: 'test_user',
        passwordHash: await hash(validDto.password, 4),
        bio: null,
        image: null,
    } as User;
});

function createTestContext() {
    const findByEmailForAuth = vi.fn().mockResolvedValue(storedUser);
    const signAsync = vi.fn().mockResolvedValue('signed.jwt.token');

    const usersService = {
        findByEmailForAuth,
    } as unknown as UsersService;

    const jwtService = {
        signAsync,
    } as unknown as JwtService;

    const service = new AuthService(jwtService, usersService);

    return {
        service,
        findByEmailForAuth,
        signAsync,
    };
}

describe('AuthService.login', () => {
    it('returns user and signed JWT for valid credentials', async () => {
        const { service, findByEmailForAuth, signAsync } =
            createTestContext();

        const result = await service.login({
            email: ' TEST@example.com ',
            password: validDto.password,
        });

        expect(findByEmailForAuth).toHaveBeenCalledWith(
            'test@example.com',
        );

        expect(result.accessToken).toBe('signed.jwt.token');
        expect(result.user.id).toBe(storedUser.id);
        expect(result.user.email).toBe(storedUser.email);
        expect(result.user).not.toHaveProperty('passwordHash');

        expect(signAsync).toHaveBeenCalledOnce();

        const payload = signAsync.mock.calls[0][0] as {
            sub: string;
            jti: string;
        };

        expect(payload.sub).toBe(storedUser.id);
        expect(payload.jti).toMatch(
            /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
        );
    });

    it('rejects incorrect password', async () => {
        const { service, signAsync } = createTestContext();

        await expect(
            service.login({
                ...validDto,
                password: 'WrongPassword123!',
            }),
        ).rejects.toBeInstanceOf(UnauthorizedException);

        expect(signAsync).not.toHaveBeenCalled();
    });

    it('rejects unknown email with the same error message', async () => {
        const { service, findByEmailForAuth, signAsync } =
            createTestContext();

        findByEmailForAuth.mockResolvedValue(null);

        await expect(
            service.login(validDto),
        ).rejects.toMatchObject({
            message: 'Invalid email or password',
        });

        expect(signAsync).not.toHaveBeenCalled();
    });

    it('rejects passwords exceeding 72 UTF-8 bytes', async () => {
        const { service, findByEmailForAuth, signAsync } =
            createTestContext();

        await expect(
            service.login({
                ...validDto,
                password: '🔐'.repeat(19),
            }),
        ).rejects.toBeInstanceOf(UnauthorizedException);

        expect(findByEmailForAuth).not.toHaveBeenCalled();
        expect(signAsync).not.toHaveBeenCalled();
    });

    it('generates a different jti for each login', async () => {
        const { service, signAsync } = createTestContext();

        await service.login(validDto);
        await service.login(validDto);

        const firstPayload = signAsync.mock.calls[0][0] as {
            jti: string;
        };

        const secondPayload = signAsync.mock.calls[1][0] as {
            jti: string;
        };

        expect(firstPayload.jti).not.toBe(secondPayload.jti);
    });
});
