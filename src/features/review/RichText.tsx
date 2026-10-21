import React, { useMemo } from 'react';
import { richHtml } from './richHtml';

/** A finding's, a reply's or a flow step's text: Markdown with its TeX formulas drawn
 *  by KaTeX (richHtml.ts). `block` = paragraphs and lists; else one inline line. */
export const RichText: React.FC<{ text: string; block?: boolean }> = ({ text, block = false }) => {
  const html = useMemo(() => richHtml(text, block), [text, block]);
  return block
    ? <div className="mdp-rich" dangerouslySetInnerHTML={{ __html: html }} />
    : <span className="mdp-rich" dangerouslySetInnerHTML={{ __html: html }} />;
};
