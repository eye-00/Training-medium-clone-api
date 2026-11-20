import {
    Injectable,
    NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Repository } from 'typeorm';

import { User } from '../users/entities/user.entity.js';
import { Follow } from './entities/follow.entity.js';
import { ProfileResponseDto } from './dto/profile-response.dto.js';
import { toAvatarUrl } from '../attachments/avatar-url.js';

@Injectable()
export class ProfilesService {
    constructor(
        @InjectRepository(User)
        private readonly usersRepository: Repository<User>,

        @InjectRepository(Follow)
        private readonly followsRepository: Repository<Follow>,
    ) { }

    async getProfile(
        username: string,
    ): Promise<ProfileResponseDto> {
        const user = await this.usersRepository.findOne({
            where: { username },
        });

        if (!user) {
            throw new NotFoundException('Profile not found');
        }

        const [followersCount, followingCount] =
            await Promise.all([
                this.followsRepository.count({
                    where: { followedId: user.id },
                }),
                this.followsRepository.count({
                    where: { followerId: user.id },
                }),
            ]);

        return {
            profile: {
                username: user.username,
                bio: user.bio,
                image: toAvatarUrl(user.image),
                followersCount,
                followingCount,
            },
        };
    }
}
