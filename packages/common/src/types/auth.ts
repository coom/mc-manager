// packages/common/src/types/auth.ts
export type UserRole = 'admin' | 'viewer';
export type TokenType = 'access' | 'mfa' | 'pwchange';
export interface JwtPayload {
  id: number;
  username: string;
  role: UserRole;
  typ?: TokenType;
  iat?: number;
  exp?: number;
}
