import {
    Injectable,
    Logger,
    OnModuleDestroy,
    OnModuleInit,
    ServiceUnavailableException,
    UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient } from 'redis';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
    private readonly logger = new Logger(RedisService.name);
    private readonly client: ReturnType<typeof createClient>;

    constructor(private readonly config: ConfigService) {
        this.client = createClient({
            url: this.config.getOrThrow<string>('REDIS_URL'),
            disableOfflineQueue: true,
            socket: {
                reconnectStrategy: (retries) => {
                    const delay = Math.min(100 * 2 ** Math.min(retries, 5), 3000);
                    return delay;
                },
            },
        });
        this.client.on('error', (err: Error) => {
            this.logger.error(`Redis error: ${err.message}`);
        });
    }
    async onModuleInit(): Promise<void> {
        await this.client.connect();
        await this.client.ping();
        this.logger.log('Connected to Redis');
    }
    async onModuleDestroy(): Promise<void> {
        if (this.client.isOpen) {
            await this.client.close();
        }
    }
    async ping(): Promise<string> {
        return this.client.ping();
    }

    async isTokenRevoked(jti: string): Promise<boolean> {
        if (!this.client.isReady) {
            throw new ServiceUnavailableException(
                'Authentication service temporarily unavailable',
            );
        }

        try {
            const exists = await this.client.exists(
                `auth:blacklist:${jti}`,
            );

            return exists === 1;
        } catch {
            throw new ServiceUnavailableException(
                'Authentication service temporarily unavailable',
            );
        }
    }

    async revokeToken(
        jti: string,
        expiresAt: number,
    ): Promise<void> {
        const now = Math.floor(Date.now() / 1000);
        const remainingSeconds = expiresAt - now;

        if (remainingSeconds <= 0) {
            throw new UnauthorizedException(
                'Invalid or expired access token',
            );
        }

        if (!this.client.isReady) {
            throw new ServiceUnavailableException(
                'Authentication service temporarily unavailable',
            );
        }

        try {
            const result = await this.client.set(
                `auth:blacklist:${jti}`,
                '1',
                { EX: remainingSeconds },
            );

            if (result !== 'OK') {
                throw new Error('Token revocation was not confirmed');
            }
        } catch {
            throw new ServiceUnavailableException(
                'Authentication service temporarily unavailable',
            );
        }
    }


}