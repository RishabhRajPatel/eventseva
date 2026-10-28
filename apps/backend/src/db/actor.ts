import { AsyncLocalStorage } from 'node:async_hooks';
import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';

/** Who is acting in the current request: written into booking_state_history by the database. */
export interface Actor {
  kind: 'customer' | 'vendor' | 'admin' | 'system' | 'gateway';
  id?: string;
}

const store = new AsyncLocalStorage<Actor>();

export const currentActor = (): Actor | undefined => store.getStore();

/** Runs fn as this actor (jobs and the payment webhook use it; requests get it from ActorInterceptor). */
export const runAs = <T>(actor: Actor, fn: () => T): T => store.run(actor, fn);

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
