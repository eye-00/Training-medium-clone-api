
export interface JwtAccessPayload {
  sub: string;
  jti: string;
  iat: number;
  exp: number;
}
