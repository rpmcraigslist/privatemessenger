import { describe, expect, it } from 'vitest';
import {
  buildMessengerDeepLink,
  parseDeepLinkFromSearch,
} from './deep-link';

describe('deep-link', () => {
  it('builds a login URL with chat and message query params', () => {
    expect(
      buildMessengerDeepLink(
        'https://main.d332i3bk71so1w.amplifyapp.com',
        'conv-123',
        'msg-456',
      ),
    ).toBe(
      'https://main.d332i3bk71so1w.amplifyapp.com/?chat=conv-123&message=msg-456',
    );
  });

  it('parses chat and message from search params', () => {
    expect(parseDeepLinkFromSearch('?chat=conv-1&message=msg-2')).toEqual({
      conversationId: 'conv-1',
      messageId: 'msg-2',
    });
  });

  it('returns null when chat param is missing', () => {
    expect(parseDeepLinkFromSearch('?message=msg-2')).toBeNull();
  });
});
