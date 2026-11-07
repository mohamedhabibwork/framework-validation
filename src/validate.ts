import { type FieldError, validationFailed } from '@framework/http';
import { zValidator } from '@hono/zod-validator';
import type { ValidationTargets } from 'hono';
import type { z } from 'zod/v4';

export function toFieldErrors(error: { readonly issues: readonly z.core.$ZodIssue[] }): FieldError[] {
  return error.issues.map((issue) => ({
    path: issue.path.map(String).join('.') || '(root)',
    message: issue.message,
    code: issue.code,
  }));
}

/**
 * Native Hono validator that preserves zod input/output inference (including
 * for RPC clients) and converts failures into the framework's 422 envelope.
 * Malformed JSON is rejected by Hono with 400 before this hook runs.
 */
export const validate = <Target extends keyof ValidationTargets, Schema extends z.ZodType>(
  target: Target,
  schema: Schema,
) =>
  zValidator(target, schema, (result) => {
    if (!result.success) throw validationFailed(toFieldErrors(result.error));
  });
