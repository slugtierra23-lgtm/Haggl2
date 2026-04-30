import * as crypto from 'crypto';

import {
  CanActivate,
  ExecutionContext,
  Injectable,
  ForbiddenException,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request, Response } from 'express';

export const SKIP_CSRF_KEY = 'skipCsrf';
export const SkipCsrf = (): ClassDecorator & MethodDecorator => SetMetadata(SKIP_CSRF_KEY, true);

/**
 * CSRF Guard — Double-submit cookie pattern.
 *
 * The cookie is issued with Domain=COOKIE_DOMAIN (e.g. ".haggl.tech") so
 * the frontend JS — which runs on a different subdomain than the API — can
 * read it via document.cookie and mirror it back as the X-CSRF-Token header.
 *
 * We use the cookie name "csrf-token" (lowercase) to avoid colliding with
 * legacy host-only cookies named "X-CSRF-Token" that may still be pinned to
 * the API subdomain in returning users' browsers.
 *
 * Endpoints that don't have an authenticated session to abuse (login, register,
 * wallet nonce/verify, oauth callbacks, refresh) can opt out with @SkipCsrf().
 */
const CSRF_COOKIE = 'csrf-token';
const CSRF_HEADER = 'X-CSRF-Token';

@Injectable()
export class CsrfGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();
    const method = request.method.toUpperCase();

    // Safe methods never require CSRF — just refresh the cookie so the client
    // has a fresh token ready for the next mutation.
    if (['GET', 'HEAD', 'OPTIONS'].includes(method)) {
      this.emitCsrfToken(request, response);
      return true;
    }

    const skip = this.reflector.getAllAndOverride<boolean>(SKIP_CSRF_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (skip) {
      this.emitCsrfToken(request, response);
      return true;
    }

    const headerToken = request.get(CSRF_HEADER);
    const cookieToken = request.cookies?.[CSRF_COOKIE];

    if (!headerToken || !cookieToken) {
      throw new ForbiddenException('Missing CSRF token (header or cookie)');
    }

    if (!this.timingSafeEqual(headerToken, cookieToken)) {
      throw new ForbiddenException('CSRF token mismatch');
    }

    return true;
  }

  private emitCsrfToken(request: Request, response: Response): void {
    // Preserve the existing token so concurrent tabs don't race each other
    // into a mismatch. Only mint a fresh one when nothing's stored yet.
    if (request.cookies?.[CSRF_COOKIE]) return;

    const isProd = process.env.NODE_ENV === 'production';
    const cookieDomain = process.env.COOKIE_DOMAIN;
    const token = crypto.randomBytes(32).toString('hex');

    response.cookie(CSRF_COOKIE, token, {
      httpOnly: false,
      secure: isProd,
      sameSite: isProd ? 'none' : 'lax',
      maxAge: 3600000,
      path: '/',
      ...(cookieDomain ? { domain: cookieDomain } : {}),
    });

    // Legacy cookie name from previous versions — clear both host-only and
    // parent-domain variants so browsers hanging onto it stop sending a stale
    // token the new code never looks at.
    response.clearCookie('X-CSRF-Token', { path: '/' });
    if (cookieDomain) {
      response.clearCookie('X-CSRF-Token', { path: '/', domain: cookieDomain });
    }
  }

  private timingSafeEqual(a: string, b: string): boolean {
    if (a.length !== b.length) return false;
    let result = 0;
    for (let i = 0; i < a.length; i++) {
      result |= a.charCodeAt(i) ^ b.charCodeAt(i);
    }
    return result === 0;
  }
}
