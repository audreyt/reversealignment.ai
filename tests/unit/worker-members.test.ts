import { describe, expect, test } from 'vite-plus/test';
import { storeVerifiedMemberEmail } from '../../worker/src/members';

type StoredMember = {
  id: string;
  email: string;
  emailDomain: string;
  updatedAt: string;
};

function memberEnv(row: StoredMember): Env {
  return {
    DB: {
      prepare() {
        return {
          bind(email: string, emailDomain: string, updatedAt: string, memberId: string) {
            return {
              async run() {
                if (row.id === memberId && row.email === '') {
                  row.email = email;
                  row.emailDomain = emailDomain;
                  row.updatedAt = updatedAt;
                }
                return {};
              },
            };
          },
        };
      },
    },
  } as unknown as Env;
}

describe('storeVerifiedMemberEmail', () => {
  test('stores the normalized Access email once and never overwrites it', async () => {
    const row: StoredMember = {
      id: 'member-1',
      email: '',
      emailDomain: '',
      updatedAt: 'before',
    };
    const env = memberEnv(row);

    await storeVerifiedMemberEmail(env, row.id, ' Verified.Person@Example.COM ');
    expect(row.email).toBe('verified.person@example.com');
    expect(row.emailDomain).toBe('example.com');
    expect(Date.parse(row.updatedAt)).not.toBeNaN();

    await storeVerifiedMemberEmail(env, row.id, 'replacement@example.net');
    expect(row.email).toBe('verified.person@example.com');
    expect(row.emailDomain).toBe('example.com');
  });

  test('rejects an invalid address before writing', async () => {
    const row: StoredMember = {
      id: 'member-1',
      email: '',
      emailDomain: '',
      updatedAt: 'before',
    };

    await expect(storeVerifiedMemberEmail(memberEnv(row), row.id, 'not-an-email')).rejects.toThrow(
      'Invalid Access-verified email'
    );
    expect(row.email).toBe('');
    expect(row.updatedAt).toBe('before');
  });
});
