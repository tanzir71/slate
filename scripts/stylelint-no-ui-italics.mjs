import stylelint from "stylelint";

const ruleName = "slate/no-ui-italics";
const messages = stylelint.utils.ruleMessages(ruleName, { rejected: "Use weight or color for UI emphasis; italics belong only to user documents" });

function isDocumentStyle(node) {
  for (let parent = node.parent; parent; parent = parent.parent) {
    // A face declaration makes real user emphasis available; it does not italicize chrome.
    if (parent.type === "atrule" && parent.name.toLowerCase() === "font-face") return true;
    if (parent.type === "rule" && parent.selectors.every((selector) => /(?:^|\s)\.(?:cm-content|read-view)(?=[\s.#:[>]|$)/.test(selector) && !/[+~]/.test(selector))) return true;
  }
  return false;
}

/** @type {import('stylelint').Rule} */
const rule = (primary) => (root, result) => {
  if (!stylelint.utils.validateOptions(result, ruleName, { actual: primary, possible: [true] })) return;
  root.walkDecls(/^(?:font|font-style)$/i, (declaration) => {
    if (!/(?:^|\s)(?:italic|oblique)(?:\s|$)/i.test(declaration.value) || isDocumentStyle(declaration)) return;
    stylelint.utils.report({ ruleName, result, node: declaration, message: messages.rejected, word: declaration.value });
  });
};
rule.ruleName = ruleName;
rule.messages = messages;
export default stylelint.createPlugin(ruleName, rule);
