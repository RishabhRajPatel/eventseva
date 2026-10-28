import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';

/** Who is acting in the current request: written into booking_state_history by the database. */
export interface Actor {
  kind: 'customer' | 'vendor' | 'admin' | 'system' | 'gateway';
  id?: string;
}

/** Per request (or job): the request id for tracing, and the actor once the guards know it. */
interface Context {
  requestId?: string;
  actor?: Actor;
}

const store = new AsyncLocalStorage<Context>();

export const currentActor = (): Actor | undefined => store.getStore()?.actor;
export const currentRequestId = (): string | undefined => store.getStore()?.requestId;

/** Runs fn as this actor (jobs and the payment webhook use it; requests get it from ActorInterceptor). */
export const runAs = <T>(actor: Actor, fn: () => T): T => store.run({ ...store.getStore(), actor }, fn);

/**
 * Express middleware: every request gets an id (the caller's X-Request-Id when it looks safe, else a new
 * one), sent back in the response header and attached to error logs and booking state history.
 */
export function requestIdMiddleware(req: { headers: Record<string, unknown> }, res: { setHeader: (k: string, v: string) => void }, next: () => void) {
  const given = req.headers['x-request-id'];
  const requestId = typeof given === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(given) ? given : randomUUID();
  res.setHeader('X-Request-Id', requestId);
  store.run({ requestId }, next);
}

/** Sets the actor from the request's login once the guards have checked it. */
@Injectable()
export class ActorInterceptor implements NestInterceptor {
  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = ctx.switchToHttp().getRequest<{ auth?: { userId: string; app: string }; admin?: { adminId: string } }>();
    const actor: Actor | undefined = req.admin
      ? { kind: 'admin', id: req.admin.adminId }
      : req.auth
        ? { kind: req.auth.app === 'partner' ? 'vendor' : 'customer', id: req.auth.userId }
        : undefined;
    if (!actor) return next.handle();
    return new Observable((subscriber) => runAs(actor, () => next.handle().subscribe(subscriber)));
  }
}
