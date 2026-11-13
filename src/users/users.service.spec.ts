import { BadRequestException, ConflictException, } from '@nestjs/common';
import { compare } from 'bcryptjs';
import { User } from './entities/user.entity.js';
import { QueryFailedError, type Repository } from 'typeorm';
import { UsersService } from './users.service.js';

function createTestContext() {
    const insert = vi.fn().mockResolvedValue(undefined);
    const create = vi.fn((data: Partial<User>) => data as User);

    const repository = {
        create,
        insert,
    } as unknown as Repository<User>;
    return {
        service: new UsersService(repository),
        create,
        insert,
    };
}

const validDto = {
    email: 'Test@example.com',
    username: 'test_user',
    password: 'ExamplePassword00!',
}

describe('UsersService.register', () => {
    it('creates a user with normalized email and hashed password', async () => {
        const { service, create, insert } = createTestContext();
        const result = await service.register(validDto);
        expect(insert).toHaveBeenCalledOnce();
        const savedUser = create.mock.calls[0][0];
        expect(savedUser.id).toEqual(expect.any(String));
        expect(savedUser.email).toBe('test@example.com');
        expect(savedUser.username).toBe('test_user');

        expect(savedUser.passwordHash).not.toBe(validDto.password);
        expect(
            await compare(
                validDto.password,
                savedUser.passwordHash!,
            ),
        ).toBe(true);

        expect(result.user.email).toBe('test@example.com');
        expect(result.user.username).toBe('test_user');
        expect(result.user).not.toHaveProperty('passwordHash');
    });
    it('rejects passwords longer than 72 UTF-8 bytes', async () => {
        const { service, insert } = createTestContext();

        await expect(
            service.register({
                ...validDto,
                password: '🔐'.repeat(19), // ký tự ổ khoá chiếm 4 Byte UTF-8, 19 × 4 = 76 byte > 72 byte
            }),
        ).rejects.toBeInstanceOf(BadRequestException);

        expect(insert).not.toHaveBeenCalled();
    });

    it('returns ConflictException for duplicate database keys', async () => {
        const { service, insert } = createTestContext();

        const driverError = Object.assign(
            new Error('Duplicate entry'),
            { code: 'ER_DUP_ENTRY' },
        );

        insert.mockRejectedValue(
            new QueryFailedError(
                'INSERT INTO users ...',
                [],
                driverError,
            ),
        );

        await expect(
            service.register(validDto),
        ).rejects.toBeInstanceOf(ConflictException);
    });

    it('does not hide unrelated database errors', async () => {
        const { service, insert } = createTestContext();

        const databaseError = new Error('Database unavailable');

        insert.mockRejectedValue(databaseError);

        await expect(
            service.register(validDto),
        ).rejects.toBe(databaseError);
    });
});