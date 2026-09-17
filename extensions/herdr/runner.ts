/** Maximum combined stdout/stderr bytes retained from one Herdr invocation. */
export const MAX_OUTPUT_BYTES = 20_000;
export const OUTPUT_TRUNCATED_SUFFIX = "\n[output truncated]";

export interface HerdrRunResult {
  readonly exitCode: number;
  readonly output: string;
  readonly truncated: boolean;
}

/** Injectable typed-operation seam. Production wiring remains tool-private. */
export type HerdrRunner = (
  argv: readonly string[],
  signal?: AbortSignal,
) => Promise<HerdrRunResult>;

function utf8Prefix(bytes: Buffer, byteLimit: number): string {
  let end = Math.min(bytes.byteLength, byteLimit);
  while (
    end > 0 &&
    end < bytes.byteLength &&
    (bytes[end] & 0b1100_0000) === 0b1000_0000
  ) {
    end -= 1;
  }
  return bytes.toString("utf8", 0, end);
}

export function boundedHerdrOutput(
  chunks: readonly Buffer[],
  wasTruncated = false,
): Pick<HerdrRunResult, "output" | "truncated"> {
  const bytes = Buffer.concat(chunks);
  const truncated = wasTruncated || bytes.byteLength > MAX_OUTPUT_BYTES;
  const suffix = truncated ? OUTPUT_TRUNCATED_SUFFIX : "";
  return {
    output:
      utf8Prefix(bytes, MAX_OUTPUT_BYTES - Buffer.byteLength(suffix, "utf8")) +
      suffix,
    truncated,
  };
}
