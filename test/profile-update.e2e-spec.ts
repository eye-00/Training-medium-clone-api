
import {
  type INestApplication,
  ValidationPipe,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { DataSource } from 'typeorm';
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
} from 'vitest';

import { User } from '../src/users/entities/user.entity.js';

describe('Update Profile E2E', () => {
  let app: INestApplication | undefined;

  const createdUsers: Array<{
    id: string;
    email: string;
  }> = [];

  const suffix = randomUUID().replaceAll('-', '');

  const email = `e2e-profile-${suffix}@example.com`;
  const username = `profile_${suffix.slice(0, 16)}`;
  const otherUsername = `other_${suffix.slice(0, 16)}`;
  const updatedUsername = `edited_${suffix.slice(0, 16)}`;
  const password = 'ExamplePass123!';

  beforeAll(async () => {
    const env = process.env;

    // Check test environment before loading AppModule
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

    // Verify the actual database connection
    const dataSource = app.get(DataSource);

    const rows = (await dataSource.query(`
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
  });

  afterAll(async () => {
    if (!app) return;

    try {
      const repository = app
        .get(DataSource)
        .getRepository(User);

      for (const user of createdUsers) {
        await repository.delete({
          id: user.id,
          email: user.email,
        });
      }
    } finally {
      await app.close();
    }
  });

  it('updates profile with validation and authorization', async () => {
    if (!app) {
      throw new Error('Test app not initialized');
    }

    const server = app.getHttpServer();

    // Register the first user
    const register = await request(server)
      .post('/api/users')
      .send({ email, username, password })
      .expect(201);

    const userId = register.body.user.id as string;
    createdUsers.push({ id: userId, email });

    // Register another user to test duplicate username
    const otherEmail =
      `e2e-other-${suffix}@example.com`;

    const otherRegister = await request(server)
      .post('/api/users')
      .send({
        email: otherEmail,
        username: otherUsername,
        password,
      })
      .expect(201);

    createdUsers.push({
      id: otherRegister.body.user.id as string,
      email: otherEmail,
    });

    // Login
    const login = await request(server)
      .post('/api/users/login')
      .send({ email, password })
      .expect(200);

    const token = login.body.accessToken as string;
    const authorization = `Bearer ${token}`;

    // Missing JWT
    await request(server)
      .put('/api/user')
      .send({ bio: 'Unauthorized update' })
      .expect(401);

    // Empty request
    await request(server)
      .put('/api/user')
      .set('Authorization', authorization)
      .send({})
      .expect(400);

    // Invalid username
    await request(server)
      .put('/api/user')
      .set('Authorization', authorization)
      .send({ username: null })
      .expect(400);

    // Forbidden field
    await request(server)
      .put('/api/user')
      .set('Authorization', authorization)
      .send({ email: 'changed@example.com' })
      .expect(400);

    // Bio exceeds 500 characters
    await request(server)
      .put('/api/user')
      .set('Authorization', authorization)
      .send({ bio: 'x'.repeat(501) })
      .expect(400);

    // Duplicate username
    await request(server)
      .put('/api/user')
      .set('Authorization', authorization)
      .send({ username: otherUsername })
      .expect(409);

    // Update bio only
    const bioUpdate = await request(server)
      .put('/api/user')
      .set('Authorization', authorization)
      .send({ bio: 'Learning NestJS' })
      .expect(200);

    expect(bioUpdate.body.user.username).toBe(
      username,
    );

    expect(bioUpdate.body.user.bio).toBe(
      'Learning NestJS',
    );

    // Update username only
    const usernameUpdate = await request(server)
      .put('/api/user')
      .set('Authorization', authorization)
      .send({ username: updatedUsername })
      .expect(200);

    expect(usernameUpdate.body.user.username).toBe(
      updatedUsername,
    );

    expect(usernameUpdate.body.user.bio).toBe(
      'Learning NestJS',
    );

    // Clear bio
    const cleared = await request(server)
      .put('/api/user')
      .set('Authorization', authorization)
      .send({ bio: null })
      .expect(200);

    expect(cleared.body.user.bio).toBeNull();

    // Verify persisted data
    const current = await request(server)
      .get('/api/user')
      .set('Authorization', authorization)
      .expect(200);

    expect(current.body.user.id).toBe(userId);
    expect(current.body.user.email).toBe(email);
    expect(current.body.user.username).toBe(
      updatedUsername,
    );
    expect(current.body.user.bio).toBeNull();
    expect(current.body.user).not.toHaveProperty(
      'passwordHash',
    );

    // Original credentials must still work
    await request(server)
      .post('/api/users/login')
      .send({ email, password })
      .expect(200);
  });
});
