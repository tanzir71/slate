import { expect, it, vi } from "vitest";
import { lint, readTidyConfiguration } from "@slate/core/tidy";
import {
  createTidyWorkerClient,
  type TidyWorker,
} from "../src/tidy/tidyWorkerClient";
import {
  runTidyRequest,
  type TidyWorkerReply,
  type TidyWorkerRequest,
} from "../src/tidy/tidyWorkerProtocol";

const configuration = readTidyConfiguration();
class WorkerFixture implements TidyWorker {
  readonly requests: TidyWorkerRequest[] = [];
  onmessage: TidyWorker["onmessage"] = null;
  onerror: TidyWorker["onerror"] = null;
  postMessage = vi.fn((request: TidyWorkerRequest) => {
    this.requests.push(request);
  });
  terminate = vi.fn();
  reply(data: TidyWorkerReply) {
    this.onmessage?.(new MessageEvent("message", { data }));
  }
  finish(index: number) {
    this.reply(runTidyRequest(this.requests[index]!));
  }
}

it("runs source-bound lint and selected fixes as worker proposals without changing the input", async () => {
  const worker = new WorkerFixture(),
    client = createTidyWorkerClient(worker);
  const source = "#   Draft";
  const report = client.lint(source, configuration);
  expect(worker.requests).toHaveLength(1);
  worker.finish(0);
  expect(await report).toEqual(lint(source, configuration));
  const selected = client.fix(source, configuration, []);
  expect(worker.requests[1]).toMatchObject({
    kind: "fix",
    source,
    issueIds: [],
  });
  worker.finish(1);
  expect(await selected).toMatchObject({ source, output: source, changes: [] });
  const fixed = client.fix(source, configuration);
  worker.finish(2);
  expect(await fixed).toMatchObject({ source, output: "# Draft\n" });
  client.close();
});

it("bounds continuous edits to one active computation and one latest queued snapshot", async () => {
  const worker = new WorkerFixture(),
    client = createTidyWorkerClient(worker);
  const first = client
    .lint("first", configuration)
    .catch((error: unknown) => error);
  const second = client
    .lint("second", configuration)
    .catch((error: unknown) => error);
  const latest = client.lint("latest", configuration);
  expect(worker.requests.map((request) => request.source)).toEqual(["first"]);
  expect(await first).toMatchObject({ name: "AbortError" });
  expect(await second).toMatchObject({ name: "AbortError" });
  worker.finish(0);
  expect(worker.requests.map((request) => request.source)).toEqual([
    "first",
    "latest",
  ]);
  worker.finish(1);
  expect((await latest).source).toBe("latest");
  client.close();
});

it("cancels an obsolete source, ignores late replies and resumes only the latest work", async () => {
  const worker = new WorkerFixture(),
    client = createTidyWorkerClient(worker);
  const old = client
    .fix("#   Old", configuration)
    .catch((error: unknown) => error);
  client.cancel();
  expect(await old).toMatchObject({ name: "AbortError" });
  const current = client.lint("# Current\n", configuration);
  worker.reply({ id: 999, kind: "error", message: "Unrelated old reply" });
  expect(worker.requests).toHaveLength(1);
  worker.finish(0);
  expect(worker.requests[1]?.source).toBe("# Current\n");
  worker.finish(1);
  expect((await current).source).toBe("# Current\n");
  client.close();
});

it.each(["source", "operation"] as const)(
  "rejects a mismatched %s instead of accepting a different proposal",
  async (mismatch) => {
    const worker = new WorkerFixture(),
      client = createTidyWorkerClient(worker);
    const result = client.lint("current", configuration);
    const request = worker.requests[0]!;
    worker.reply(
      runTidyRequest({
        ...request,
        ...(mismatch === "source"
          ? { source: "other" }
          : { kind: "fix" as const }),
      }),
    );
    await expect(result).rejects.toThrow("different sheet snapshot");
    const retry = client.lint("current", configuration);
    worker.finish(1);
    expect((await retry).source).toBe("current");
    client.close();
  },
);

it("reports an operation error without losing the next explicit request", async () => {
  const worker = new WorkerFixture(),
    client = createTidyWorkerClient(worker);
  const result = client.lint("current", configuration);
  worker.reply({
    id: worker.requests[0]!.id,
    kind: "error",
    message: "Invalid Tidy configuration",
  });
  await expect(result).rejects.toThrow("Invalid Tidy configuration");
  const retry = client.lint("current", configuration);
  worker.finish(1);
  expect((await retry).source).toBe("current");
  client.close();
});

it.each(["post", "worker"] as const)(
  "rejects work and shuts down after a %s failure",
  async (failure) => {
    const worker = new WorkerFixture();
    if (failure === "post")
      worker.postMessage.mockImplementationOnce(() => {
        throw new Error("Cannot clone");
      });
    const client = createTidyWorkerClient(worker);
    const first = client
      .lint("first", configuration)
      .catch((error: unknown) => error);
    const second =
      failure === "worker"
        ? client.lint("second", configuration).catch((error: unknown) => error)
        : undefined;
    if (failure === "worker") {
      const event = new ErrorEvent("error", { cancelable: true });
      worker.onerror?.(event);
      expect(event.defaultPrevented).toBe(true);
    }
    if (failure === "worker")
      expect(await first).toMatchObject({ name: "AbortError" });
    else expect(await first).toBeInstanceOf(Error);
    if (second) expect(await second).toBeInstanceOf(Error);
    await expect(client.lint("later", configuration)).rejects.toThrow(
      "unavailable",
    );
    expect(worker.terminate).toHaveBeenCalledTimes(1);
    expect(worker.onmessage).toBeNull();
    expect(worker.onerror).toBeNull();
    client.close();
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  },
);

it("closes pending work and rejects later requests without a main-thread fallback", async () => {
  const unavailable = createTidyWorkerClient(undefined);
  await expect(unavailable.fix("#   Words", configuration)).rejects.toThrow(
    "unavailable",
  );
  const worker = new WorkerFixture(),
    client = createTidyWorkerClient(worker);
  const first = client
    .lint("first", configuration)
    .catch((error: unknown) => error);
  const second = client
    .lint("second", configuration)
    .catch((error: unknown) => error);
  const late = worker.onmessage;
  client.close();
  expect(await first).toMatchObject({ name: "AbortError" });
  expect(await second).toMatchObject({ name: "AbortError" });
  late?.(
    new MessageEvent("message", { data: runTidyRequest(worker.requests[0]!) }),
  );
  expect(worker.requests).toHaveLength(1);
  expect(worker.terminate).toHaveBeenCalledTimes(1);
  await expect(client.lint("later", configuration)).rejects.toThrow(
    "unavailable",
  );
});

it("keeps processing errors inside the worker and records computation time separately", () => {
  const times = [10, 14];
  const request: TidyWorkerRequest = {
    id: 7,
    kind: "lint",
    source: "# Draft\n",
    configuration,
  };
  expect(runTidyRequest(request, () => times.shift()!)).toMatchObject({
    id: 7,
    kind: "lint",
    elapsedMs: 4,
  });
  const broken = {
    ...configuration,
    get rules(): Readonly<Record<string, unknown>> {
      throw new Error("Rules unavailable");
    },
  };
  expect(runTidyRequest({ ...request, configuration: broken })).toEqual({
    id: 7,
    kind: "error",
    message: "Rules unavailable",
  });
});
