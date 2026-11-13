import type { Platform } from './api';
import type { Hadji } from './index';

export function electronPlatform(bridge: Hadji): Platform {
  return {
    kind: 'electron',
    openFile: bridge.openFile,
    saveFile: bridge.saveFile,
    library: bridge.library,
    blocks: bridge.blocks,
    window: bridge.frame === 'native' ? null : bridge.window,
    setDocument: bridge.setDocument,
    onCloseRequest: bridge.onCloseRequest,
    onOpenFile: bridge.onOpenFile,
  };
}
