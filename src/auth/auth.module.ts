import { Module } from "@nestjs/common";
import { UsersModule } from "../users/users.module.js";
import { JwtModule } from "@nestjs/jwt";
import { AuthController } from "./auth.controller.js";
import { AuthService } from "./auth.service.js";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { RedisModule } from "../redis/redis.module.js";
import { CurrentUserController } from "./current-user.controller.js";
import { JwtAuthGuard } from "./guards/jwt-auth.guard.js";
import { LogoutController } from './logout.controller.js';
import { OptionalJwtAuthGuard } from './guards/optional-jwt-auth.guard.js';
@Module({
    imports: [
        UsersModule,
        JwtModule.registerAsync({
            imports: [ConfigModule],
            inject: [ConfigService],
            useFactory: (configService: ConfigService) => ({
                secret: configService.getOrThrow<string>('JWT_SECRET'),
                signOptions: {
                    algorithm: 'HS256' as const,
                    expiresIn: '15m' as const,
                }
            }),
        }),
        RedisModule,
    ],
    controllers: [AuthController, CurrentUserController, LogoutController],
    providers: [AuthService, JwtAuthGuard, OptionalJwtAuthGuard],
    exports: [AuthService, JwtModule, JwtAuthGuard, OptionalJwtAuthGuard],
})

export class AuthModule { }