
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthModule } from '../auth/auth.module.js';
import { RedisModule } from '../redis/redis.module.js';
import { User } from '../users/entities/user.entity.js';
import { UsersModule } from '../users/users.module.js';

import { Follow } from './entities/follow.entity.js';
import { FollowsService } from './follows.service.js';
import { ProfilesController } from './profiles.controller.js';
import { ProfilesService } from './profiles.service.js';

@Module({
    imports: [
        TypeOrmModule.forFeature([User, Follow]),
        AuthModule,
        RedisModule,
        UsersModule,
    ],
    controllers: [ProfilesController],
    providers: [ProfilesService, FollowsService],
})
export class ProfilesModule { }
