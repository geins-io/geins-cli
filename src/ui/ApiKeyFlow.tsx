import React, { useState } from 'react';
import { Box, Text } from 'ink';
import TextInput from 'ink-text-input';
import Spinner from 'ink-spinner';
import type { ApiCredentials } from '../config/store.ts';
import { validateManagementApi, validateMerchantApi } from '../api/live-client.ts';
import { formatError } from '../api/errors.ts';

type Stage = 'username' | 'mgmtKey' | 'mgmtPassword' | 'merchantKey' | 'validating' | 'done';

interface ApiKeyFlowProps {
  onComplete: (credentials: ApiCredentials) => void;
  onCancel: () => void;
}

interface ValidationResult {
  management: string | null;
  merchant: string | null;
}

export function ApiKeyFlow({ onComplete, onCancel }: ApiKeyFlowProps) {
  const [stage, setStage] = useState<Stage>('username');
  const [username, setUsername] = useState('');
  const [mgmtKey, setMgmtKey] = useState('');
  const [mgmtPassword, setMgmtPassword] = useState('');
  const [merchantKey, setMerchantKey] = useState('');
  const [error, setError] = useState('');
  const [results, setResults] = useState<ValidationResult>({ management: null, merchant: null });

  const validate = async (credentials: ApiCredentials) => {
    setStage('validating');
    setError('');

    const [management, merchant] = await Promise.all([
      validateManagementApi(credentials).then(() => null).catch((e) => formatError(e)),
      validateMerchantApi(credentials).then(() => null).catch((e) => formatError(e)),
    ]);

    setResults({ management, merchant });

    if (!management && !merchant) {
      setStage('done');
      onComplete(credentials);
    } else {
      setError('Validation failed. Re-enter your credentials or press Enter on an empty field to cancel.');
      setStage('username');
    }
  };

  const handleUsername = (value: string) => {
    if (!value.trim()) { onCancel(); return; }
    setUsername(value.trim());
    setStage('mgmtKey');
  };

  const handleMgmtKey = (value: string) => {
    if (!value.trim()) { onCancel(); return; }
    setMgmtKey(value.trim());
    setStage('mgmtPassword');
  };

  const handleMgmtPassword = (value: string) => {
    if (!value) { onCancel(); return; }
    setMgmtPassword(value);
    setStage('merchantKey');
  };

  const handleMerchantKey = (value: string) => {
    if (!value.trim()) { onCancel(); return; }
    const merchant = value.trim();
    setMerchantKey(merchant);
    void validate({
      username,
      managementApiKey: mgmtKey,
      managementApiPassword: mgmtPassword,
      merchantApiKey: merchant,
    });
  };

  return (
    <Box flexDirection="column" gap={0}>
      <Text bold>  Add Geins API credentials</Text>
      <Text dimColor>  Find these in Merchant Center → Settings → API Users</Text>
      <Text> </Text>

      {error ? <Text color="red">  {error}</Text> : null}

      {stage === 'username' ? (
        <Box>
          <Text>  Username: </Text>
          <TextInput value={username} onChange={setUsername} onSubmit={handleUsername} />
        </Box>
      ) : (
        <Text dimColor>  Username: {username}</Text>
      )}

      {stage === 'mgmtKey' ? (
        <Box>
          <Text>  Management API Key: </Text>
          <TextInput value={mgmtKey} onChange={setMgmtKey} onSubmit={handleMgmtKey} />
        </Box>
      ) : stage !== 'username' ? (
        <Text dimColor>  Management API Key: {mgmtKey}</Text>
      ) : null}

      {stage === 'mgmtPassword' ? (
        <Box>
          <Text>  Management API Password: </Text>
          <TextInput value={mgmtPassword} onChange={setMgmtPassword} onSubmit={handleMgmtPassword} mask="•" />
        </Box>
      ) : stage === 'merchantKey' || stage === 'validating' || stage === 'done' ? (
        <Text dimColor>  Management API Password: ••••••••</Text>
      ) : null}

      {stage === 'merchantKey' ? (
        <Box>
          <Text>  Merchant API Key: </Text>
          <TextInput value={merchantKey} onChange={setMerchantKey} onSubmit={handleMerchantKey} mask="•" />
        </Box>
      ) : stage === 'validating' || stage === 'done' ? (
        <Text dimColor>  Merchant API Key: ••••••••</Text>
      ) : null}

      {stage === 'validating' ? (
        <Box gap={1}>
          <Text>  </Text>
          <Spinner type="dots" />
          <Text dimColor>Validating against Management API and Merchant API...</Text>
        </Box>
      ) : null}

      {results.management !== null || results.merchant !== null ? (
        <Box flexDirection="column">
          <Text color={results.management ? 'red' : 'green'}>
            {results.management ? '  ✗' : '  ✓'} Management API{results.management ? `: ${results.management}` : ''}
          </Text>
          <Text color={results.merchant ? 'red' : 'green'}>
            {results.merchant ? '  ✗' : '  ✓'} Merchant API{results.merchant ? `: ${results.merchant}` : ''}
          </Text>
        </Box>
      ) : null}

      <Text> </Text>
      <Text dimColor>  Press Enter with empty input to cancel</Text>
    </Box>
  );
}
