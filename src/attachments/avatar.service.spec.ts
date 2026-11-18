import { NotFoundException } from '@nestjs/common';
import type { DataSource, EntityManager } from 'typeorm';
import { describe, expect, it, vi } from 'vitest';

import { User } from '../users/entities/user.entity.js';
import { Attachment } from './entities/attachment.entity.js';
import { AvatarStorageService } from './avatar-storage.service.js';
import { AvatarService } from './avatar.service.js';

const USER_ID = '11111111-1111-4111-8111-111111111111';

const NEW_KEY =
    'avatars/22222222-2222-4222-8222-222222222222.webp';

const OLD_ID = '33333333-3333-4333-8333-333333333333';

const OLD_KEY =
    'avatars/44444444-4444-4444-8444-444444444444.webp';

const file = {
    buffer: Buffer.from('mock-image-content'),
    originalname: 'avatar.png',
};

function createTestContext() {
    const user = new User();
    user.id = USER_ID;
    user.image = null;

    const getOne = vi.fn().mockResolvedValue(user);

    const queryBuilder = {
        setLock: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        getOne,
    };

    const userUpdate = vi.fn().mockResolvedValue({
        affected: 1,
    });

    const usersRepository = {
        createQueryBuilder: vi.fn().mockReturnValue(
            queryBuilder,
        ),
        update: userUpdate,
    };

    const attachmentFind = vi.fn().mockResolvedValue(null);
    const attachmentInsert = vi.fn().mockResolvedValue(
        undefined,
    );
    const attachmentDelete = vi.fn().mockResolvedValue({
        affected: 1,
    });

    const attachmentsRepository = {
        findOneBy: attachmentFind,
        insert: attachmentInsert,
        delete: attachmentDelete,
    };

    const getRepository = vi.fn((entity: unknown) => {
        if (entity === User) {
            return usersRepository;
        }

        if (entity === Attachment) {
            return attachmentsRepository;
        }

        throw new Error('Unexpected entity');
    });

    const manager = {
        getRepository,
    } as unknown as EntityManager;

    const transaction = vi.fn(
        async (
            callback: (
                manager: EntityManager,
            ) => Promise<unknown>,
        ) => callback(manager),
    );

    const dataSource = {
        transaction,
        getRepository,
    } as unknown as DataSource;

    const saveAvatar = vi.fn().mockResolvedValue({
        storageKey: NEW_KEY,
        mimeType: 'image/webp',
        sizeBytes: 1024,
    });

    const deleteAvatar = vi.fn().mockResolvedValue(
        undefined,
    );

    const readAvatar = vi.fn().mockResolvedValue(null);

    const storage = {
        saveAvatar,
        readAvatar,
        deleteAvatar,
    } as unknown as AvatarStorageService;

    return {
        service: new AvatarService(
            dataSource,
            storage,
        ),
        user,
        manager,
        transaction,
        saveAvatar,
        deleteAvatar,
        getOne,
        queryBuilder,
        userUpdate,
        attachmentFind,
        attachmentInsert,
        attachmentDelete,
        readAvatar,
    };
}

