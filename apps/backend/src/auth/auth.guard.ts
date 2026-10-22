import { CanActivate, createParamDecorator, ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { AppError } from '../common/errors';
import { AuthContext, TokenService } from './token.service';

type AuthedRequest = Request & { auth?: AuthContext };

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly tokens: TokenService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const [scheme, token] = (req.headers.authorization ?? '').split(' ');
    if (scheme !== 'Bearer' || !token) {
      throw new AppError('UNAUTHORIZED', 'Please log in.', HttpStatus.UNAUTHORIZED);
    }
    req.auth = await this.tokens.verifyAccess(token);
    return true;
  }
}

/** `@Auth() auth: AuthContext` in a controller method protected by AuthGuard. */
export const Auth = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthContext => {
  return ctx.switchToHttp().getRequest<AuthedRequest>().auth!;
});
