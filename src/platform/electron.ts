import type { Platform } from './api';
import type { Hadji } from './index';

export function electronPlatform(bridge: Hadji): Platform {
  return {
    kind: 'electron',
    openFile: bridge.openFile,
    saveFile: bridge.saveFile,
    chooseFolder: bridge.chooseFolder,
    library: bridge.library,
    blocks: bridge.blocks,
    window: bridge.frame === 'native' ? null : bridge.window,
    updates: bridge.updates,
    setDocument: bridge.setDocument,
    onCloseRequest: bridge.onCloseRequest,
    onOpenFile: bridge.onOpenFile,
  };
}
