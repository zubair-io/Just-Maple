/**
 * Type declarations for the File System Access API.
 * https://wicg.github.io/file-system-access/
 *
 * These APIs are not yet part of TypeScript's standard lib,
 * so we declare them here to avoid unsafe `any` casts.
 */

interface FileSystemHandlePermissionDescriptor {
  mode?: 'read' | 'readwrite';
}

interface FileSystemDirectoryHandle {
  entries(): AsyncIterableIterator<[string, FileSystemDirectoryHandle | FileSystemFileHandle]>;
  queryPermission(descriptor?: FileSystemHandlePermissionDescriptor): Promise<PermissionState>;
  requestPermission(descriptor?: FileSystemHandlePermissionDescriptor): Promise<PermissionState>;
  removeEntry(name: string, options?: { recursive?: boolean }): Promise<void>;
}

interface FileSystemFileHandle {
  createWritable(options?: FileSystemCreateWritableOptions): Promise<FileSystemWritableFileStream>;
}

interface FileSystemCreateWritableOptions {
  keepExistingData?: boolean;
}

interface FileSystemWritableFileStream extends WritableStream {
  write(data: string | BufferSource | Blob | WriteParams): Promise<void>;
  seek(position: number): Promise<void>;
  truncate(size: number): Promise<void>;
  close(): Promise<void>;
}

interface WriteParams {
  type: 'write' | 'seek' | 'truncate';
  data?: string | BufferSource | Blob;
  position?: number;
  size?: number;
}

interface ShowDirectoryPickerOptions {
  id?: string;
  mode?: 'read' | 'readwrite';
  startIn?:
    | FileSystemHandle
    | 'desktop'
    | 'documents'
    | 'downloads'
    | 'music'
    | 'pictures'
    | 'videos';
}

interface Window {
  showDirectoryPicker(options?: ShowDirectoryPickerOptions): Promise<FileSystemDirectoryHandle>;
}
