import type { ReactNode } from 'react';

export interface SnippetItem {
  label: string;
  text: string;
  description?: string;
  icon?: string;
}

export interface SnippetsCategory {
  category: string;
  items: SnippetItem[];
}

export interface FileNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  isBinary?: boolean;
  children?: FileNode[];
  isSpecial?: boolean;
  isVirtual?: boolean;
  // Set by the backend on a directory that contains a `.mdpignore` file: the
  // directory and everything beneath it is excluded from the workspace slide
  // search, while staying browsable in the tree and usable as image/link targets.
  slideIgnored?: boolean;
  // A `.mdplink` file presented as a directory: its children are the linked
  // target's contents (a local path or an SSH remote dir). `linkType` is
  // 'local' | 'ssh'; `linkError` is set when the target could not be read.
  isLink?: boolean;
  linkType?: 'local' | 'ssh';
  linkError?: string;
  // A deferred node (an SSH link or a remote subdirectory) whose children are not
  // loaded yet — they're fetched on demand when the node is first expanded.
  lazy?: boolean;
}

export interface TabPanelProps {
  children?: ReactNode;
  index: number;
  value: number;
  noScroll?: boolean;
}

// 'markdown' = slide deck source (.slide.md) rendered as slides; 'doc' = a plain
// markdown file (.md/.markdown) rendered as a scrollable document; 'pdf' = a PDF
// rendered in the preview pane.
export type FileType = 'markdown' | 'doc' | 'image' | 'pdf' | 'text' | 'binary' | 'limit-exceeded';

export interface SnippetItem {
  label: string;
  text: string;
  description?: string;
  icon?: string;
  isCustom?: boolean;
  isModule?: boolean;
}

export interface ThemeOption {
  name: string;
  fileName: string;
  path: string;
  isCustom: boolean;
}

export const getCustomItemStyle = (isCustom?: boolean) => ({
  color: isCustom ? '#3b82f6' : 'inherit',
  fontWeight: isCustom ? 'bold' : 'normal',
});