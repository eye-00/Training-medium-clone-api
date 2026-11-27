import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import request from 'supertest';
import { QueryFailedError } from 'typeorm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { User } from './entities/user.entity.js';
import { UsersController } from './users.controller.js';
import { UsersService } from './users.service.js';

describe('Registration HTTP error mapping', () => {
    let app: INestApplication;
    const marker = 'synthetic-private-error-canary';
    const repository = {
        create: vi.fn((user: Partial<User>) => user),
        insert: vi.fn(),
    };
    const payload = {
        email: 'synthetic-errors@example.com',
        username: 'synthetic_errors',
        password: 'ExamplePass123!',
    };

    beforeAll(async () => {
        const module = await Test.createTestingModule({
            controllers: [UsersController],
            providers: [UsersService, { provide: getRepositoryToken(User), useValue: repository }],
        }).compile();
        app = module.createNestApplication({ logger: false });
        app.setGlobalPrefix('api');
        app.useGlobalPipes(new ValidationPipe({
            whitelist: true,
            forbidNonWhitelisted: true,
            transform: true,
        }));
        await app.init();
    });

    beforeEach(() => {
        vi.clearAllMocks();
        repository.insert.mockReset();
    });
    afterAll(async () => { if (app) await app.close(); });

    function databaseError(code: string): QueryFailedError {
        const driverError = Object.assign(new Error(`${marker}-driver`), { code });
        return new QueryFailedError(`SELECT '${marker}-sql'`, [`${marker}-parameter`], driverError);
    }

    it.each([
        ['ordinary error', () => new Error(marker)],
        ['unexpected database error', () => databaseError('ER_LOCK_WAIT_TIMEOUT')],
    ])('returns a sanitized 500 for %s', async (_name, makeError) => {
        repository.insert.mockRejectedValueOnce(makeError());
        const response = await request(app.getHttpServer()).post('/api/users').send(payload);
        expect(response.status).toBe(500);
        expect(response.body).toEqual({ statusCode: 500, message: 'Internal server error' });
        expect(response.text.includes(marker)).toBe(false);
        expect(repository.insert).toHaveBeenCalledOnce();
    }, 15000);

    it('maps duplicate database keys to 409 without exposing the database error', async () => {
        repository.insert.mockRejectedValueOnce(databaseError('ER_DUP_ENTRY'));
        const response = await request(app.getHttpServer()).post('/api/users').send(payload);
        expect(response.status).toBe(409);
        expect(response.body.message).toBe('Email or username already exists');
        expect(response.text.includes(marker)).toBe(false);
        expect(repository.insert).toHaveBeenCalledOnce();
    }, 15000);

    it('preserves validation 400 and skips database insertion', async () => {
        const response = await request(app.getHttpServer())
            .post('/api/users')
            .send({ ...payload, email: 'not-an-email' });
        expect(response.status).toBe(400);
        expect(repository.insert).not.toHaveBeenCalled();
    });
});
