declare module "*.wasm?url" { const url: string; export default url; }

declare module "@journeyapps/wa-sqlite/src/examples/OPFSCoopSyncVFS.js" {
  export class OPFSCoopSyncVFS {
    readonly name: string;
    static create(name: string, module: unknown): Promise<OPFSCoopSyncVFS>;
    close(): Promise<void>;
  }
}
