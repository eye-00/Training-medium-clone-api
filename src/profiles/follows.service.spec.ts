import {
    BadRequestException,
    ConflictException,
    NotFoundException,
} from '@nestjs/common';
import { QueryFailedError, type Repository } from 'typeorm';
import { describe, expect, it, vi } from 'vitest';

import { User } from '../users/entities/user.entity.js';
import { Follow } from './entities/follow.entity.js';
import { FollowsService } from './follows.service.js';

const followerId = '11111111-1111-4111-8111-111111111111';
const targetId = '22222222-2222-4222-8222-222222222222';
const targetUsername = 'target_user';

function createTestContext() {
    const target = new User();
    target.id = targetId;
    target.username = targetUsername;

    const findOne = vi.fn().mockResolvedValue(target);
    const insert = vi.fn().mockResolvedValue(undefined);
    const deleteFollow = vi.fn().mockResolvedValue({
        affected: 1,
    });

    const usersRepository = {
        findOne,
    } as unknown as Repository<User>;

    const followsRepository = {
        insert,
        delete: deleteFollow,
    } as unknown as Repository<Follow>;

    return {
        service: new FollowsService(
            usersRepository,
            followsRepository,
        ),
        target,
        findOne,
        insert,
        deleteFollow,
    };
}

function createDatabaseError(code: string): QueryFailedError {
    const driverError = Object.assign(
        new Error('Database constraint violation'),
        { code },
    );

    return new QueryFailedError(
        'INSERT INTO follows ...',
        [],
        driverError,
    );
}

describe('FollowsService.follow', () => {
    it('creates a follow relationship', async () => {
        const { service, findOne, insert } =
            createTestContext();

        await expect(
            service.follow(followerId, targetUsername),
        ).resolves.toBeUndefined();

        expect(findOne).toHaveBeenCalledWith({
            where: { username: targetUsername },
        });

        expect(insert).toHaveBeenCalledExactlyOnceWith({
            followerId,
            followedId: targetId,
        });
    });

    it('rejects a nonexistent target', async () => {
        const { service, findOne, insert } =
            createTestContext();

        findOne.mockResolvedValue(null);

        await expect(
            service.follow(followerId, 'unknown_user'),
        ).rejects.toBeInstanceOf(NotFoundException);

        expect(insert).not.toHaveBeenCalled();
    });

    it('rejects self-follow', async () => {
        const { service, target, insert } =
            createTestContext();

        target.id = followerId;

        await expect(
            service.follow(followerId, targetUsername),
        ).rejects.toBeInstanceOf(BadRequestException);

        expect(insert).not.toHaveBeenCalled();
    });

    it('returns conflict for duplicate follow', async () => {
        const { service, insert } =
            createTestContext();

        insert.mockRejectedValue(
            createDatabaseError('ER_DUP_ENTRY'),
        );

        await expect(
            service.follow(followerId, targetUsername),
        ).rejects.toBeInstanceOf(ConflictException);
    });

    it('handles deleted users during insertion', async () => {
        const { service, insert } =
            createTestContext();

        insert.mockRejectedValue(
            createDatabaseError('ER_NO_REFERENCED_ROW_2'),
        );

        await expect(
            service.follow(followerId, targetUsername),
        ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('does not hide unrelated database errors', async () => {
        const { service, insert } =
            createTestContext();

        const databaseError = new Error(
            'Database unavailable',
        );

        insert.mockRejectedValue(databaseError);

        await expect(
            service.follow(followerId, targetUsername),
        ).rejects.toBe(databaseError);
    });
});

describe('FollowsService.unfollow', () => {
    it('deletes an existing follow relationship', async () => {
        const { service, deleteFollow } =
            createTestContext();

        await expect(
            service.unfollow(followerId, targetUsername),
        ).resolves.toBeUndefined();

        expect(deleteFollow).toHaveBeenCalledExactlyOnceWith({
            followerId,
            followedId: targetId,
        });
    });

    it('is idempotent when already unfollowed', async () => {
        const { service, deleteFollow } =
            createTestContext();

        deleteFollow.mockResolvedValue({
            affected: 0,
        });

        await expect(
            service.unfollow(followerId, targetUsername),
        ).resolves.toBeUndefined();

        await expect(
            service.unfollow(followerId, targetUsername),
        ).resolves.toBeUndefined();

        expect(deleteFollow).toHaveBeenCalledTimes(2);
    });

    it('rejects a nonexistent target', async () => {
        const { service, findOne, deleteFollow } =
            createTestContext();

        findOne.mockResolvedValue(null);

        await expect(
            service.unfollow(followerId, 'unknown_user'),
        ).rejects.toBeInstanceOf(NotFoundException);

        expect(deleteFollow).not.toHaveBeenCalled();
    });


    it('treats self-unfollow as a no-op', async () => {
        const { service, target, deleteFollow } =
            createTestContext();

        target.id = followerId;

        await expect(
            service.unfollow(followerId, targetUsername),
        ).resolves.toBeUndefined();

        expect(deleteFollow).not.toHaveBeenCalled();
    });

});
