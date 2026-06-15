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
}

export interface TabPanelProps {
  children?: ReactNode;
  index: number;
  value: number;
  noScroll?: boolean;
}

export type FileType = 'markdown' | 'image' | 'text' | 'binary' | 'limit-exceeded';

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