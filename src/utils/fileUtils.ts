import type { FileType } from '../types';

const blobCache = new Map<string, string>();

export const getOrCreateBlobUrl = (dataUrl: string) => {
  if (blobCache.has(dataUrl)) return blobCache.get(dataUrl)!;
  try {
    const parts = dataUrl.split(',');
    const mime = parts[0].match(/:(.*?);/)?.[1] || 'image/png';
    const bstr = atob(parts[1]);
    let n = bstr.length;
    const u8arr = new Uint8Array(n);
    while (n--) u8arr[n] = bstr.charCodeAt(n);
    const blob = new Blob([u8arr], { type: mime });
    const url = URL.createObjectURL(blob);
    blobCache.set(dataUrl, url);
    return url;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  } catch (e) {
    return dataUrl;
  }
};

export const determineFileType = (filename: string, isBinaryFromServer?: boolean): FileType => {
  const lower = filename.toLowerCase();
  if (/\.(md|markdown)$/.test(lower)) return 'markdown';
  if (/\.(png|jpe?g|gif|svg|webp|bmp|ico)$/.test(lower)) return 'image';
  if (/\.pdf$/.test(lower)) return 'pdf';
  if (isBinaryFromServer === true) {
    return 'binary';
  }
  return 'text';
};