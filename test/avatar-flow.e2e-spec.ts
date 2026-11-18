
import {
    type INestApplication,
    ValidationPipe,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import sharp from 'sharp';
import { DataSource } from 'typeorm';
import {
    afterAll,
    beforeAll,
    describe,
    expect,
    it,
} from 'vitest';

import { Attachment } from '../src/attachments/entities/attachment.entity.js';
import { AvatarStorageService } from '../src/attachments/avatar-storage.service.js';
import { User } from '../src/users/entities/user.entity.js';

describe('Avatar E2E', () => {
    let app: INestApplication | undefined;
    let databaseVerified = false;
    let createdUserId: string | undefined;

    const trackedStorageKeys = new Set<string>();

    const suffix = randomUUID().replaceAll('-', '').slice(0, 16);
    const email = `e2e-avatar-${suffix}@example.com`;
    const username = `avatar_${suffix}`;
    const password = 'ExamplePass123!';

    beforeAll(async () => {
        const env = process.env;

        if (
            env.NODE_ENV !== 'test' ||
            env.DB_HOST !== '127.0.0.1' ||
            env.DB_PORT !== '3307' ||
            env.DB_DATABASE !== 'medium_clone_test' ||
            env.DB_USERNAME !== 'medium_test_user' ||
            env.REDIS_URL !== 'redis://127.0.0.1:6380' ||
            !env.DB_TEST_SERVER_UUID
        ) {
            throw new Error('Unsafe E2E environment');
        }

        const { AppModule } = await import(
            '../src/app.module.js'
        );

        const moduleRef = await Test.createTestingModule({
            imports: [AppModule],
        }).compile();

        app = moduleRef.createNestApplication();

        app.setGlobalPrefix('api');

        app.useGlobalPipes(
            new ValidationPipe({
                whitelist: true,
                forbidNonWhitelisted: true,
                transform: true,
            }),
        );

        await app.init();

        const rows = (await app.get(DataSource).query(`
      SELECT
        DATABASE() AS db,
        CURRENT_USER() AS dbUser,
        @@server_uuid AS serverUuid
    `)) as Array<{
            db: string;
            dbUser: string;
            serverUuid: string;
        }>;

        const identity = rows[0];

        if (
            identity?.db !== 'medium_clone_test' ||
            !identity.dbUser.startsWith('medium_test_user@') ||
            identity.serverUuid !== env.DB_TEST_SERVER_UUID
        ) {
            throw new Error(
                'E2E database identity verification failed',
            );
        }

        databaseVerified = true;
    }, 25000);

    afterAll(async () => {
        if (!app) return;

        try {
            if (databaseVerified && createdUserId) {
                const dataSource = app.get(DataSource);
                const attachmentsRepository =
                    dataSource.getRepository(Attachment);

                // Only inspect attachments owned by this test user.
                const remainingAttachments =
                    await attachmentsRepository.find({
                        where: {
                            ownerType: 'user',
                            ownerId: createdUserId,
                            kind: 'avatar',
                        },
                    });

                for (const attachment of remainingAttachments) {
                    trackedStorageKeys.add(attachment.storageKey);
                }

                await attachmentsRepository.delete({
                    ownerType: 'user',
                    ownerId: createdUserId,
                    kind: 'avatar',
                });

                await dataSource.getRepository(User).delete({
                    id: createdUserId,
                    email,
                });

                const storage = app.get(AvatarStorageService);

                // Never delete the entire uploads directory.
                for (const key of trackedStorageKeys) {
                    await storage.deleteAvatar(key);
                }
            }
        } finally {
            await app.close();
        }
    }, 20000);

    it('validates the complete avatar lifecycle', async () => {
        if (!app || !databaseVerified) {
            throw new Error('Test application is not ready');
        }

        const server = app.getHttpServer();
        const dataSource = app.get(DataSource);
        const storage = app.get(AvatarStorageService);
        const attachmentsRepository =
            dataSource.getRepository(Attachment);

        // Register a dedicated test user.
        const registration = await request(server)
            .post('/api/users')
            .send({
                email,
                username,
                password,
            })
            .expect(201);

        const userId = registration.body.user.id as string;
        createdUserId = userId;

        const login = await request(server)
            .post('/api/users/login')
            .send({ email, password })
            .expect(200);

        const token = login.body.accessToken as string;
        const authorization = `Bearer ${token}`;

        const avatarUrl = '/api/user/avatar';

        // 1. Upload and delete require authentication.
        await request(server)
            .post(avatarUrl)
            .attach('file', Buffer.from('test'), 'test.png')
            .expect(401);

        await request(server)
            .delete(avatarUrl)
            .expect(401);

        // 2. Missing file.
        await request(server)
            .post(avatarUrl)
            .set('Authorization', authorization)
            .expect(400);

        // 3. Fake image content.
        await request(server)
            .post(avatarUrl)
            .set('Authorization', authorization)
            .attach(
                'file',
                Buffer.from('not a real PNG'),
                'fake.png',
            )
            .expect(400);

        // 4. File larger than 2 MB.
        await request(server)
            .post(avatarUrl)
            .set('Authorization', authorization)
            .attach(
                'file',
                Buffer.alloc(2 * 1024 * 1024 + 1),
                'oversized.png',
            )
            .expect(413);

        // 5. Upload a real PNG image.
        const firstImage = await sharp({
            create: {
                width: 800,
                height: 600,
                channels: 3,
                background: {
                    r: 60,
                    g: 130,
                    b: 200,
                },
            },
        })
            .png()
            .toBuffer();

        const firstUpload = await request(server)
            .post(avatarUrl)
            .set('Authorization', authorization)
            .attach('file', firstImage, 'first-avatar.png')
            .expect(201);

        const firstImageUrl =
            firstUpload.body.image as string;

        const firstAttachmentId =
            /^\/api\/avatars\/([0-9a-f-]{36})$/i.exec(
                firstImageUrl,
            )?.[1];

        if (!firstAttachmentId) {
            throw new Error('Invalid uploaded avatar URL');
        }

        const firstAttachment =
            await attachmentsRepository.findOneByOrFail({
                id: firstAttachmentId,
            });

        trackedStorageKeys.add(firstAttachment.storageKey);

        expect(firstAttachment).toMatchObject({
            ownerType: 'user',
            ownerId: userId,
            kind: 'avatar',
            originalName: 'first-avatar.png',
            mimeType: 'image/webp',
            visibility: 'public',
        });

        expect(firstAttachment.sizeBytes).toBeGreaterThan(0);

        // 6. Read public image without JWT.
        const publicImage = await request(server)
            .get(firstImageUrl)
            .buffer(true)
            .expect('Content-Type', /image\/webp/)
            .expect(200);

        expect(Buffer.isBuffer(publicImage.body)).toBe(true);

        const imageMetadata = await sharp(
            publicImage.body as Buffer,
        ).metadata();

        expect(imageMetadata.format).toBe('webp');
        expect(imageMetadata.width).toBe(512);
        expect(imageMetadata.height).toBe(512);

        // 7. Verify both user and public profile responses.
        const currentUser = await request(server)
            .get('/api/user')
            .set('Authorization', authorization)
            .expect(200);

        expect(currentUser.body.user.image).toBe(
            firstImageUrl,
        );

        const publicProfile = await request(server)
            .get(`/api/profiles/${username}`)
            .expect(200);

        expect(publicProfile.body.profile.image).toBe(
            firstImageUrl,
        );

        // 8. Upload a replacement JPEG image.
        const secondImage = await sharp({
            create: {
                width: 900,
                height: 700,
                channels: 3,
                background: {
                    r: 210,
                    g: 90,
                    b: 70,
                },
            },
        })
            .jpeg()
            .toBuffer();

        const replacement = await request(server)
            .post(avatarUrl)
            .set('Authorization', authorization)
            .attach('file', secondImage, 'second-avatar.jpg')
            .expect(201);

        const secondImageUrl =
            replacement.body.image as string;

        expect(secondImageUrl).not.toBe(firstImageUrl);

        const secondAttachmentId =
            /^\/api\/avatars\/([0-9a-f-]{36})$/i.exec(
                secondImageUrl,
            )?.[1];

        if (!secondAttachmentId) {
            throw new Error('Invalid replacement avatar URL');
        }

        const secondAttachment =
            await attachmentsRepository.findOneByOrFail({
                id: secondAttachmentId,
            });

        trackedStorageKeys.add(secondAttachment.storageKey);

        // Old attachment and file must be removed.
        expect(
            await attachmentsRepository.findOneBy({
                id: firstAttachmentId,
            }),
        ).toBeNull();

        expect(
            await storage.readAvatar(firstAttachment.storageKey),
        ).toBeNull();

        await request(server)
            .get(firstImageUrl)
            .expect(404);

        await request(server)
            .get(secondImageUrl)
            .expect('Content-Type', /image\/webp/)
            .expect(200);

        // Exactly one current avatar attachment.
        const countAttachments = () =>
            attachmentsRepository.count({
                where: {
                    ownerType: 'user',
                    ownerId: userId,
                    kind: 'avatar',
                },
            });

        expect(await countAttachments()).toBe(1);

        // 9. Delete current avatar.
        await request(server)
            .delete(avatarUrl)
            .set('Authorization', authorization)
            .expect(204);

        expect(await countAttachments()).toBe(0);

        expect(
            await storage.readAvatar(secondAttachment.storageKey),
        ).toBeNull();

        await request(server)
            .get(secondImageUrl)
            .expect(404);

        // 10. Repeated DELETE must remain successful.
        await request(server)
            .delete(avatarUrl)
            .set('Authorization', authorization)
            .expect(204);

        // 11. Verify persisted user state.
        const updatedUser =
            await dataSource.getRepository(User).findOneByOrFail({
                id: userId,
            });

        expect(updatedUser.image).toBeNull();

        const finalProfile = await request(server)
            .get(`/api/profiles/${username}`)
            .expect(200);

        expect(finalProfile.body.profile.image).toBeNull();

        // 12. Unknown avatar must return 404.
        await request(server)
            .get(`/api/avatars/${randomUUID()}`)
            .expect(404);

        await request(server)
            .get('/api/avatars/invalid-id')
            .expect(404);
    }, 40000);
});
