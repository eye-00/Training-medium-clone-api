import { NotFoundException } from '@nestjs/common';
import type { Repository } from 'typeorm';
import {
    describe,
    expect,
    it,
    vi,
} from 'vitest';

import { User } from '../users/entities/user.entity.js';
import { Follow } from './entities/follow.entity.js';
import { ProfilesService } from './profiles.service.js';

function createTestContext() {
    const findOne = vi.fn().mockResolvedValue(null);
    const count = vi.fn().mockResolvedValue(0);

    const usersRepository = {
        findOne,
    } as unknown as Repository<User>;

    const followsRepository = {
        count,
    } as unknown as Repository<Follow>;

    return {
        service: new ProfilesService(
            usersRepository,
            followsRepository,
        ),
        findOne,
        count,
    };
}

function createTestUser(): User {
    const user = new User();

    user.id = '11111111-1111-4111-8111-111111111111';
    user.email = 'private@example.com';
    user.username = 'test_profile';
    user.bio = 'Learning NestJS';
    user.image = null;
    user.passwordHash = 'private-password-hash';
    user.createdAt = new Date();
    user.updatedAt = new Date();

    return user;
}

describe('ProfilesService.getProfile', () => {
    it('returns public profile with follower counts', async () => {
        const { service, findOne, count } =
            createTestContext();

        const user = createTestUser();

        findOne.mockResolvedValue(user);

        count
            .mockResolvedValueOnce(3)
            .mockResolvedValueOnce(5);

        const result = await service.getProfile(
            'test_profile',
        );

        expect(findOne).toHaveBeenCalledWith({
            where: { username: 'test_profile' },
        });

        expect(count).toHaveBeenNthCalledWith(1, {
            where: { followedId: user.id },
        });

        expect(count).toHaveBeenNthCalledWith(2, {
            where: { followerId: user.id },
        });

        expect(result).toEqual({
            profile: {
                username: 'test_profile',
                bio: 'Learning NestJS',
                image: null,
                followersCount: 3,
                followingCount: 5,
            },
        });

        expect(result.profile).not.toHaveProperty('email');
        expect(result.profile).not.toHaveProperty('id');
        expect(result.profile).not.toHaveProperty(
            'passwordHash',
        );
    });

    it('returns zero counts for a user without follows', async () => {
        const { service, findOne } =
            createTestContext();

        findOne.mockResolvedValue(createTestUser());

        const result = await service.getProfile(
            'test_profile',
        );

        expect(result.profile.followersCount).toBe(0);
        expect(result.profile.followingCount).toBe(0);
    });

    it('returns 404 when profile does not exist', async () => {
        const { service, count } =
            createTestContext();

        await expect(
            service.getProfile('unknown_user'),
        ).rejects.toBeInstanceOf(NotFoundException);

        expect(count).not.toHaveBeenCalled();
    });

    it('does not hide database errors', async () => {
        const { service, findOne, count } =
            createTestContext();

        findOne.mockResolvedValue(createTestUser());

        const databaseError = new Error(
            'Database unavailable',
        );

        count.mockRejectedValue(databaseError);

        await expect(
            service.getProfile('test_profile'),
        ).rejects.toBe(databaseError);
    });
});
