/** An unavailable native selection stays pending for the caller's existing poll. */
export function nativeCaretDistance(element: Element): number {
    const selection = getSelection(); if (!selection?.rangeCount || !element.contains(selection.anchorNode)) return Infinity;
    const range = selection.getRangeAt(0).cloneRange(); let rect = range.getBoundingClientRect();
    if (!rect.height && range.startContainer.nodeType === Node.TEXT_NODE && range.startOffset) {
      range.setStart(range.startContainer, range.startOffset - 1); rect = range.getBoundingClientRect();
    }
    if (!rect.height && range.startContainer.nodeType === Node.ELEMENT_NODE) {
      // Firefox/WebKit can place the native caret after a text child on its parent.
      const before = range.startOffset > 0;
      let adjacent = range.startContainer.childNodes[before ? range.startOffset - 1 : 0];
      while (adjacent && adjacent.nodeType !== Node.TEXT_NODE) adjacent = (before ? adjacent.lastChild : adjacent.firstChild) ?? undefined;
      const length = adjacent?.textContent?.length ?? 0;
      if (adjacent && length) {
        range.setStart(adjacent, before ? length - 1 : 0); range.setEnd(adjacent, before ? length : 1);
        rect = range.getBoundingClientRect();
      }
    }
    if (!rect.height) {
      const node = range.startContainer, line = (node instanceof Element ? node : node.parentElement)?.closest(".cm-line");
      if (line?.textContent === "") rect = line.getBoundingClientRect();
    }
    if (!rect.height) throw Error("The native caret has no measurable line rectangle");
    const scroller = element.closest(".cm-scroller")!;
    return Math.abs((rect.top + rect.bottom) / 2 - scroller.getBoundingClientRect().top - scroller.clientHeight * .45);
  }
