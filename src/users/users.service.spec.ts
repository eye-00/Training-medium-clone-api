import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
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

    it.each([
        ['two ASCII characters', 'a'.repeat(2)],
        ['101 ASCII characters', 'a'.repeat(101)],
        ['two emoji', '😀'.repeat(2)],
        ['101 emoji', '😀'.repeat(101)],
        ['two variation sequences', '✈️'.repeat(2)],
        ['51 variation sequences', '✈️'.repeat(51)],
        ['100 variation sequences', '✈️'.repeat(100)],
    ])('rejects username with %s without inserting', async (_label, username) => {
        const { service, insert } = createTestContext();

        await expect(service.register({ ...validDto, username }))
            .rejects.toBeInstanceOf(BadRequestException);
        expect(insert).not.toHaveBeenCalled();
    });

    it.each([
        ['three ASCII characters', 'a'.repeat(3)],
        ['100 ASCII characters', 'a'.repeat(100)],
        ['three emoji', '😀'.repeat(3)],
        ['50 emoji', '😀'.repeat(50)],
        ['51 emoji', '😀'.repeat(51)],
        ['100 emoji', '😀'.repeat(100)],
        ['three variation sequences', '✈️'.repeat(3)],
        ['50 variation sequences', '✈️'.repeat(50)],
    ])('accepts username with %s', async (_label, username) => {
        const { service, insert } = createTestContext();

        const result = await service.register({ ...validDto, username });

        expect(result.user.username).toBe(username);
        expect(insert).toHaveBeenCalledOnce();
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

function createProfileTestContext() {
    const user: User = {
        id: '11111111-1111-4111-8111-111111111111',
        email: 'profile@example.com',
        username: 'original_username',
        bio: 'Old bio',
        image: null,
        passwordHash: 'internal-password-hash',
        createdAt: new Date(),
        updatedAt: new Date(),
    };


    const findOneBy = vi.fn(async (criteria: { id: string }) => {
        return criteria.id === user.id ? user : null;
    });


    const update = vi.fn(
        async (
            _criteria: { id: string },
            changes: Partial<User>,
        ) => {
            Object.assign(user, changes);
            return { affected: 1 };
        },
    );

    const repository = {
        findOneBy,
        update,
    } as unknown as Repository<User>;

    return {
        service: new UsersService(repository),
        user,
        findOneBy,
        update,
    };
}

describe('UsersService.updateProfile', () => {
    it.each([
        ['two emoji', '😀'.repeat(2)],
        ['51 variation sequences', '✈️'.repeat(51)],
        ['100 variation sequences', '✈️'.repeat(100)],
    ])('rejects username with %s without updating', async (_label, username) => {
        const { service, user, update } = createProfileTestContext();

        await expect(service.updateProfile(user.id, { username }))
            .rejects.toBeInstanceOf(BadRequestException);
        expect(update).not.toHaveBeenCalled();
    });

    it.each([
        ['100 emoji', '😀'.repeat(100)],
        ['50 variation sequences', '✈️'.repeat(50)],
    ])('accepts username with %s', async (_label, username) => {
        const { service, user, update } = createProfileTestContext();

        const result = await service.updateProfile(user.id, { username });

        expect(result.username).toBe(username);
        expect(update).toHaveBeenCalledOnce();
    });

    it('updates username without changing bio', async () => {
        const { service, user, update } =
            createProfileTestContext();

        const result = await service.updateProfile(user.id, {
            username: 'new_username',
        });

        expect(update).toHaveBeenCalledWith(
            { id: user.id },
            { username: 'new_username' },
        );

        expect(result.username).toBe('new_username');
        expect(result.bio).toBe('Old bio');
        expect(result).not.toHaveProperty('passwordHash');
    });

    it('updates bio without changing username', async () => {
        const { service, user, update } =
            createProfileTestContext();

        const result = await service.updateProfile(user.id, {
            bio: 'Learning NestJS',
        });

        expect(update).toHaveBeenCalledWith(
            { id: user.id },
            { bio: 'Learning NestJS' },
        );

        expect(result.bio).toBe('Learning NestJS');
        expect(result.username).toBe('original_username');
    });

    it('allows clearing bio with null', async () => {
        const { service, user, update } =
            createProfileTestContext();

        const result = await service.updateProfile(user.id, {
            bio: null,
        });

        expect(update).toHaveBeenCalledWith(
            { id: user.id },
            { bio: null },
        );

        expect(result.bio).toBeNull();
    });

    it('rejects an empty update request', async () => {
        const { service, user, findOneBy, update } =
            createProfileTestContext();

        await expect(
            service.updateProfile(user.id, {}),
        ).rejects.toBeInstanceOf(BadRequestException);

        expect(findOneBy).not.toHaveBeenCalled();
        expect(update).not.toHaveBeenCalled();
    });

    it('returns NotFoundException when user does not exist', async () => {
        const { service, user, findOneBy, update } =
            createProfileTestContext();

        findOneBy.mockResolvedValueOnce(null);

        await expect(
            service.updateProfile(user.id, {
                username: 'new_username',
            }),
        ).rejects.toBeInstanceOf(NotFoundException);

        expect(update).not.toHaveBeenCalled();
    });

    it('returns ConflictException for duplicate username', async () => {
        const { service, user, update } =
            createProfileTestContext();

        const driverError = Object.assign(
            new Error('Duplicate entry'),
            { code: 'ER_DUP_ENTRY' },
        );

        update.mockRejectedValueOnce(
            new QueryFailedError(
                'UPDATE users SET username = ...',
                [],
                driverError,
            ),
        );

        await expect(
            service.updateProfile(user.id, {
                username: 'existing_username',
            }),
        ).rejects.toBeInstanceOf(ConflictException);
    });

    it('does not hide unrelated database errors', async () => {
        const { service, user, update } =
            createProfileTestContext();

        const databaseError = new Error('Database unavailable');

        update.mockRejectedValueOnce(databaseError);

        await expect(
            service.updateProfile(user.id, {
                bio: 'Updated bio',
            }),
        ).rejects.toBe(databaseError);
    });
});
