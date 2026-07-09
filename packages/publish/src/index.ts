export type PublishProvider = "wordpress" | "ghost" | "static";
export type PublishVisibility = "draft" | "private" | "public";

export interface PublishDocument {
  title: string;
  html: string;
  markdown?: string;
  excerpt?: string;
  tags?: string[];
  canonicalPath?: string;
}

export interface PublishTarget {
  id?: string;
  name?: string;
  endpoint?: string;
  authRef?: string;
}

export interface PublishRequest {
  provider: PublishProvider;
  document: PublishDocument;
  visibility: PublishVisibility;
  target?: PublishTarget;
  slug?: string;
}

export interface PublishResult {
  provider: PublishProvider;
  remoteId: string;
  status: PublishVisibility;
  title: string;
  url: string;
  warnings: string[];
}

export interface PublishAdapter {
  provider: PublishProvider;
  publish(request: PublishRequest): Promise<PublishResult>;
}

export interface PublishRegistry {
  providers(): PublishProvider[];
  publish(request: PublishRequest): Promise<PublishResult>;
}

export interface StaticPublishAdapterOptions {
  baseUrl: string;
}

export function createPublishRegistry(adapters: PublishAdapter[]): PublishRegistry {
  const byProvider = new Map<PublishProvider, PublishAdapter>();

  for (const adapter of adapters) {
    if (byProvider.has(adapter.provider)) {
      throw new Error(`Duplicate publish adapter registered for ${adapter.provider}`);
    }
    byProvider.set(adapter.provider, adapter);
  }

  return {
    providers() {
      return Array.from(byProvider.keys()).sort();
    },
    async publish(request) {
      const adapter = byProvider.get(request.provider);
      if (!adapter) {
        throw new Error(`No publish adapter registered for ${request.provider}`);
      }
      return adapter.publish(request);
    }
  };
}

export function createStaticPublishAdapter({ baseUrl }: StaticPublishAdapterOptions): PublishAdapter {
  return {
    provider: "static",
    async publish(request) {
      const slug = request.slug ?? slugify(request.document.title);
      return {
        provider: "static",
        remoteId: `static:${slug}`,
        status: request.visibility,
        title: request.document.title,
        url: `${baseUrl.replace(/\/+$/, "")}/${slug}`,
        warnings: []
      };
    }
  };
}

function slugify(title: string): string {
  return (
    title
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "untitled"
  );
}
