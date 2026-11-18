import { ulid } from "ulid";
import type { TemplateContext } from "@slate/core";

/** Capture ambient values once; changing a form field must not change its date or ID. */
export function captureTemplateContext(
  space: string,
  notebook: string,
  selection: string,
  now = new Date(),
): TemplateContext {
  const two = (number: number) => String(number).padStart(2, "0");
  return {
    id: ulid(now.getTime()),
    space,
    notebook,
    selection,
    clipboard: "",
    clock: {
      date: [
        now.getFullYear(),
        two(now.getMonth() + 1),
        two(now.getDate()),
      ].join("-"),
      time: [
        two(now.getHours()),
        two(now.getMinutes()),
        two(now.getSeconds()),
      ].join(":"),
      offsetMinutes: -now.getTimezoneOffset(),
    },
  };
}
