import React from 'react';
import { Box, Text } from 'ink';

interface MarkdownProps {
  children: string;
  indent?: number;
}

interface InlineSegment {
  text: string;
  bold?: boolean;
  italic?: boolean;
  code?: boolean;
  dimColor?: boolean;
}

function parseInline(line: string): InlineSegment[] {
  const segments: InlineSegment[] = [];
  const regex = /(`[^`]+`|\*\*\*[^*]+\*\*\*|\*\*[^*]+\*\*|\*[^*]+\*|_[^_]+_)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(line)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ text: line.slice(lastIndex, match.index) });
    }
    const token = match[0]!;
    if (token.startsWith('`')) {
      segments.push({ text: token.slice(1, -1), code: true });
    } else if (token.startsWith('***') || token.startsWith('___')) {
      segments.push({ text: token.slice(3, -3), bold: true, italic: true });
    } else if (token.startsWith('**')) {
      segments.push({ text: token.slice(2, -2), bold: true });
    } else if (token.startsWith('*') || token.startsWith('_')) {
      segments.push({ text: token.slice(1, -1), italic: true });
    }
    lastIndex = match.index + token.length;
  }

  if (lastIndex < line.length) {
    segments.push({ text: line.slice(lastIndex) });
  }

  if (segments.length === 0) {
    segments.push({ text: line });
  }

  return segments;
}

function InlineText({ segments }: { segments: InlineSegment[] }) {
  return (
    <Text>
      {segments.map((seg, i) => {
        if (seg.code) {
          return <Text key={i} color="yellow">{seg.text}</Text>;
        }
        return (
          <Text key={i} bold={seg.bold} italic={seg.italic} dimColor={seg.dimColor}>
            {seg.text}
          </Text>
        );
      })}
    </Text>
  );
}

export function Markdown({ children, indent = 2 }: MarkdownProps) {
  const lines = children.split('\n');
  const pad = ' '.repeat(indent);
  const elements: React.ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i]!;

    // Code block
    if (line.trimStart().startsWith('```')) {
      const lang = line.trimStart().slice(3).trim();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i]!.trimStart().startsWith('```')) {
        codeLines.push(lines[i]!);
        i++;
      }
      i++; // skip closing ```
      elements.push(
        <Box key={elements.length} flexDirection="column" marginY={0}>
          {lang && <Text dimColor>{pad}┌ {lang}</Text>}
          {codeLines.map((cl, ci) => (
            <Text key={ci} color="yellow">{pad}{lang ? '│ ' : '  '}{cl}</Text>
          ))}
          {lang && <Text dimColor>{pad}└</Text>}
        </Box>,
      );
      continue;
    }

    // Heading
    const headingMatch = line.match(/^(#{1,3})\s+(.+)/);
    if (headingMatch) {
      const level = headingMatch[1]!.length;
      const text = headingMatch[2]!;
      const color = level === 1 ? 'cyan' : level === 2 ? '#3b82f6' : 'white';
      elements.push(
        <Text key={elements.length} color={color} bold>
          {pad}{text}
        </Text>,
      );
      i++;
      continue;
    }

    // Horizontal rule
    if (/^[-*_]{3,}\s*$/.test(line.trim())) {
      elements.push(
        <Text key={elements.length} dimColor>{pad}{'─'.repeat(40)}</Text>,
      );
      i++;
      continue;
    }

    // Unordered list
    const ulMatch = line.match(/^(\s*)[*\-+]\s+(.*)/);
    if (ulMatch) {
      const depth = Math.floor(ulMatch[1]!.length / 2);
      const listPad = ' '.repeat(depth * 2);
      elements.push(
        <Box key={elements.length}>
          <Text>{pad}{listPad}</Text>
          <Text color="cyan">• </Text>
          <InlineText segments={parseInline(ulMatch[2]!)} />
        </Box>,
      );
      i++;
      continue;
    }

    // Ordered list
    const olMatch = line.match(/^(\s*)\d+\.\s+(.*)/);
    if (olMatch) {
      const depth = Math.floor(olMatch[1]!.length / 2);
      const listPad = ' '.repeat(depth * 2);
      const num = line.match(/^(\s*)(\d+)\./)![2]!;
      elements.push(
        <Box key={elements.length}>
          <Text>{pad}{listPad}</Text>
          <Text dimColor>{num}. </Text>
          <InlineText segments={parseInline(olMatch[2]!)} />
        </Box>,
      );
      i++;
      continue;
    }

    // Blockquote
    if (line.trimStart().startsWith('> ')) {
      const content = line.replace(/^\s*>\s?/, '');
      elements.push(
        <Box key={elements.length}>
          <Text color="gray">{pad}│ </Text>
          <Text italic dimColor>{content}</Text>
        </Box>,
      );
      i++;
      continue;
    }

    // Empty line
    if (line.trim() === '') {
      elements.push(<Text key={elements.length}> </Text>);
      i++;
      continue;
    }

    // Regular paragraph
    elements.push(
      <Box key={elements.length}>
        <Text>{pad}</Text>
        <InlineText segments={parseInline(line)} />
      </Box>,
    );
    i++;
  }

  return <Box flexDirection="column">{elements}</Box>;
}
