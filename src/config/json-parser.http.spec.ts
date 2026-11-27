import {
    BadRequestException,
    Body,
    Controller,
    Get,
    HttpCode,
    Post,
    ValidationPipe,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { IsString } from 'class-validator';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { configureBodyParser } from './body-parser.js';

class PayloadDto {
    @IsString()
    value!: string;
}

const echoHandler = vi.fn((payload: PayloadDto) => ({ value: payload.value }));

@Controller('parser-probe')
class ParserProbeController {
    @Post('echo')
    @HttpCode(200)
    echo(@Body() payload: PayloadDto) {
        return echoHandler(payload);
    }

    @Post('business-error')
    businessError(): never {
        throw new BadRequestException('Synthetic business validation failure');
    }

    @Get('syntax-error')
    syntaxError(): never {
        throw new SyntaxError('SYNTHETIC_INTERNAL_SYNTAX');
    }
}

describe('JSON parser HTTP error handling', () => {
    let app: NestExpressApplication;

    beforeAll(async () => {
        const moduleRef = await Test.createTestingModule({
            controllers: [ParserProbeController],
        }).compile();
        app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false, bodyParser: false });
        configureBodyParser(app);
        app.setGlobalPrefix('api');
        app.useGlobalPipes(new ValidationPipe({
            whitelist: true,
            forbidNonWhitelisted: true,
            transform: true,
        }));
        await app.init();
    });

    beforeEach(() => { echoHandler.mockClear(); });
    afterAll(async () => { await app?.close(); });

    it.each([
        '{"value":CANARY8}',
        '{"value":"SYNTHETIC_MARKER_34K","other":oops}',
        '{"value":"CANARY8",}',
        '{"value":"CANARY8"',
    ])('returns a fixed message for malformed JSON without reflecting body bytes', async (body) => {
        const response = await request(app.getHttpServer())
            .post('/api/parser-probe/echo')
            .set('Content-Type', 'application/json')
            .send(body);
        expect(response.status).toBe(400);
        expect(response.body).toEqual({
            statusCode: 400, message: 'Invalid JSON payload', error: 'Bad Request',
        });
        expect(JSON.stringify(response.body)).not.toContain('CANARY8');
        expect(JSON.stringify(response.body)).not.toContain('SYNTHETIC_MARKER_34K');
        expect(response.text).not.toContain('CANARY8');
        expect(response.text).not.toContain('SYNTHETIC_MARKER_34K');
        expect(echoHandler).not.toHaveBeenCalled();
    });

    it('preserves 413 for an oversized JSON body', async () => {
        const overhead = Buffer.byteLength(JSON.stringify({ value: '' }), 'utf8');
        const payload = { value: 'a'.repeat(102401 - overhead) };
        expect(Buffer.byteLength(JSON.stringify(payload), 'utf8')).toBe(102401);
        const response = await request(app.getHttpServer())
            .post('/api/parser-probe/echo')
            .send(payload);
        expect(response.status).toBe(413);
        expect(response.body.message).not.toBe('Invalid JSON payload');
        expect(echoHandler).not.toHaveBeenCalled();
    });

    it('does not change a SyntaxError raised by application code', async () => {
        const response = await request(app.getHttpServer()).get('/api/parser-probe/syntax-error');
        expect(response.status).toBe(500);
        expect(response.body).toEqual({ statusCode: 500, message: 'Internal server error' });
    });

    it('preserves DTO and business validation responses', async () => {
        const invalidDto = await request(app.getHttpServer()).post('/api/parser-probe/echo').send({ value: 42 });
        expect(invalidDto.status).toBe(400);
        expect(invalidDto.body.message).toContain('value must be a string');
        const business = await request(app.getHttpServer()).post('/api/parser-probe/business-error');
        expect(business.status).toBe(400);
        expect(business.body.message).toBe('Synthetic business validation failure');
    });

    it('preserves valid JSON and URL-encoded body parsing', async () => {
        const json = await request(app.getHttpServer()).post('/api/parser-probe/echo').send({ value: 'json' });
        expect(json.status).toBe(200);
        expect(json.body).toEqual({ value: 'json' });
        const form = await request(app.getHttpServer()).post('/api/parser-probe/echo')
            .type('form').send({ value: 'form' });
        expect(form.status).toBe(200);
        expect(form.body).toEqual({ value: 'form' });
    });
});
