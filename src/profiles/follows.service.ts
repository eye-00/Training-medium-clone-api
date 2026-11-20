import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { InjectRepository } from '@nestjs/typeorm';
import { QueryFailedError, type Repository } from 'typeorm';
import { User } from '../users/entities/user.entity.js';
import { Follow } from './entities/follow.entity.js';

@Injectable()
export class FollowsService {
  constructor(
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,

    @InjectRepository(Follow)
    private readonly followsRepository: Repository<Follow>,
  ) { }

  private async resolveTarget(
    username: string,
  ): Promise<User> {
    const target = await this.usersRepository.findOne({
      where: { username },
    });

    if (!target) {
      throw new NotFoundException('Profile not found');
    }

    return target;
  }


  async follow(
    followerId: string,
    username: string,
  ): Promise<void> {
    const target = await this.resolveTarget(username);

    if (target.id === followerId) {
      throw new BadRequestException(
        'You cannot follow yourself',
      );
    }

    try {
      await this.followsRepository.insert({
        followerId,
        followedId: target.id,
      });
    } catch (error: unknown) {
      if (error instanceof QueryFailedError) {
        const driverError = error.driverError as {
          code?: string;
        };

        if (driverError.code === 'ER_DUP_ENTRY') {
          throw new ConflictException(
            'Already following this user',
          );
        }

        if (
          driverError.code === 'ER_NO_REFERENCED_ROW_2'
        ) {
          throw new NotFoundException(
            'User no longer exists',
          );
        }
      }

      throw error;
    }
  }

  async unfollow(
    followerId: string,
    username: string,
  ): Promise<void> {
    const target = await this.resolveTarget(username);

    if (target.id === followerId) {
      return;
    }

    await this.followsRepository.delete({
      followerId,
      followedId: target.id,
    });
  }
}
