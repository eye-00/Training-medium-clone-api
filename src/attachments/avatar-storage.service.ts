import {
    BadRequestException,
    Injectable,
    PayloadTooLargeException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
    mkdir,
    readFile,
    rm,
    writeFile,
} from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';

const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_INPUT_PIXELS = 20_000_000;
const AVATAR_SIZE = 512;

const STORAGE_KEY_PATTERN =
    /^avatars\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.webp$/i;

export interface StoredAvatar {
    storageKey: string;
    mimeType: 'image/webp';
    sizeBytes: number;
}

@Injectable()
export class AvatarStorageService {
    private readonly avatarDirectory = join(
        process.cwd(),
        'uploads',
        'avatars',
    );

    private resolvePath(storageKey: string): string {
        if (!STORAGE_KEY_PATTERN.test(storageKey)) {
            throw new BadRequestException(
                'Invalid avatar storage key',
            );
        }

        const filename = storageKey.slice(
            'avatars/'.length,
        );

        return join(this.avatarDirectory, filename);
    }

    async saveAvatar(input: Buffer): Promise<StoredAvatar> {
        if (!Buffer.isBuffer(input) || input.length === 0) {
            throw new BadRequestException(
                'Image file is required',
            );
        }

        if (input.length > MAX_FILE_BYTES) {
            throw new PayloadTooLargeException(
                'Avatar must not exceed 2 MB',
            );
        }

        let output: Buffer;

        try {
            const metadata = await sharp(input, {
                limitInputPixels: MAX_INPUT_PIXELS,
                failOn: 'error',
            }).metadata();

            if (
                metadata.format !== 'jpeg' &&
                metadata.format !== 'png' &&
                metadata.format !== 'webp'
            ) {
                throw new BadRequestException(
                    'Only JPEG, PNG and WebP images are allowed',
                );
            }

            if ((metadata.pages ?? 1) > 1) {
                throw new BadRequestException(
                    'Animated images are not allowed',
                );
            }

            output = await sharp(input, {
                limitInputPixels: MAX_INPUT_PIXELS,
                failOn: 'error',
            })
                .rotate()
                .resize(AVATAR_SIZE, AVATAR_SIZE, {
                    fit: 'cover',
                    position: 'centre',
                    withoutEnlargement: true,
                })
                .webp({
                    quality: 82,
                    effort: 4,
                })
                .toBuffer();
        } catch (error: unknown) {
            if (error instanceof BadRequestException) {
                throw error;
            }

            throw new BadRequestException(
                'Invalid or unsupported image',
            );
        }

        const storageKey = `avatars/${randomUUID()}.webp`;

        await mkdir(this.avatarDirectory, {
            recursive: true,
        });

        await writeFile(
            this.resolvePath(storageKey),
            output,
            { flag: 'wx' },
        );

        return {
            storageKey,
            mimeType: 'image/webp',
            sizeBytes: output.length,
        };
    }

    async readAvatar(
        storageKey: string,
    ): Promise<Buffer | null> {
        try {
            return await readFile(
                this.resolvePath(storageKey),
            );
        } catch (error: unknown) {
            if (
                (error as NodeJS.ErrnoException).code === 'ENOENT'
            ) {
                return null;
            }

            throw error;
        }
    }

    async deleteAvatar(
        storageKey: string,
    ): Promise<void> {
        try {
            await rm(this.resolvePath(storageKey));
        } catch (error: unknown) {
            if (
                (error as NodeJS.ErrnoException).code === 'ENOENT'
            ) {
                return;
            }

            throw error;
        }
    }
}
