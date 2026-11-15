import type { PublicUserDto } from '../../users/dto/register-response.dto.js';
import type { JwtAccessPayload } from './jwt-access-payload.js';
export interface AuthenticatedRequest {
    headers: {
        authorization?: string;
    };
    user?: PublicUserDto;
    auth?: JwtAccessPayload;
}