import { describe, it, expect } from 'vitest';
import { AjaxError } from '~/data/proxy/AjaxError';

function fakeResponse(status: number, statusText: string): Response {
    return { status, statusText } as unknown as Response;
}

describe('AjaxError', () => {
    it('carries the status, statusText, body, operation, and url', () => {
        const body  = { detail: 'duplicate key on email' };
        const error = new AjaxError('create', '/api/users', fakeResponse(409, 'Conflict'), body);

        expect(error.status).toBe(409);
        expect(error.statusText).toBe('Conflict');
        expect(error.body).toEqual(body);
        expect(error.operation).toBe('create');
        expect(error.url).toBe('/api/users');
    });

    it('is both an AjaxError and an Error, with name "AjaxError"', () => {
        const error = new AjaxError('read', '/api/users', fakeResponse(500, 'Internal Server Error'), undefined);

        expect(error).toBeInstanceOf(AjaxError);
        expect(error).toBeInstanceOf(Error);
        expect(error.name).toBe('AjaxError');
    });

    it('sets a plain useful message of the form "AjaxProxy: <op> failed with status <n>"', () => {
        const error = new AjaxError('update', '/api/users/3', fakeResponse(422, 'Unprocessable Entity'), undefined);

        expect(error.message).toBe('AjaxProxy: update failed with status 422');
    });
});
