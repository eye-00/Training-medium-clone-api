import {
    Injectable,
    Logger,
    OnModuleDestroy,
    OnModuleInit,
    ServiceUnavailableException,
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

}