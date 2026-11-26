import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthModule } from '../auth/auth.module.js';
import { RedisModule } from '../redis/redis.module.js';
import { UsersModule } from '../users/users.module.js';

import { Comment } from './entities/comment.entity.js';
import { CommentsController } from './comments.controller.js';
import { CommentsService } from './comments.service.js';
import { CommentIdPipe } from './pipes/comment-id.pipe.js';
@Module({
    imports: [
        TypeOrmModule.forFeature([Comment]),
        AuthModule,
        RedisModule,
        UsersModule,
    ],
    controllers: [CommentsController],
    providers: [CommentsService, CommentIdPipe],
})
export class CommentsModule { }
