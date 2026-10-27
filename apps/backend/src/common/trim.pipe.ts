import { ArgumentMetadata, PipeTransform } from '@nestjs/common';

/** Never changed: a password with a space at the end is still that password. */
const KEEP_AS_IS = new Set(['password']);

const trimDeep = (value: unknown, key?: string): unknown => {
  if (typeof value === 'string') return key && KEEP_AS_IS.has(key) ? value : value.trim();
  if (Array.isArray(value)) return value.map((v) => trimDeep(v));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, trimDeep(v, k)]));
  }
  return value;
};

/**
 * Trims every string in a request body before validation, so "   " fails a length rule
 * instead of being saved as an empty reason, title or name.
 */
export class TrimBodyPipe implements PipeTransform {
  transform(value: unknown, metadata: ArgumentMetadata) {
    return metadata.type === 'body' ? trimDeep(value) : value;
  }
}
