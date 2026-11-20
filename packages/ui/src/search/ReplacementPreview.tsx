import { useState } from "react";
import type { ReplaceBatchRow } from "@slate/storage/replace-batch";

export const replacementSelectable = (row: ReplaceBatchRow) => row.status === "ready" || row.status === "failed";
function status(row: ReplaceBatchRow) {
  if (row.status === "ready" || row.status === "failed") return `${row.replacements} ${row.replacements === 1 ? "replacement" : "replacements"}${row.status === "failed" ? " · Not applied" : ""}`;
  return ({ unchanged: "No changes needed", unmatched: "No matches", unsupported: "Unsupported text encoding", unavailable: "Unavailable",
    conflict: "Changed since preview", applied: "Applied", undone: "Undone", "undo-failed": "Undo needs attention" } as const)[row.status];
}
function PreviewRow({ row, chosen, disabled, onToggle }: { row: ReplaceBatchRow; chosen: boolean; disabled: boolean; onToggle(): void }) {
  const [expanded, setExpanded] = useState(false), [full, setFull] = useState(false);
  const before = row.before ?? "", after = row.after ?? "", clipped = !full && Math.max(before.length, after.length) > 20_000;
  return <li className="replacementRow">
    <label><input type="checkbox" checked={chosen} disabled={disabled || !replacementSelectable(row)} onChange={onToggle} /><strong>{row.path}</strong><span>{status(row)}</span></label>
    {row.error && <p className="replacementError">{row.error}</p>}
    {row.before !== undefined && <>
      <button type="button" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>Review changes in {row.path}</button>
      {expanded && <><div className="replacementComparison"><section><h4>Before</h4><pre>{clipped ? before.slice(0, 20_000) : before}</pre></section><section><h4>After</h4><pre>{clipped ? after.slice(0, 20_000) : after}</pre></section></div>
        {clipped && <p>Showing the first 20,000 characters. <button type="button" onClick={() => setFull(true)}>Show full preview for {row.path}</button></p>}</>}
    </>}
  </li>;
}
export function ReplacementPreview({ rows, chosen, disabled, onToggle, onAll }: {
  rows: readonly ReplaceBatchRow[]; chosen: ReadonlySet<string>; disabled: boolean;
  onToggle(path: string): void; onAll(checked: boolean): void;
}) {
  const [limit, setLimit] = useState(50);
  const visible = rows.filter((row) => row.status !== "unmatched");
  const selectable = visible.filter(replacementSelectable);
  return <section className="replacementPreview" aria-label="Replacement preview"><h3>Preview replacements</h3>
    <p>Review the changes, then apply only the selected sheets. Originals are kept for Undo.</p>
    {!!selectable.length && <label className="replacementSelectAll"><input type="checkbox" disabled={disabled} checked={selectable.every((row) => chosen.has(row.path))} onChange={(event) => onAll(event.target.checked)} />Select all matching sheets</label>}
    {!visible.length ? <p>No text matches need replacing.</p> : <ul>{visible.slice(0, limit).map((row) => <PreviewRow key={row.path} row={row} chosen={chosen.has(row.path)} disabled={disabled} onToggle={() => onToggle(row.path)} />)}</ul>}
    {visible.length > limit && <button type="button" onClick={() => setLimit((value) => value + 50)}>Show more sheets ({visible.length - limit} remaining)</button>}
  </section>;
}
