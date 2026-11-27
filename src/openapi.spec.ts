import { Test } from '@nestjs/testing';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { JwtService } from '@nestjs/jwt';
import { describe, expect, it } from 'vitest';

import { ArticlesController } from './articles/articles.controller.js';
import { ArticlesService } from './articles/articles.service.js';
import { UserAvatarController } from './attachments/user-avatar.controller.js';
import { AvatarService } from './attachments/avatar.service.js';
import { AuthController } from './auth/auth.controller.js';
import { AuthService } from './auth/auth.service.js';
import { CommentsController } from './comments/comments.controller.js';
import { CommentsService } from './comments/comments.service.js';
import { UsersController } from './users/users.controller.js';
import { UsersService } from './users/users.service.js';
import { RedisService } from './redis/redis.service.js';

describe('OpenAPI request contracts', () => {
    it('documents validated fields and guarded endpoint failures', async () => {
        const moduleRef = await Test.createTestingModule({
            controllers: [ArticlesController, CommentsController, UsersController, AuthController, UserAvatarController],
            providers: [
                { provide: ArticlesService, useValue: {} },
                { provide: CommentsService, useValue: {} },
                { provide: UsersService, useValue: {} },
                { provide: AuthService, useValue: {} },
                { provide: AvatarService, useValue: {} },
                { provide: JwtService, useValue: {} },
                { provide: RedisService, useValue: {} },
            ],
        }).compile();
        const app = moduleRef.createNestApplication();
        try {
            app.setGlobalPrefix('api');
            const doc = SwaggerModule.createDocument(app, new DocumentBuilder().addBearerAuth().build());
            const schemas = doc.components?.schemas as Record<string, { properties: Record<string, Record<string, unknown>> }>;

            expect(schemas.RegisterUserDto.properties.username.description).toContain('After trimming');
            expect(schemas.RegisterUserDto.properties.username).not.toHaveProperty('maxLength');
            expect(schemas.RegisterUserDto.properties.password).toMatchObject({ minLength: 8, maxLength: 72, writeOnly: true });
            expect(schemas.LoginUserDto.properties.password.description).toContain('72 UTF-8 bytes');
            expect(schemas.CreateArticleFieldsDto.properties.title.description).toContain('255 Unicode code points');
            expect(schemas.CreateArticleFieldsDto.properties.title).not.toHaveProperty('maxLength');
            expect(schemas.UpdateArticleFieldsDto.properties.tagList).toMatchObject({
                type: 'array', maxItems: 10, items: { type: 'string' },
            });
            expect(doc.paths['/api/articles']?.get?.responses?.['503']).toBeDefined();
            expect(doc.paths['/api/articles']?.post?.responses?.['503']).toBeDefined();
            expect(doc.paths['/api/articles/{slug}/comments']?.get?.responses?.['503']).toBeDefined();
            expect(doc.paths['/api/articles/{slug}/comments/{id}']?.delete?.responses?.['503']).toBeDefined();
        } finally {
            await app.close();
        }
    });
});
