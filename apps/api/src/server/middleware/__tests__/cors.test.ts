import type { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';
import { corsHeaders } from '../cors.js';

describe('cors middleware', () => {
  it('does not allow placeholder API origins', () => {
    const request = new Request('https://real.example/api/health', {
      headers: { origin: 'https://api.example.com' },
    });

    const headers = corsHeaders(request as unknown as NextRequest);

    expect(headers['Access-Control-Allow-Origin']).toBe('https://servicewechat.com');
  });
});
