/** @jsxImportSource react */
import React, { useState } from 'react';
import { Box, Text } from 'ink';
import TextInput from 'ink-text-input';
import Spinner from 'ink-spinner';
import type { AuthResponse } from '../auth/login.ts';
import { login, verify } from '../auth/login.ts';
import { formatError } from '../api/errors.ts';

type Stage = 'email' | 'password' | 'authenticating' | 'mfa' | 'verifying' | 'done';

interface LoginFlowProps {
  onComplete: (auth: AuthResponse) => void;
  onCancel: () => void;
  onLog: (text: string) => void;
}

export function LoginFlow({ onComplete, onCancel, onLog }: LoginFlowProps) {
  const [stage, setStage] = useState<Stage>('email');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mfaCode, setMfaCode] = useState('');
  const [mfaMethod, setMfaMethod] = useState('');
  const [loginToken, setLoginToken] = useState('');
  const [error, setError] = useState('');
  const [mfaAttempts, setMfaAttempts] = useState(0);

  const handleEmailSubmit = (value: string) => {
    if (!value.trim()) { onCancel(); return; }
    setEmail(value.trim());
    setStage('password');
  };

  const handlePasswordSubmit = async (value: string) => {
    if (!value) { onCancel(); return; }
    setPassword(value);
    setStage('authenticating');
    setError('');

    try {
      const auth = await login(email, value);
      if (auth.mfaRequired && auth.loginToken) {
        setLoginToken(auth.loginToken);
        setMfaMethod(auth.mfaMethod ?? 'unknown');
        setStage('mfa');
      } else {
        setStage('done');
        onComplete(auth);
      }
    } catch (err) {
      setError(formatError(err));
      setStage('email');
      setEmail('');
    }
  };

  const handleMfaSubmit = async (value: string) => {
    if (!value.trim()) { onCancel(); return; }
    setMfaCode('');
    setStage('verifying');
    setError('');

    try {
      const auth = await verify(loginToken, value.trim());
      setStage('done');
      onComplete(auth);
    } catch (err) {
      const attempts = mfaAttempts + 1;
      setMfaAttempts(attempts);
      if (attempts >= 3) {
        setError('Too many failed attempts.');
        onCancel();
      } else {
        setError(`Invalid code. ${3 - attempts} attempt${3 - attempts > 1 ? 's' : ''} remaining.`);
        setStage('mfa');
      }
    }
  };

  return (
    <Box flexDirection="column" gap={0}>
      <Text bold>  Login to Geins</Text>
      <Text> </Text>

      {error ? <Text color="red">  {error}</Text> : null}

      {stage === 'email' ? (
        <Box>
          <Text>  Email: </Text>
          <TextInput value={email} onChange={setEmail} onSubmit={handleEmailSubmit} />
        </Box>
      ) : (
        <Text dimColor>  Email: {email}</Text>
      )}

      {stage === 'password' ? (
        <Box>
          <Text>  Password: </Text>
          <TextInput value={password} onChange={setPassword} onSubmit={handlePasswordSubmit} mask="•" />
        </Box>
      ) : stage !== 'email' ? (
        <Text dimColor>  Password: ••••••••</Text>
      ) : null}

      {stage === 'authenticating' ? (
        <Box gap={1}>
          <Text>  </Text>
          <Spinner type="dots" />
          <Text dimColor>Authenticating...</Text>
        </Box>
      ) : null}

      {stage === 'mfa' ? (
        <>
          <Text color="yellow">  MFA required ({mfaMethod})</Text>
          <Box>
            <Text>  Code: </Text>
            <TextInput value={mfaCode} onChange={setMfaCode} onSubmit={handleMfaSubmit} />
          </Box>
        </>
      ) : null}

      {stage === 'verifying' ? (
        <Box gap={1}>
          <Text>  </Text>
          <Spinner type="dots" />
          <Text dimColor>Verifying...</Text>
        </Box>
      ) : null}

      <Text> </Text>
      <Text dimColor>  Press Enter with empty input to cancel</Text>
    </Box>
  );
}
