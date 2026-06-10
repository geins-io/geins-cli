import { login, verify, fetchUser, type AuthResponse } from '../auth/login.ts';
import { saveSession, clearSession, loadSession, parseJwtExp } from '../auth/session.ts';
import { notLoggedIn } from '../api/errors.ts';
import { prompt, promptSecret, promptChoice, spinner } from '../output/interactive.ts';
import { green, bold, dim, yellow, red } from '../output/color.ts';

async function resolveSession(auth: AuthResponse): Promise<void> {
  let accountKey = '';

  if (auth.accounts && auth.accounts.length > 1) {
    accountKey = await promptChoice(
      'Multiple accounts found:',
      auth.accounts.map((a) => ({
        label: `${a.displayName || a.accountKey} ${dim(`(${a.roles.join(', ')})`)}`,
        value: a.accountKey,
      })),
    );
  } else if (auth.accounts && auth.accounts.length === 1) {
    accountKey = auth.accounts[0]!.accountKey;
  }

  const s = spinner('Fetching user info...');
  const user = await fetchUser(auth.accessToken);
  s.stop();

  const name = user.name || [user.firstName, user.lastName].filter(Boolean).join(' ') || 'Unknown';

  const { apiKeysCleared } = await saveSession({
    accessToken: auth.accessToken,
    refreshToken: auth.refreshToken,
    accountKey,
    accountName: auth.accounts?.find((a) => a.accountKey === accountKey)?.displayName ?? '',
    tokenExpires: parseJwtExp(auth.accessToken),
    user: {
      email: user.email ?? '',
      name,
      roles: user.roles ?? [],
    },
  });

  console.error(green(`✓ Logged in as ${bold(user.email ?? name)}`));
  if (apiKeysCleared) {
    console.error(dim('  Stored API keys cleared — they belonged to the previous user. Run `geins apikey set` to add yours.'));
  }
}

export async function loginCommand(): Promise<void> {
  const username = await prompt('Email:');
  const password = await promptSecret('Password:');

  const s = spinner('Authenticating...');
  let auth: AuthResponse;

  try {
    auth = await login(username, password);
    s.stop();
  } catch (err) {
    s.stop();
    throw err;
  }

  if (auth.mfaRequired && auth.loginToken) {
    console.error(yellow(`  MFA required (${auth.mfaMethod ?? 'unknown'})`));

    const maxAttempts = 3;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const mfaCode = await prompt('MFA Code:');
      if (!mfaCode) throw new Error('MFA cancelled.');

      const ms = spinner('Verifying...');
      try {
        auth = await verify(auth.loginToken!, mfaCode);
        ms.stop();
        break;
      } catch (err) {
        ms.stop();
        if (attempt < maxAttempts) {
          console.error(red(`  Invalid code. ${maxAttempts - attempt} attempt${maxAttempts - attempt > 1 ? 's' : ''} remaining.`));
        } else {
          throw err;
        }
      }
    }
  }

  await resolveSession(auth);
}

export async function logoutCommand(): Promise<void> {
  await clearSession();
  console.error(green('✓ Logged out.'));
}

export async function whoamiCommand(): Promise<void> {
  const session = await loadSession();
  if (!session) notLoggedIn();

  console.log(`${bold(session.user.name)} <${session.user.email}>`);
  if (session.accountKey) {
    console.log(`Account: ${session.accountKey}`);
  }
  if (session.user.roles.length > 0) {
    console.log(`Roles: ${session.user.roles.join(', ')}`);
  }
}
