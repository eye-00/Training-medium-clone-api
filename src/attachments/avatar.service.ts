import {
    Injectable,
    Logger,
    NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';

import { User } from '../users/entities/user.entity.js';
import { Attachment } from './entities/attachment.entity.js';
import { AvatarStorageService } from './avatar-storage.service.js';
import { isUUID } from 'class-validator';

interface AvatarUploadFile {
    buffer: Buffer;
    originalname: string;
}


interface AvatarUpdateResult {
    attachmentId: string;
    oldStorageKey: string | null;
}

@Injectable()
export class AvatarService {
    private readonly logger = new Logger(
        AvatarService.name,
    );

    constructor(
        private readonly dataSource: DataSource,
        private readonly storage: AvatarStorageService,
    ) { }

    async uploadAvatar(
        userId: string,
        file: AvatarUploadFile,
    ): Promise<{ image: string }> {
        // Step 1: Validate, convert and save the new image.
        const stored = await this.storage.saveAvatar(
            file.buffer,
        );

        let result: AvatarUpdateResult;

        try {
            // Step 2: Update metadata and user image atomically.
            result = await this.dataSource.transaction(
                async (manager): Promise<AvatarUpdateResult> => {
                    const usersRepository =
                        manager.getRepository(User);

                    const attachmentsRepository =
                        manager.getRepository(Attachment);

                    // Lock the user row to serialize avatar changes.
                    const user = await usersRepository
                        .createQueryBuilder('user')
                        .setLock('pessimistic_write')
                        .where('user.id = :userId', { userId })
                        .getOne();

                    if (!user) {
                        throw new NotFoundException(
                            'User not found',
                        );
                    }

                    // Find the previous avatar, if it belongs
                    // to this user and was managed by our API.
                    let oldStorageKey: string | null = null;

                    const oldAttachmentId = user.image;

                    if (oldAttachmentId) {
                        const oldAttachment =
                            await attachmentsRepository.findOneBy({
                                id: oldAttachmentId,
                                ownerType: 'user',
                                ownerId: userId,
                                kind: 'avatar',
                            });

                        if (oldAttachment) {
                            oldStorageKey = oldAttachment.storageKey;

                            await attachmentsRepository.delete({
                                id: oldAttachment.id,
                            });
                        }
                    }

                    // Insert metadata for the new avatar.
                    const attachmentId = randomUUID();

                    const originalName =
                        file.originalname
                            .split(/[\\/]/)
                            .pop()
                            ?.slice(0, 255) || 'avatar';

                    await attachmentsRepository.insert({
                        id: attachmentId,
                        ownerType: 'user',
                        ownerId: userId,
                        kind: 'avatar',
                        originalName,
                        storageKey: stored.storageKey,
                        mimeType: stored.mimeType,
                        sizeBytes: stored.sizeBytes,
                        visibility: 'public',
                    });

                    await usersRepository.update(
                        { id: userId },
                        { image: attachmentId },
                    );

                    return {
                        attachmentId,
                        oldStorageKey,
                    };
                },
            );
        } catch (error: unknown) {
            // Database transaction failed.
            // Remove the newly written file.
            await this.deleteFileBestEffort(
                stored.storageKey,
            );

            throw error;
        }

        // Step 3: Database committed successfully.
        // The old file can now be removed.
        if (result.oldStorageKey) {
            await this.deleteFileBestEffort(
                result.oldStorageKey,
            );
        }

        return {
            image: `/api/avatars/${result.attachmentId}`,
        };
    }

    async getPublicAvatar(
        attachmentId: string,
    ): Promise<Buffer> {
        if (!isUUID(attachmentId, '4')) {
            throw new NotFoundException(
                'Avatar not found',
            );
        }

        const attachment = await this.dataSource
            .getRepository(Attachment)
            .findOneBy({
                id: attachmentId,
                ownerType: 'user',
                kind: 'avatar',
                visibility: 'public',
            });

        if (!attachment) {
            throw new NotFoundException(
                'Avatar not found',
            );
        }

        const image = await this.storage.readAvatar(
            attachment.storageKey,
        );

        if (!image) {
            throw new NotFoundException(
                'Avatar file not found',
            );
        }

        return image;
    }


    async deleteAvatar(userId: string): Promise<void> {
        const oldStorageKey = await this.dataSource.transaction(
            async (manager): Promise<string | null> => {
                const usersRepository =
                    manager.getRepository(User);

                const attachmentsRepository =
                    manager.getRepository(Attachment);

                // Serialize upload and delete operations.
                const user = await usersRepository
                    .createQueryBuilder('user')
                    .setLock('pessimistic_write')
                    .where('user.id = :userId', { userId })
                    .getOne();

                if (!user) {
                    throw new NotFoundException('User not found');
                }

                // Idempotent: nothing to delete.
                if (!user.image) {
                    return null;
                }

                const oldAttachmentId = user.image;

                let storageKey: string | null = null;

                if (oldAttachmentId) {
                    const oldAttachment =
                        await attachmentsRepository.findOneBy({
                            id: oldAttachmentId,
                            ownerType: 'user',
                            ownerId: userId,
                            kind: 'avatar',
                        });

                    if (oldAttachment) {
                        storageKey = oldAttachment.storageKey;

                        await attachmentsRepository.delete({
                            id: oldAttachment.id,
                        });
                    }
                }

                // Clear avatar reference in the same transaction.
                await usersRepository.update(
                    { id: userId },
                    { image: null },
                );

                return storageKey;
            },
        );

        if (oldStorageKey) {
            await this.deleteFileBestEffort(oldStorageKey);
        }
    }

    private async deleteFileBestEffort(
        storageKey: string,
    ): Promise<void> {
        try {
            await this.storage.deleteAvatar(storageKey);
        } catch (error: unknown) {
            this.logger.error(
                `Failed to clean up avatar ${storageKey}: ${String(error)}`,
            );
        }
    }
}
