export type CommandScope = 'GLOBAL' | 'LOCAL';

export interface CommandResult {
  type: string;
  scope: CommandScope;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  params: any;
}

export const parseCommand = (input: string): CommandResult | null => {
  if (!input) return null;
  let content = input.trim();
  const commentMatch = content.match(/^<!--\s*([\s\S]*?)\s*-->$/);
  if (commentMatch) {
    content = commentMatch[1].trim();
  }
  const text = content.trim();
  if (text === '') return null;
  const matchAspect = text.match(/^@aspect\s+(\d+:\d+)$/);
  if (matchAspect) {
    return { type: 'ASPECT', scope: 'GLOBAL', params: matchAspect[1].split(':').map(Number) };
  }
  const matchTheme = text.match(/^@theme\s+(.+)$/);
  if (matchTheme) {
    return { type: 'THEME', scope: 'GLOBAL', params: matchTheme[1].trim() };
  }
  const matchMeta = text.match(/^@(date|title|subtitle|presenter|contact|affiliation)\s+(.*)$/);
  if (matchMeta) {
    return { type: 'META', scope: 'GLOBAL', params: { key: matchMeta[1], value: matchMeta[2] } };
  }
  const matchHeader = text.match(/^@header\s*([\s\S]*)$/);
  if (matchHeader) {
    return { type: 'HEADER', scope: 'GLOBAL', params: matchHeader[1].trim() };
  }
  const matchFooter = text.match(/^@footer\s*([\s\S]*)$/);
  if (matchFooter) {
    return { type: 'FOOTER', scope: 'GLOBAL', params: matchFooter[1].trim() };
  }

  const matchCaption = text.match(/^@caption\s+(.*)$/);
  if (matchCaption) {
    return { type: 'CAPTION', scope: 'LOCAL', params: matchCaption[1] };
  }
  const matchMulti = text.match(/^@begin\s+multicolumn\s+(.*)$/);
  if (matchMulti) {
    return { type: 'MULTICOLUMN_BEGIN', scope: 'LOCAL', params: matchMulti[1] };
  }
  if (/^@nextcolumn$/.test(text)) return { type: 'MULTICOLUMN_NEXT', scope: 'LOCAL', params: null };
  if (/^@end\s+multicolumn$/.test(text)) return { type: 'MULTICOLUMN_END', scope: 'LOCAL', params: null };
  const matchAddClass = text.match(/^@addclass\s+([^\s]+)\s+(.*)$/);
  if (matchAddClass) {
    return { type: 'ADD_CLASS', scope: 'LOCAL', params: { tag: matchAddClass[1].toLowerCase(), val: matchAddClass[2] } };
  }
  const matchAddStyle = text.match(/^@addstyle\s+([^\s]+)\s+(.*)$/);
  if (matchAddStyle) {
    return { type: 'ADD_STYLE', scope: 'LOCAL', params: { tag: matchAddStyle[1].toLowerCase(), val: matchAddStyle[2] } };
  }
  if (/^@cover$/.test(text)) {
    return { type: 'COVER', scope: 'LOCAL', params: null };
  }
  return null;
};