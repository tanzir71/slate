import { expect, test } from "./fixtures";
import { createSheet, openLibrary, readCurrentSheet } from "./helpers";
import type {
  TidyWorkerReply,
  TidyWorkerRequest,
} from "../packages/ui/src/tidy/tidyWorkerProtocol";

test("the real worker processes every 50k-word reference document in under 150 ms", async ({
  page,
}, testInfo) => {
  const workers: string[] = [];
  page.on("worker", (worker) => workers.push(worker.url()));
  await openLibrary(page);
  const original = "Keep these words.\n";
  await createSheet(page, original);
  await expect(
    page.getByRole("button", { name: "Tidy review", exact: true }),
  ).toHaveText(/^Tidy · \d+$/);
  const url = workers.find((url) => /tidy\.worker/.test(url));
  expect(url).toBeDefined();
  const words = Array.from({ length: 100 }, (_, index) => `word${index}`).join(
    " ",
  );
  const flat = Array(500).fill(words).join(" ") + "\n";
  const cases = [
    { name: "flat-lint-cold", kind: "lint" as const, source: flat },
    {
      name: "dirty-flat-fix",
      kind: "fix" as const,
      source: "  #   Draft\n\n" + flat,
      expected: "# Draft\n\n" + flat,
    },
    {
      name: "paragraph-lint",
      kind: "lint" as const,
      source: Array(500).fill(words).join("\n\n") + "\n",
    },
    {
      name: "dense-list-fix",
      kind: "fix" as const,
      source:
        Array(5000)
          .fill("+ one two three four five six seven eight nine ten")
          .join("\n") + "\n",
      expected:
        Array(5000)
          .fill("- one two three four five six seven eight nine ten")
          .join("\n") + "\n",
    },
  ];
  const measurements = await page.evaluate(
    async ({ url, cases }) => {
      const coldStarted = performance.now();
      const worker = new Worker(url, { type: "module" });
      try {
        const measured = [];
        for (const [index, item] of cases.entries()) {
          const request: TidyWorkerRequest = {
            id: index + 1,
            kind: item.kind,
            source: item.source,
            configuration: {
              version: 1,
              preset: "slate",
              rules: {},
              keepHardBreaks: true,
              onSave: false,
            },
          };
          const started = index === 0 ? coldStarted : performance.now();
          const reply = await new Promise<TidyWorkerReply>(
            (resolve, reject) => {
              const timeout = setTimeout(
                () => reject(new Error("Tidy worker request timed out.")),
                30_000,
              );
              worker.onmessage = (event: MessageEvent<TidyWorkerReply>) => {
                clearTimeout(timeout);
                resolve(event.data);
              };
              worker.onerror = (event) => {
                clearTimeout(timeout);
                reject(new Error(event.message));
              };
              worker.postMessage(request);
            },
          );
          const roundtripMs = performance.now() - started;
          if (reply.kind === "error") throw new Error(reply.message);
          measured.push({
            name: item.name,
            roundtripMs,
            cpuMs: reply.elapsedMs,
            bound:
              reply.id === request.id &&
              reply.kind === request.kind &&
              (reply.kind === "lint"
                ? reply.report.source
                : reply.result.source) === item.source,
            outputCorrect:
              reply.kind === "lint"
                ? reply.report.issues.length === 0
                : reply.result.output === item.expected &&
                  reply.result.rejected.length === 0,
          });
        }
        return measured;
      } finally {
        worker.terminate();
      }
    },
    { url: url!, cases },
  );
  console.log(
    `Tidy worker (${testInfo.project.name}): ${JSON.stringify(measurements)}`,
  );
  await testInfo.attach("tidy-worker-measurements", {
    body: JSON.stringify(measurements, null, 2),
    contentType: "application/json",
  });
  expect(await readCurrentSheet(page)).toBe(original);
  for (const measurement of measurements) {
    expect(measurement.bound, measurement.name).toBe(true);
    expect(measurement.outputCorrect, measurement.name).toBe(true);
  }
  for (const measurement of measurements)
    expect
      .soft(
        measurement.roundtripMs,
        `${measurement.name}: request through reply, including worker startup for the first document`,
      )
      .toBeLessThan(150);
});
