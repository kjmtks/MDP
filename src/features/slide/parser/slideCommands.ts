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
  const matchCss = text.match(/^@css\s+(.+)$/);
  if (matchCss) {
    return { type: 'CSS', scope: 'GLOBAL', params: matchCss[1].trim() };
  }
  const matchMeta = text.match(/^@(date|title|subtitle|presenter|contact|affiliation)\s+(.*)$/);
  if (matchMeta) {
    return { type: 'META', scope: 'GLOBAL', params: { key: matchMeta[1], value: matchMeta[2] } };
  }
  const matchTransition = text.match(/^@transition\s+([^\s]+)\s*([\s\S]*)$/);
  if (matchTransition) {
    return { type: 'TRANSITION', scope: 'GLOBAL', params: { name: matchTransition[1].trim(), argsStr: (matchTransition[2] || '').trim() } };
  }
  const matchBuild = text.match(/^@build\b\s*([\s\S]*)$/);
  if (matchBuild) {
    return { type: 'BUILD', scope: 'GLOBAL', params: { argsStr: (matchBuild[1] || '').trim() } };
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

  if (/^@cover$/.test(text)) {
    return { type: 'COVER', scope: 'LOCAL', params: null };
  }
  return null;
};