describe('AvatarService.uploadAvatar', () => {
    it('creates attachment and updates user image', async () => {
        const context = createTestContext();

        const result = await context.service.uploadAvatar(
            USER_ID,
            file,
        );

        expect(context.saveAvatar).toHaveBeenCalledWith(
            file.buffer,
        );

        expect(context.transaction).toHaveBeenCalledOnce();

        expect(
            context.queryBuilder.setLock,
        ).toHaveBeenCalledWith('pessimistic_write');

        expect(
            context.queryBuilder.where,
        ).toHaveBeenCalledWith(
            'user.id = :userId',
            { userId: USER_ID },
        );

        expect(
            context.attachmentInsert,
        ).toHaveBeenCalledWith(
            expect.objectContaining({
                id: expect.any(String),
                ownerType: 'user',
                ownerId: USER_ID,
                kind: 'avatar',
                originalName: 'avatar.png',
                storageKey: NEW_KEY,
                mimeType: 'image/webp',
                sizeBytes: 1024,
                visibility: 'public',
            }),
        );

        expect(result.image).toMatch(
            /^\/api\/avatars\/[0-9a-f-]{36}$/,
        );

        expect(
            context.userUpdate,
        ).toHaveBeenCalledWith(
            { id: USER_ID },
            { image: result.image },
        );

        expect(
            context.deleteAvatar,
        ).not.toHaveBeenCalled();
    });

    it('replaces old avatar and deletes old file after commit', async () => {
        const context = createTestContext();

        context.user.image = `/api/avatars/${OLD_ID}`;

        context.attachmentFind.mockResolvedValue({
            id: OLD_ID,
            ownerType: 'user',
            ownerId: USER_ID,
            kind: 'avatar',
            storageKey: OLD_KEY,
        });

        const events: string[] = [];

        context.transaction.mockImplementation(
            async (
                callback: (
                    manager: EntityManager,
                ) => Promise<unknown>,
            ) => {
                const result = await callback(context.manager);

                events.push('committed');

                return result;
            },
        );

        context.deleteAvatar.mockImplementation(
            async (key: string) => {
                events.push(`deleted:${key}`);
            },
        );

        await context.service.uploadAvatar(
            USER_ID,
            file,
        );

        expect(
            context.attachmentFind,
        ).toHaveBeenCalledWith({
            id: OLD_ID,
            ownerType: 'user',
            ownerId: USER_ID,
            kind: 'avatar',
        });

        expect(
            context.attachmentDelete,
        ).toHaveBeenCalledWith({
            id: OLD_ID,
        });

        expect(events).toEqual([
            'committed',
            `deleted:${OLD_KEY}`,
        ]);
    });

    it('returns 404 and cleans new file if user is missing', async () => {
        const context = createTestContext();

        context.getOne.mockResolvedValue(null);

        await expect(
            context.service.uploadAvatar(USER_ID, file),
        ).rejects.toBeInstanceOf(NotFoundException);

        expect(
            context.attachmentInsert,
        ).not.toHaveBeenCalled();

        expect(
            context.userUpdate,
        ).not.toHaveBeenCalled();

        expect(
            context.deleteAvatar,
        ).toHaveBeenCalledWith(NEW_KEY);
    });

    it('cleans new file if attachment INSERT fails', async () => {
        const context = createTestContext();

        const databaseError = new Error(
            'Attachment INSERT failed',
        );

        context.attachmentInsert.mockRejectedValue(
            databaseError,
        );

        await expect(
            context.service.uploadAvatar(USER_ID, file),
        ).rejects.toBe(databaseError);

        expect(
            context.deleteAvatar,
        ).toHaveBeenCalledExactlyOnceWith(NEW_KEY);

        expect(
            context.userUpdate,
        ).not.toHaveBeenCalled();
    });

    it('does not delete old file when user UPDATE fails', async () => {
        const context = createTestContext();

        context.user.image = `/api/avatars/${OLD_ID}`;

        context.attachmentFind.mockResolvedValue({
            id: OLD_ID,
            ownerType: 'user',
            ownerId: USER_ID,
            kind: 'avatar',
            storageKey: OLD_KEY,
        });

        const databaseError = new Error(
            'User UPDATE failed',
        );

        context.userUpdate.mockRejectedValue(
            databaseError,
        );

        await expect(
            context.service.uploadAvatar(USER_ID, file),
        ).rejects.toBe(databaseError);

        expect(
            context.deleteAvatar,
        ).toHaveBeenCalledExactlyOnceWith(NEW_KEY);

        expect(
            context.deleteAvatar,
        ).not.toHaveBeenCalledWith(OLD_KEY);
    });

    it('handles missing previous attachment metadata', async () => {
        const context = createTestContext();

        context.user.image = `/api/avatars/${OLD_ID}`;

        context.attachmentFind.mockResolvedValue(null);

        const result = await context.service.uploadAvatar(
            USER_ID,
            file,
        );

        expect(result.image).toMatch(
            /^\/api\/avatars\/[0-9a-f-]{36}$/,
        );

        expect(
            context.attachmentDelete,
        ).not.toHaveBeenCalled();

        expect(
            context.deleteAvatar,
        ).not.toHaveBeenCalled();
    });

    it('does not start transaction when saving image fails', async () => {
        const context = createTestContext();

        const storageError = new Error(
            'Filesystem unavailable',
        );

        context.saveAvatar.mockRejectedValue(
            storageError,
        );

        await expect(
            context.service.uploadAvatar(USER_ID, file),
        ).rejects.toBe(storageError);

        expect(
            context.transaction,
        ).not.toHaveBeenCalled();

        expect(
            context.attachmentInsert,
        ).not.toHaveBeenCalled();
    });

    it('preserves the database error when cleanup also fails', async () => {
        const context = createTestContext();

        const databaseError = new Error(
            'Database transaction failed',
        );

        context.transaction.mockRejectedValue(databaseError);

        context.deleteAvatar.mockRejectedValue(
            new Error('EACCES: permission denied'),
        );

        await expect(
            context.service.uploadAvatar(USER_ID, {
                buffer: Buffer.from('test-image'),
                originalname: 'avatar.png',
            }),
        ).rejects.toBe(databaseError);

        expect(context.saveAvatar).toHaveBeenCalledTimes(1);

        expect(context.deleteAvatar).toHaveBeenCalledTimes(1);
    });

});

