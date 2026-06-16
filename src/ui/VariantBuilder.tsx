/** @jsxImportSource react */
import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import Spinner from 'ink-spinner';
import {
  listVariantLabels,
  addVariantLabel,
  buildVariantGroupFromProducts,
  type VariantGroupProductSpec,
  type BuildVariantGroupResult,
} from '../commands/products.ts';
import { formatError } from '../api/errors.ts';

type Stage =
  | 'loading'
  | 'name'
  | 'collapse'
  | 'labels'
  | 'add-label'
  | 'product-id'
  | 'product-values'
  | 'review'
  | 'running';

interface VariantBuilderProps {
  onComplete: (result: BuildVariantGroupResult) => void;
  onCancel: (message?: string) => void;
}

export function VariantBuilder({ onComplete, onCancel }: VariantBuilderProps) {
  const [stage, setStage] = useState<Stage>('loading');
  const [error, setError] = useState('');

  const [name, setName] = useState('');
  const [collapse, setCollapse] = useState('');

  const [available, setAvailable] = useState<string[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [cursor, setCursor] = useState(0);
  const [newLabel, setNewLabel] = useState('');

  const [products, setProducts] = useState<VariantGroupProductSpec[]>([]);
  const [productId, setProductId] = useState('');
  const [valueIndex, setValueIndex] = useState(0);
  const [values, setValues] = useState<Record<string, string>>({});
  const [valueInput, setValueInput] = useState('');

  useEffect(() => {
    listVariantLabels()
      .then((labels) => { setAvailable(labels); setStage('name'); })
      .catch((err) => onCancel(`Failed to load variant labels: ${formatError(err)}`));
  }, [onCancel]);

  // Key handling for the non-text stages (labels selection, review).
  useInput((input, key) => {
    if (stage === 'labels') {
      const items = [...available, '__add__'];
      if (key.upArrow) { setCursor((c) => (c <= 0 ? items.length - 1 : c - 1)); return; }
      if (key.downArrow) { setCursor((c) => (c >= items.length - 1 ? 0 : c + 1)); return; }
      if (key.escape) { onCancel('Variant builder cancelled.'); return; }
      const onAdd = cursor === items.length - 1;
      if (input === ' ' && !onAdd) {
        const label = available[cursor]!;
        setSelected((s) => (s.includes(label) ? s.filter((x) => x !== label) : [...s, label]));
        return;
      }
      if (input.toLowerCase() === 'a' || (key.return && onAdd)) {
        setNewLabel('');
        setStage('add-label');
        return;
      }
      if (key.return) {
        if (selected.length === 0) { setError('Select at least one dimension (space), or press a to add one.'); return; }
        setError('');
        setStage('product-id');
        return;
      }
      return;
    }

    if (stage === 'review') {
      if (key.escape) { onCancel('Variant builder cancelled.'); return; }
      if (key.return) { void run(); return; }
    }
  });

  const handleName = (value: string) => { setName(value.trim()); setStage('collapse'); };

  const handleCollapse = (value: string) => {
    setCollapse(value.trim());
    setStage('labels');
  };

  const handleAddLabel = async (value: string) => {
    const label = value.trim();
    if (!label) { setStage('labels'); return; }
    try {
      await addVariantLabel(label);
      setAvailable((a) => (a.includes(label) ? a : [...a, label]));
      setSelected((s) => (s.includes(label) ? s : [...s, label]));
      setError('');
    } catch (err) {
      setError(`Could not register "${label}": ${formatError(err)}`);
    }
    setStage('labels');
  };

  const handleProductId = (value: string) => {
    const id = value.trim();
    if (!id) {
      // Empty id finishes adding products.
      if (products.length === 0) { onCancel('No products added — cancelled.'); return; }
      setStage('review');
      return;
    }
    setProductId(id);
    setValues({});
    setValueIndex(0);
    setValueInput('');
    setStage('product-values');
  };

  const handleValue = (value: string) => {
    const label = selected[valueIndex]!;
    const nextValues = { ...values, [label]: value.trim() };
    setValues(nextValues);
    setValueInput('');
    if (valueIndex + 1 < selected.length) {
      setValueIndex(valueIndex + 1);
      return;
    }
    // Done with this product's dimensions.
    const dimensions = selected.map((l) => ({ Label: l, Value: nextValues[l] ?? '' }));
    setProducts((p) => [...p, { id: productId, dimensions }]);
    setProductId('');
    setValues({});
    setValueIndex(0);
    setStage('product-id');
  };

  const run = async () => {
    setStage('running');
    setError('');
    try {
      const result = await buildVariantGroupFromProducts({
        name: name || undefined,
        collapseInLists: collapse.toLowerCase().startsWith('y') ? true : undefined,
        labels: selected,
        products,
      });
      onComplete(result);
    } catch (err) {
      onCancel(formatError(err));
    }
  };

  return (
    <Box flexDirection="column" paddingX={1}>
      <Text bold>  Create variant group from existing products</Text>
      {error ? <Text color="red">  {error}</Text> : null}
      <Text> </Text>

      {stage === 'loading' ? (
        <Box gap={1}><Text>  </Text><Spinner type="dots" /><Text dimColor>Loading variant labels...</Text></Box>
      ) : null}

      {stage === 'name' ? (
        <Box><Text>  Group name (optional): </Text><TextInput value={name} onChange={setName} onSubmit={handleName} /></Box>
      ) : stage !== 'loading' ? (
        <Text dimColor>  Group name: {name || '(none)'}</Text>
      ) : null}

      {stage === 'collapse' ? (
        <Box><Text>  Collapse non-main in lists? (y/N): </Text><TextInput value={collapse} onChange={setCollapse} onSubmit={handleCollapse} /></Box>
      ) : null}

      {stage === 'labels' ? (
        <Box flexDirection="column">
          <Text dimColor>  Pick dimensions — ↑↓ move · space toggle · a add new · enter continue · esc cancel</Text>
          <Box flexDirection="column" borderStyle="single" paddingX={1}>
            {available.map((label, i) => (
              <Text key={label} color={i === cursor ? 'cyan' : undefined} bold={i === cursor}>
                {i === cursor ? '▸' : ' '} {selected.includes(label) ? '◉' : '○'} {label}
              </Text>
            ))}
            <Text color={cursor === available.length ? 'cyan' : 'green'} bold={cursor === available.length}>
              {cursor === available.length ? '▸' : ' '} ➕ Add new label
            </Text>
          </Box>
        </Box>
      ) : null}

      {stage === 'add-label' ? (
        <Box><Text>  New label name: </Text><TextInput value={newLabel} onChange={setNewLabel} onSubmit={handleAddLabel} /></Box>
      ) : null}

      {stage === 'product-id' ? (
        <Box flexDirection="column">
          <Text dimColor>  Dimensions: {selected.join(', ')} · {products.length} product(s) added</Text>
          <Box><Text>  Product id (empty to finish): </Text><TextInput value={productId} onChange={setProductId} onSubmit={handleProductId} /></Box>
        </Box>
      ) : null}

      {stage === 'product-values' ? (
        <Box flexDirection="column">
          <Text dimColor>  Product {productId} — {selected[valueIndex]}</Text>
          <Box><Text>  {selected[valueIndex]} = </Text><TextInput value={valueInput} onChange={setValueInput} onSubmit={handleValue} /></Box>
        </Box>
      ) : null}

      {stage === 'review' ? (
        <Box flexDirection="column">
          <Text>  Review — enter to create, esc to cancel</Text>
          <Text dimColor>  Labels: {selected.join(', ')}</Text>
          {products.map((p) => (
            <Text key={p.id}>  • {p.id}  {p.dimensions.map((d) => `${d.Label}=${d.Value}`).join(', ')}</Text>
          ))}
        </Box>
      ) : null}

      {stage === 'running' ? (
        <Box gap={1}><Text>  </Text><Spinner type="dots" /><Text dimColor>Creating variant group...</Text></Box>
      ) : null}
    </Box>
  );
}
