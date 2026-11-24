
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthModule } from '../auth/auth.module.js';
import { RedisModule } from '../redis/redis.module.js';
import { User } from '../users/entities/user.entity.js';
import { UsersModule } from '../users/users.module.js';

import { Attachment } from './entities/attachment.entity.js';
import { AvatarStorageService } from './avatar-storage.service.js';
import { AvatarService } from './avatar.service.js';
import { UserAvatarController } from './user-avatar.controller.js';
import { PublicAvatarController } from './public-avatar.controller.js';

@Module({
    imports: [
        TypeOrmModule.forFeature([
            User,
            Attachment,
        ]),
        AuthModule,
        RedisModule,
        UsersModule,
    ],
    controllers: [
        UserAvatarController,
        PublicAvatarController,
    ],
    providers: [
        AvatarStorageService,
        AvatarService,
    ],
})


export class AttachmentsModule { }
