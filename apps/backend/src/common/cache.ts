import { applyDecorators, Header } from '@nestjs/common';

/**
 * For public, login-free GETs: phones and CDNs may reuse the answer for `maxAgeSec`, and keep
 * showing it for `staleSec` more while they fetch a fresh copy. Answers differ by language, so
 * caches keep one copy per Accept-Language. Express adds an ETag, so a repeat fetch is a tiny 304.
 */
export const PublicCache = (maxAgeSec: number, staleSec = maxAgeSec * 10) =>
  applyDecorators(
    Header('Cache-Control', `public, max-age=${maxAgeSec}, stale-while-revalidate=${staleSec}`),
    Header('Vary', 'Accept-Language'),
  );
