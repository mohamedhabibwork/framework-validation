import { type FrameworkEnv, forbidden } from '@framework/http';
import type { Context } from 'hono';
import { createMiddleware } from 'hono/factory';
import type { z } from 'zod/v4';

/**
 * A form request groups the schema for one operation with its authorization
 * hook. Schemas stay exported so routes, OpenAPI and clients share them.
 */
export interface FormRequest<TSchema extends z.ZodType> {
  readonly schema: TSchema;
  readonly authorize: (c: Context<FrameworkEnv>) => boolean | Promise<boolean>;
}

export const defineFormRequest = <TSchema extends z.ZodType>(request: FormRequest<TSchema>): FormRequest<TSchema> =>
  request;

/** Runs the form request's authorization hook; denial is a 403. */
export const authorizeRequest = <TSchema extends z.ZodType>(request: FormRequest<TSchema>) =>
  createMiddleware<FrameworkEnv>(async (c, next) => {
    if (!(await request.authorize(c))) throw forbidden();
    await next();
  });
