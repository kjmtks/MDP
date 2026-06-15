import { type ReactNode } from 'react';
import {
  SidebarContext, PreviewContext, EditorContext, SnippetsContext, ImagesContext, HeaderContext, type DockSlices,
} from './DockContext';

export function DockProvider({ sidebar, preview, editor, snippets, images, headerActions, children }: DockSlices & { children: ReactNode }) {
  return (
    <HeaderContext.Provider value={headerActions}>
      <SidebarContext.Provider value={sidebar}>
        <PreviewContext.Provider value={preview}>
          <SnippetsContext.Provider value={snippets}>
            <ImagesContext.Provider value={images}>
              <EditorContext.Provider value={editor}>
                {children}
              </EditorContext.Provider>
            </ImagesContext.Provider>
          </SnippetsContext.Provider>
        </PreviewContext.Provider>
      </SidebarContext.Provider>
    </HeaderContext.Provider>
  );
}