describe('AvatarService.getPublicAvatar', () => {
    it('returns public avatar bytes', async () => {
        const context = createTestContext();
        const image = Buffer.from('test-webp-content');

        context.attachmentFind.mockResolvedValue({
            id: OLD_ID,
            ownerType: 'user',
            kind: 'avatar',
            visibility: 'public',
            storageKey: OLD_KEY,
        });

        context.readAvatar.mockResolvedValue(image);

        const result =
            await context.service.getPublicAvatar(OLD_ID);

        expect(result).toEqual(image);

        expect(context.attachmentFind).toHaveBeenCalledWith({
            id: OLD_ID,
            ownerType: 'user',
            kind: 'avatar',
            visibility: 'public',
        });

        expect(
            context.readAvatar,
        ).toHaveBeenCalledExactlyOnceWith(OLD_KEY);
    });

    it('rejects an invalid attachment ID', async () => {
        const context = createTestContext();

        await expect(
            context.service.getPublicAvatar('../invalid'),
        ).rejects.toBeInstanceOf(NotFoundException);

        expect(
            context.attachmentFind,
        ).not.toHaveBeenCalled();

        expect(
            context.readAvatar,
        ).not.toHaveBeenCalled();
    });

    it('returns 404 when attachment metadata is missing', async () => {
        const context = createTestContext();

        await expect(
            context.service.getPublicAvatar(OLD_ID),
        ).rejects.toBeInstanceOf(NotFoundException);

        expect(
            context.readAvatar,
        ).not.toHaveBeenCalled();
    });

    it('returns 404 when the physical file is missing', async () => {
        const context = createTestContext();

        context.attachmentFind.mockResolvedValue({
            id: OLD_ID,
            storageKey: OLD_KEY,
        });

        context.readAvatar.mockResolvedValue(null);

        await expect(
            context.service.getPublicAvatar(OLD_ID),
        ).rejects.toBeInstanceOf(NotFoundException);

        expect(
            context.readAvatar,
        ).toHaveBeenCalledWith(OLD_KEY);
    });
});

describe('AvatarService.deleteAvatar', () => {
    it('is idempotent when the user has no avatar', async () => {
        const context = createTestContext();

        context.user.image = null;

        await expect(
            context.service.deleteAvatar(USER_ID),
        ).resolves.toBeUndefined();

        expect(
            context.userUpdate,
        ).not.toHaveBeenCalled();

        expect(
            context.attachmentDelete,
        ).not.toHaveBeenCalled();

        expect(
            context.deleteAvatar,
        ).not.toHaveBeenCalled();
    });

    it('deletes the old file only after transaction commit', async () => {
        const context = createTestContext();

        context.user.image = `/api/avatars/${OLD_ID}`;

        context.attachmentFind.mockResolvedValue({
            id: OLD_ID,
            ownerType: 'user',
            ownerId: USER_ID,
            kind: 'avatar',
            storageKey: OLD_KEY,
        });

        const events: string[] = [];

        context.transaction.mockImplementation(
            async (
                callback: (
                    manager: EntityManager,
                ) => Promise<unknown>,
            ) => {
                const result = await callback(context.manager);

                events.push('committed');
                return result;
            },
        );

        context.deleteAvatar.mockImplementation(
            async (key: string) => {
                events.push(`deleted:${key}`);
            },
        );

        await context.service.deleteAvatar(USER_ID);

        expect(
            context.queryBuilder.setLock,
        ).toHaveBeenCalledWith('pessimistic_write');

        expect(
            context.attachmentDelete,
        ).toHaveBeenCalledWith({
            id: OLD_ID,
        });

        expect(
            context.userUpdate,
        ).toHaveBeenCalledWith(
            { id: USER_ID },
            { image: null },
        );

        expect(events).toEqual([
            'committed',
            `deleted:${OLD_KEY}`,
        ]);
    });

    it('returns 404 when user does not exist', async () => {
        const context = createTestContext();

        context.getOne.mockResolvedValue(null);

        await expect(
            context.service.deleteAvatar(USER_ID),
        ).rejects.toBeInstanceOf(NotFoundException);

        expect(
            context.userUpdate,
        ).not.toHaveBeenCalled();

        expect(
            context.deleteAvatar,
        ).not.toHaveBeenCalled();
    });

    it('preserves the file when database update fails', async () => {
        const context = createTestContext();

        context.user.image = `/api/avatars/${OLD_ID}`;

        context.attachmentFind.mockResolvedValue({
            id: OLD_ID,
            storageKey: OLD_KEY,
        });

        const databaseError = new Error(
            'Database update failed',
        );

        context.userUpdate.mockRejectedValue(databaseError);

        await expect(
            context.service.deleteAvatar(USER_ID),
        ).rejects.toBe(databaseError);

        expect(
            context.deleteAvatar,
        ).not.toHaveBeenCalled();
    });

    it('keeps the committed deletion when file cleanup fails', async () => {
        const context = createTestContext();

        context.user.image = `/api/avatars/${OLD_ID}`;

        context.attachmentFind.mockResolvedValue({
            id: OLD_ID,
            ownerType: 'user',
            ownerId: USER_ID,
            kind: 'avatar',
            storageKey: OLD_KEY,
        });

        context.deleteAvatar.mockRejectedValue(
            new Error('EACCES: permission denied'),
        );

        await expect(
            context.service.deleteAvatar(USER_ID),
        ).resolves.toBeUndefined();

        expect(context.attachmentDelete).toHaveBeenCalledWith({
            id: OLD_ID,
        });

        expect(context.userUpdate).toHaveBeenCalledWith(
            { id: USER_ID },
            { image: null },
        );

        expect(context.deleteAvatar).toHaveBeenCalledWith(
            OLD_KEY,
        );
    });

});
