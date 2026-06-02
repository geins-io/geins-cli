import { describe, expect, test } from 'bun:test';
import { mergeLocalizedContent, parseProductTextField } from '../src/commands/products.ts';

describe('parseProductTextField', () => {
  test('maps field tokens to API collection names', () => {
    expect(parseProductTextField('name')).toBe('Names');
    expect(parseProductTextField('shorttext')).toBe('ShortTexts');
    expect(parseProductTextField('longtext')).toBe('LongTexts');
    expect(parseProductTextField('techtext')).toBe('TechTexts');
  });

  test('accepts plural and "text" alias, is case/space-insensitive', () => {
    expect(parseProductTextField('LongTexts')).toBe('LongTexts');
    expect(parseProductTextField('  Text ')).toBe('LongTexts');
    expect(parseProductTextField('NAMES')).toBe('Names');
  });

  test('returns null for unknown tokens', () => {
    expect(parseProductTextField('description')).toBeNull();
    expect(parseProductTextField('')).toBeNull();
  });
});

describe('mergeLocalizedContent', () => {
  test('replaces an existing locale, keeping the others (translation is additive)', () => {
    const base = [
      { LanguageCode: 'sv', Content: 'Hej' },
      { LanguageCode: 'en', Content: 'Hello' },
    ];
    const merged = mergeLocalizedContent(base, [{ LanguageCode: 'sv', Content: 'Tjena' }]);
    expect(merged).toEqual([
      { LanguageCode: 'sv', Content: 'Tjena' },
      { LanguageCode: 'en', Content: 'Hello' },
    ]);
  });

  test('appends a new locale', () => {
    const merged = mergeLocalizedContent(
      [{ LanguageCode: 'sv', Content: 'Hej' }],
      [{ LanguageCode: 'en', Content: 'Hello' }],
    );
    expect(merged).toEqual([
      { LanguageCode: 'sv', Content: 'Hej' },
      { LanguageCode: 'en', Content: 'Hello' },
    ]);
  });

  test('does not mutate the base array', () => {
    const base = [{ LanguageCode: 'sv', Content: 'Hej' }];
    mergeLocalizedContent(base, [{ LanguageCode: 'sv', Content: 'Tjena' }]);
    expect(base).toEqual([{ LanguageCode: 'sv', Content: 'Hej' }]);
  });

  test('applies multiple updates in one call', () => {
    const merged = mergeLocalizedContent(
      [{ LanguageCode: 'sv', Content: 'Hej' }],
      [
        { LanguageCode: 'sv', Content: 'Tjena' },
        { LanguageCode: 'de', Content: 'Hallo' },
      ],
    );
    expect(merged).toEqual([
      { LanguageCode: 'sv', Content: 'Tjena' },
      { LanguageCode: 'de', Content: 'Hallo' },
    ]);
  });
});
