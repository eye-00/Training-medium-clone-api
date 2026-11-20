import {
  BadRequestException,
  PayloadTooLargeException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  mkdtemp,
  readFile,
  rm,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import { AvatarStorageService } from './avatar-storage.service.js';

describe('AvatarStorageService', () => {
  let service: AvatarStorageService;
  let temporaryRoot: string;

  beforeEach(async () => {
    temporaryRoot = await mkdtemp(
      join(tmpdir(), 'medium-avatar-test-'),
    );

    // Set a temporary root only while constructing the service.
    const cwdSpy = vi
      .spyOn(process, 'cwd')
      .mockReturnValue(temporaryRoot);

    try {
      service = new AvatarStorageService();
    } finally {
      cwdSpy.mockRestore();
    }
  });

  afterEach(async () => {
    await rm(temporaryRoot, {
      recursive: true,
      force: true,
    });
  });

  async function createImage(
    format: 'jpeg' | 'png' | 'webp',
  ): Promise<Buffer> {
    return sharp({
      create: {
        width: 640,
        height: 640,
        channels: 3,
        background: {
          r: 70,
          g: 120,
          b: 180,
        },
      },
    })
      .toFormat(format)
      .toBuffer();
  }

  it.each(['jpeg', 'png', 'webp'] as const)(
    'accepts %s and stores normalized WebP',
    async (format) => {
      const input = await createImage(format);

      const stored = await service.saveAvatar(input);

      expect(stored.storageKey).toMatch(
        /^avatars\/[a-f0-9-]+\.webp$/,
      );

      expect(stored.mimeType).toBe('image/webp');
      expect(stored.sizeBytes).toBeGreaterThan(0);

      const output = await service.readAvatar(
        stored.storageKey,
      );

      expect(output).not.toBeNull();

      const metadata = await sharp(output!).metadata();

      expect(metadata.format).toBe('webp');
      expect(metadata.width).toBe(512);
      expect(metadata.height).toBe(512);

      expect(stored.sizeBytes).toBe(output!.length);

      // Verify that the file actually exists on disk.
      const diskFile = await readFile(
        join(
          temporaryRoot,
          'uploads',
          ...stored.storageKey.split('/'),
        ),
      );

      expect(diskFile).toEqual(output);
    },
  );

  it('rejects an empty file', async () => {
    await expect(
      service.saveAvatar(Buffer.alloc(0)),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects files larger than 2 MB', async () => {
    const oversized = Buffer.alloc(
      2 * 1024 * 1024 + 1,
    );

    await expect(
      service.saveAvatar(oversized),
    ).rejects.toBeInstanceOf(
      PayloadTooLargeException,
    );
  });

  it('rejects fake image content', async () => {
    const fakeImage = Buffer.from(
      'This is not an image',
    );

    await expect(
      service.saveAvatar(fakeImage),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects GIF files', async () => {
    const gif = await sharp({
      create: {
        width: 20,
        height: 20,
        channels: 3,
        background: '#ffffff',
      },
    })
      .gif()
      .toBuffer();

    await expect(
      service.saveAvatar(gif),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects SVG files', async () => {
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect width="20" height="20"/></svg>',
    );

    await expect(
      service.saveAvatar(svg),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('returns null when the avatar does not exist', async () => {
    const missingKey = `avatars/${randomUUID()}.webp`;

    const result = await service.readAvatar(missingKey);

    expect(result).toBeNull();
  });

  it('deletes an avatar and allows repeated deletion', async () => {
    const input = await createImage('png');
    const stored = await service.saveAvatar(input);

    expect(
      await service.readAvatar(stored.storageKey),
    ).not.toBeNull();

    await service.deleteAvatar(stored.storageKey);

    expect(
      await service.readAvatar(stored.storageKey),
    ).toBeNull();

    await expect(
      service.deleteAvatar(stored.storageKey),
    ).resolves.toBeUndefined();
  });

  it('rejects path traversal attempts', async () => {
    const maliciousKey =
      'avatars/../../private-file.webp';

    await expect(
      service.readAvatar(maliciousKey),
    ).rejects.toBeInstanceOf(BadRequestException);

    await expect(
      service.deleteAvatar(maliciousKey),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
