import { describe, expect, test } from 'bun:test';
import { type FrameworkEnv, forbidden, installErrorHandling } from '@framework/http';
import { Hono } from 'hono';
import { z } from 'zod/v4';
import { authorizeRequest, defineFormRequest, toFieldErrors, validate } from '../src';

const payload = z.object({
  name: z.string().min(1),
  address: z.object({ city: z.string() }),
});

/** A fresh app with the framework error boundary and request id plumbing. */
function app() {
  const instance = new Hono<FrameworkEnv>();
  instance.use(async (c, next) => {
    c.set('requestId', 'req-test-1');
    await next();
  });
  return installErrorHandling(instance, { exposeInternalErrors: true });
}

describe('validate()', () => {
  test('passes the parsed value to the handler', async () => {
    const instance = app();
    instance.post('/', validate('json', payload), (c) => c.json({ seen: c.req.valid('json') }));
    const response = await instance.request('/', {
      method: 'POST',
      body: JSON.stringify({ name: 'x', address: { city: 'y' } }),
      headers: { 'content-type': 'application/json' },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ seen: { name: 'x', address: { city: 'y' } } });
  });

  test('invalid bodies return the 422 VALIDATION_FAILED envelope with field errors', async () => {
    const instance = app();
    instance.post('/', validate('json', payload), (c) => c.json({ ok: true }));
    const response = await instance.request('/', {
      method: 'POST',
      body: JSON.stringify({ name: '', address: {} }),
      headers: { 'content-type': 'application/json' },
    });
    expect(response.status).toBe(422);
    const body = (await response.json()) as {
      error: { code: string; fields: { path: string; message: string; code: string }[]; requestId?: string };
    };
    expect(body.error.code).toBe('VALIDATION_FAILED');
    expect(body.error.requestId).toBe('req-test-1');
    const paths = body.error.fields.map((field) => field.path).sort();
    expect(paths).toEqual(['address.city', 'name']);
  });

  test('nested issue paths join with dots and root issues render (root)', () => {
    const parsed = payload.safeParse({ name: '', address: {} });
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(
      toFieldErrors(parsed.error)
        .map((field) => field.path)
        .sort(),
    ).toEqual(['address.city', 'name']);
    const root = z
      .string()
      .refine(() => false, 'nope')
      .safeParse('x');
    expect(root.success).toBe(false);
    if (root.success) return;
    expect(toFieldErrors(root.error)).toEqual([{ path: '(root)', message: 'nope', code: 'custom' }]);
  });

  test('malformed JSON is rejected by Hono with 400 before validation', async () => {
    const instance = app();
    instance.post('/', validate('json', payload), (c) => c.json({ ok: true }));
    const response = await instance.request('/', {
      method: 'POST',
      body: '{not json',
      headers: { 'content-type': 'application/json' },
    });
    expect(response.status).toBe(400);
  });
});

describe('form requests', () => {
  const request = defineFormRequest({
    schema: payload,
    authorize: (c) => c.req.header('x-role') === 'admin',
  });

  test('authorization runs before validation: denied + invalid body is 403, not 422', async () => {
    const instance = app();
    instance.post('/', authorizeRequest(request), validate('json', request.schema), (c) => c.json({ ok: true }));
    const response = await instance.request('/', {
      method: 'POST',
      body: JSON.stringify({ name: '' }),
      headers: { 'content-type': 'application/json' },
    });
    expect(response.status).toBe(403);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe('FORBIDDEN');
  });

  test('async authorization hooks are awaited', async () => {
    const asyncRequest = defineFormRequest({
      schema: payload,
      authorize: async () => false,
    });
    const instance = app();
    instance.post('/', authorizeRequest(asyncRequest), (c) => c.json({ ok: true }));
    const response = await instance.request('/', {
      method: 'POST',
      body: JSON.stringify({ name: 'x', address: { city: 'y' } }),
      headers: { 'content-type': 'application/json' },
    });
    expect(response.status).toBe(403);
    expect((await response.json()) as { error: { code: string } }).toMatchObject({ error: { code: 'FORBIDDEN' } });
  });

  test('an authorized request reaches the handler with validated data', async () => {
    const instance = app();
    instance.post('/', authorizeRequest(request), validate('json', request.schema), (c) =>
      c.json({ name: c.req.valid('json').name }),
    );
    const response = await instance.request('/', {
      method: 'POST',
      body: JSON.stringify({ name: 'x', address: { city: 'y' } }),
      headers: { 'content-type': 'application/json', 'x-role': 'admin' },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ name: 'x' });
  });

  test('defineFormRequest returns the request unchanged', () => {
    expect(defineFormRequest({ schema: payload, authorize: () => false })).toEqual({
      schema: payload,
      authorize: expect.any(Function),
    });
    expect(forbidden().status).toBe(403);
  });
});
