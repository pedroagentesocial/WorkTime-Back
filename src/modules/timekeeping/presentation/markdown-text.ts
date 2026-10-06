const ESCAPABLE = /\\([\\`*_{}[\]()#+\-.!~>|])/g;
const ESCAPE_MARK = /(\d+);/g;

// Los reportes se guardan en Markdown; en un CSV se entregan como texto plano legible
export function markdownToPlainText(markdown: string): string {
  return markdown
    .replace(ESCAPABLE, (_, char: string) => `${char.charCodeAt(0)};`)
    .replace(/```[\s\S]*?```/g, (block) => block.replaceAll('```', ''))
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\(([^)\s]+)[^)]*\)/g, '$1 ($2)')
    .replace(/^[ \t]{0,3}#{1,6}[ \t]+/gm, '')
    .replace(/^[ \t]{0,3}>[ \t]?/gm, '')
    .replace(/^[ \t]*[-*+][ \t]+/gm, '• ')
    .replace(/(\*\*|__)(.+?)\1/g, '$2')
    .replace(/(\*|_)(.+?)\1/g, '$2')
    .replace(/~~(.+?)~~/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(ESCAPE_MARK, (_, code: string) => String.fromCharCode(Number(code)))
    .trim();
}
