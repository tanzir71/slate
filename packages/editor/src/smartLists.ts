import { isolateHistory } from "@codemirror/commands";
import {
  deleteMarkupBackward,
  insertNewlineContinueMarkup,
} from "@codemirror/lang-markdown";
import {
  countColumn,
  Prec,
  type ChangeSpec,
  type EditorState,
  type Extension,
  type StateCommand,
  type Transaction,
} from "@codemirror/state";
import { keymap, type EditorView } from "@codemirror/view";
import {
  itemBounds,
  itemMarker,
  listItemAt,
  quoteDepth,
  quotePrefix,
  selectedList,
  type MarkdownNode,
} from "./listStructure.js";

export interface SmartListOptions {
  continuation?: boolean;
  indent?: boolean;
  move?: boolean;
}

interface ListEdit {
  from: number;
  to: number;
  insert: string;
}

function dispatchList(view: EditorView, transaction: Transaction) {
  const continuation: ChangeSpec[] = [];
  transaction.changes.iterChanges((from, to, _nextFrom, _nextTo, inserted) => {
    const text = inserted.toString();
    if (!/^\d+$/.test(text)) return;
    const item = listItemAt(view.state, from);
    const marker = item && itemMarker(view.state, item);
    if (
      !item ||
      marker?.number === undefined ||
      marker.from !== from ||
      marker.to - 1 !== to
    )
      return;
    for (const change of shiftContinuation(
      view.state,
      item,
      text.length - (to - from),
    )) {
      // These edits only touch existing child-line whitespace, never the marker.
      continuation.push({
        ...change,
        from: transaction.changes.mapPos(change.from, 1),
        to: transaction.changes.mapPos(change.to, 1),
      });
    }
  });
  const alignment = transaction.state.changes(continuation);
  view.dispatch({
    changes: transaction.changes.compose(alignment),
    selection: transaction.newSelection.map(alignment),
    effects: transaction.effects,
    annotations: isolateHistory.of("full"),
    userEvent: "input.list",
    scrollIntoView: true,
  });
}

function isolatedMarkup(command: StateCommand, view: EditorView) {
  if (view.state.readOnly) return false;
  return command({
    state: view.state,
    dispatch: (transaction) => dispatchList(view, transaction),
  });
}

function renumber(
  state: EditorState,
  list: MarkdownNode | undefined,
  start?: number,
): ChangeSpec[] {
  if (list?.name !== "OrderedList") return [];
  const items = list.getChildren("ListItem");
  if (!items.length) return [];
  const first = start ?? itemMarker(state, items[0]!)?.number;
  if (first === undefined || first + items.length - 1 > 999_999_999) return [];
  return items.flatMap((item, index) => {
    const mark = itemMarker(state, item);
    if (mark?.number === undefined || mark.number === first + index) return [];
    const insert = String(first + index);
    return [
      { from: mark.from, to: mark.to - 1, insert },
      ...shiftContinuation(
        state,
        item,
        insert.length - (mark.to - mark.from - 1),
      ),
    ];
  });
}

/** Counter-width changes must keep child blocks aligned beneath their parent. */
function shiftContinuation(
  state: EditorState,
  item: MarkdownNode,
  columns: number,
): ListEdit[] {
  if (!columns) return [];
  const edits: ListEdit[] = [];
  const end = state.doc.lineAt(itemBounds(state, item).to).number;
  const depth = quoteDepth(item);
  for (
    let number = state.doc.lineAt(item.from).number + 1;
    number <= end;
    number++
  ) {
    const line = state.doc.line(number);
    const prefix = quotePrefix(line.text, depth) ?? "";
    const rest = line.text.slice(prefix.length);
    if (!rest.trim()) continue;
    const from = line.from + prefix.length;
    const edit =
      columns > 0
        ? { remove: 0, insert: " ".repeat(columns) }
        : removeColumns(
            /^[ \t]*/.exec(rest)![0],
            -columns,
            countColumn(prefix, state.tabSize),
            state.tabSize,
          );
    edits.push({ from, to: from + edit.remove, insert: edit.insert });
  }
  return edits;
}

function finish(
  view: EditorView,
  intermediate: Transaction,
  counters: ChangeSpec[],
) {
  const numbers = intermediate.state.changes(counters);
  view.dispatch({
    changes: intermediate.changes.compose(numbers),
    selection: intermediate.newSelection.map(numbers),
    annotations: isolateHistory.of("full"),
    userEvent: "input.list",
    scrollIntoView: true,
  });
}

/** Move whole sibling items, including their descendant blocks, in one transaction. */
export function moveEditorListItem(
  view: EditorView,
  direction: -1 | 1,
): boolean {
  if (view.state.readOnly) return false;
  const state = view.state;
  const context = selectedList(state);
  if (!context) return false;
  const neighbour =
    context.siblings[direction < 0 ? context.first - 1 : context.last + 1];
  if (!neighbour) return true;
  const selected = {
    from: itemBounds(state, context.siblings[context.first]!).from,
    to: itemBounds(state, context.siblings[context.last]!).to,
  };
  const other = itemBounds(state, neighbour);
  const from = Math.min(selected.from, other.from),
    to = Math.max(selected.to, other.to);
  const gap = state.sliceDoc(
    direction < 0 ? other.to : selected.to,
    direction < 0 ? selected.from : other.from,
  );
  const before = state.sliceDoc(selected.from, selected.to),
    adjacent = state.sliceDoc(other.from, other.to);
  const insert =
    direction < 0 ? before + gap + adjacent : adjacent + gap + before;
  const delta =
    direction < 0 ? other.from - selected.from : adjacent.length + gap.length;
  const transaction = state.update({
    changes: { from, to, insert },
    selection: {
      anchor: state.selection.main.anchor + delta,
      head: state.selection.main.head + delta,
    },
  });
  const list =
    listItemAt(transaction.state, transaction.newSelection.main.head)?.parent ??
    undefined;
  finish(
    view,
    transaction,
    renumber(
      transaction.state,
      list,
      itemMarker(state, context.siblings[0]!)?.number,
    ),
  );
  return true;
}

