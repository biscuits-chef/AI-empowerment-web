import type { ReactNode } from 'react';

/** 安全 Markdown 展示组件属性。 */
type MarkdownContentProps = {
  /** 来自模型或历史消息的原始文本。 */
  content: string;
};

/** 支持的 Markdown 块结构。 */
type MarkdownBlock =
  | {
      /** 标题块。 */
      kind: 'heading';
      /** 标题层级。 */
      level: number;
      /** 标题文本。 */
      text: string;
    }
  | {
      /** 普通段落。 */
      kind: 'paragraph';
      /** 段落文本。 */
      text: string;
    }
  | {
      /** 列表块。 */
      kind: 'list';
      /** 是否为有序列表。 */
      ordered: boolean;
      /** 列表项目。 */
      items: string[];
    }
  | {
      /** 表格块。 */
      kind: 'table';
      /** 表头单元格。 */
      headers: string[];
      /** 表体行。 */
      rows: string[][];
    }
  | {
      /** 代码块。 */
      kind: 'code';
      /** 代码文本。 */
      text: string;
    };

/**
 * 拆分 Markdown 表格行并去除两侧空单元格。
 *
 * @param line 原始表格行。
 * @returns 经过裁剪的单元格列表。
 */
const tableCells = (line: string): string[] =>
  line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim());

/**
 * 判断一行是否为 Markdown 表头分隔线。
 *
 * @param line 待判断文本行。
 * @returns 满足表格分隔语法时返回 true。
 */
const isTableDivider = (line: string): boolean =>
  tableCells(line).every((cell) => /^:?-{3,}:?$/.test(cell));

/**
 * 将受控 Markdown 文本解析为有限块类型，不解释原始 HTML。
 *
 * @param content 原始 Markdown 文本。
 * @returns 可安全渲染的 Markdown 块列表。
 */
const parseMarkdown = (content: string): MarkdownBlock[] => {
  const lines = content.replace(/\r\n?/g, '\n').split('\n');
  const blocks: MarkdownBlock[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index] ?? '';
    if (!line.trim()) {
      index += 1;
      continue;
    }
    if (line.trim().startsWith('```')) {
      const code: string[] = [];
      index += 1;
      while (index < lines.length && !(lines[index] ?? '').trim().startsWith('```')) {
        code.push(lines[index] ?? '');
        index += 1;
      }
      blocks.push({ kind: 'code', text: code.join('\n') });
      index += 1;
      continue;
    }
    const heading = /^(#{1,3})\s+(.+)$/.exec(line.trim());
    if (heading) {
      blocks.push({ kind: 'heading', level: heading[1]!.length, text: heading[2]! });
      index += 1;
      continue;
    }
    if (line.includes('|') && index + 1 < lines.length && isTableDivider(lines[index + 1]!)) {
      const headers = tableCells(line);
      const rows: string[][] = [];
      index += 2;
      while (index < lines.length && (lines[index] ?? '').includes('|')) {
        rows.push(tableCells(lines[index]!));
        index += 1;
      }
      blocks.push({ kind: 'table', headers, rows });
      continue;
    }
    const listMatch = /^(?:[-*]\s+|(\d+)\.\s+)(.+)$/.exec(line.trim());
    if (listMatch) {
      const ordered = Boolean(listMatch[1]);
      const items: string[] = [listMatch[2]!];
      index += 1;
      while (index < lines.length) {
        const next = /^(?:[-*]\s+|(\d+)\.\s+)(.+)$/.exec((lines[index] ?? '').trim());
        if (!next || Boolean(next[1]) !== ordered) break;
        items.push(next[2]!);
        index += 1;
      }
      blocks.push({ kind: 'list', ordered, items });
      continue;
    }
    const paragraph = [line.trim()];
    index += 1;
    while (index < lines.length && (lines[index] ?? '').trim()) {
      const next = (lines[index] ?? '').trim();
      if (/^(#{1,3})\s+/.test(next) || /^(?:[-*]\s+|\d+\.\s+)/.test(next)) break;
      if (next.includes('|') && index + 1 < lines.length && isTableDivider(lines[index + 1]!)) {
        break;
      }
      paragraph.push(next);
      index += 1;
    }
    blocks.push({ kind: 'paragraph', text: paragraph.join('\n') });
  }
  return blocks;
};

/**
 * 安全渲染加粗和行内代码，其他内容保持纯文本。
 *
 * @param text 行内 Markdown 文本。
 * @returns React 文本节点列表。
 */
const inlineContent = (text: string): ReactNode[] =>
  text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g).map((part, index) => {
    if (part.startsWith('`') && part.endsWith('`')) {
      return <code key={`${part}-${index}`}>{part.slice(1, -1)}</code>;
    }
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={`${part}-${index}`}>{part.slice(2, -2)}</strong>;
    }
    return part;
  });

/**
 * 以受控标题、列表、表格和代码块展示模型 Markdown，不执行 HTML。
 *
 * @param 参数1 解构后的组件属性，各字段含义见对应属性类型。
 * @returns 安全的 Markdown 展示内容。
 */
export const MarkdownContent = ({ content }: MarkdownContentProps) => (
  <div className="markdown-content">
    {parseMarkdown(content).map((block, index) => {
      const key = `${block.kind}-${index}`;
      if (block.kind === 'heading') {
        if (block.level === 1) return <h2 key={key}>{inlineContent(block.text)}</h2>;
        if (block.level === 2) return <h3 key={key}>{inlineContent(block.text)}</h3>;
        return <h4 key={key}>{inlineContent(block.text)}</h4>;
      }
      if (block.kind === 'list') {
        const items = block.items.map((item, itemIndex) => (
          <li key={`${item}-${itemIndex}`}>{inlineContent(item)}</li>
        ));
        return block.ordered ? <ol key={key}>{items}</ol> : <ul key={key}>{items}</ul>;
      }
      if (block.kind === 'table') {
        return (
          <div className="markdown-table-wrap" key={key} tabIndex={0}>
            <table>
              <thead>
                <tr>
                  {block.headers.map((header, headerIndex) => (
                    <th key={`${header}-${headerIndex}`} scope="col">
                      {inlineContent(header)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {block.rows.map((row, rowIndex) => (
                  <tr key={`${row.join('|')}-${rowIndex}`}>
                    {block.headers.map((_, cellIndex) => (
                      <td key={`${rowIndex}-${cellIndex}`}>
                        {inlineContent(row[cellIndex] ?? '')}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      }
      if (block.kind === 'code') {
        return (
          <pre key={key}>
            <code>{block.text}</code>
          </pre>
        );
      }
      return <p key={key}>{inlineContent(block.text)}</p>;
    })}
  </div>
);
