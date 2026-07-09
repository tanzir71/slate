declare module "wa-sqlite/src/examples/OriginPrivateFileSystemVFS.js" {
  import * as VFS from "wa-sqlite/src/VFS.js";

  export class OriginPrivateFileSystemVFS extends VFS.Base {
    readonly name: string;
    close(): Promise<void>;
  }
}