function removeColumns(
  indent: string,
  columns: number,
  column: number,
  tabSize: number,
) {
  const width = countColumn(" ".repeat(column) + indent, tabSize) - column;
  let index = 0,
    removed = 0;
  while (index < indent.length && removed < columns) {
    removed +=
      indent[index] === "\t" ? tabSize - ((column + removed) % tabSize) : 1;
    index++;
  }
  return {
    remove: index,
    insert: " ".repeat(Math.max(0, removed - Math.min(columns, width))),
  };
}

/** Indent a selected item group with its children; top-level Shift-Tab escapes. */
export function indentEditorListItem(
  view: EditorView,
  direction: -1 | 1,
): boolean {
  if (view.state.readOnly) return false;
  const state = view.state,
    context = selectedList(state);
  if (!context) return false;
  const first = context.siblings[context.first]!,
    last = context.siblings[context.last]!;
  const parent =
    context.list.parent?.name === "ListItem" ? context.list.parent : undefined;
  const outerList = parent?.parent;
  const outerStart = outerList?.getChild("ListItem");
  const target = direction > 0 ? context.siblings[context.first - 1] : parent;
  if (!target) return false;
  const marker = itemMarker(state, first),
    targetMarker = itemMarker(state, target);
  if (!marker || !targetMarker) return false;
  const columns =
    direction > 0
      ? targetMarker.contentColumn - marker.column
      : marker.column - targetMarker.column;
  if (columns <= 0) return false;
  const bounds = {
    from: itemBounds(state, first).from,
    to: itemBounds(state, last).to,
  };
  const depth = quoteDepth(context.list),
    originalPrefix =
      quotePrefix(state.doc.lineAt(first.from).text, depth) ?? "";
  const changes: ChangeSpec[] = [];
  for (
    let number = state.doc.lineAt(bounds.from).number;
    number <= state.doc.lineAt(bounds.to).number;
    number++
  ) {
    const line = state.doc.line(number);
    const prefix = quotePrefix(line.text, depth);
    const rest = line.text.slice(prefix?.length ?? 0);
    if (!rest.trim()) continue;
    const from = line.from + (prefix?.length ?? 0);
    if (direction > 0)
      changes.push({
        from,
        insert:
          (prefix === undefined ? originalPrefix : "") + " ".repeat(columns),
      });
    else {
      const indent = /^[ \t]*/.exec(rest)![0];
      const edit = removeColumns(
        indent,
        columns,
        countColumn(prefix ?? "", state.tabSize),
        state.tabSize,
      );
      changes.push({
        from,
        to: from + edit.remove,
        insert: (prefix === undefined ? originalPrefix : "") + edit.insert,
      });
    }
  }
  const transaction = state.update({ changes });
  const changed = transaction.state;
  const moved = listItemAt(changed, transaction.changes.mapPos(marker.from, 1));
  const destination = moved?.parent ?? undefined;
  const remaining = context.siblings.find(
    (_, index) => index < context.first || index > context.last,
  );
  const original = remaining
    ? (listItemAt(
        changed,
        transaction.changes.mapPos(itemMarker(state, remaining)!.from, 1),
      )?.parent ?? undefined)
    : undefined;
  const counters = renumber(
    changed,
    destination,
    direction > 0 && destination?.from === moved?.from
      ? 1
      : direction < 0 && outerStart && outerList?.name === destination?.name
        ? itemMarker(state, outerStart)?.number
        : undefined,
  );
  if (original && original.from !== destination?.from)
    counters.push(
      ...renumber(
        changed,
        original,
        itemMarker(state, context.siblings[0]!)?.number,
      ),
    );
  finish(view, transaction, counters);
  return true;
}

export function createSmartListBindings(
  options: SmartListOptions = {},
): Extension {
  return Prec.high(
    keymap.of([
      {
        key: "Enter",
        run: (view) =>
          options.continuation !== false &&
          isolatedMarkup(insertNewlineContinueMarkup, view),
      },
      {
        key: "Backspace",
        run: (view) =>
          options.continuation !== false &&
          isolatedMarkup(deleteMarkupBackward, view),
      },
      {
        key: "Tab",
        run: (view) =>
          options.indent !== false && indentEditorListItem(view, 1),
      },
      {
        key: "Shift-Tab",
        run: (view) =>
          options.indent !== false && indentEditorListItem(view, -1),
      },
      {
        key: "Alt-ArrowUp",
        run: (view) => options.move !== false && moveEditorListItem(view, -1),
      },
      {
        key: "Alt-ArrowDown",
        run: (view) => options.move !== false && moveEditorListItem(view, 1),
      },
    ]),
  );
}
