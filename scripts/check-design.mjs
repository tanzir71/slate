import { checkThemeContrast } from "../packages/tokens/src/themes.ts";

const failures = checkThemeContrast();
if (failures.length) {
  for (const failure of failures) console.error(`${failure.mode}: ${failure.foreground} on ${failure.background} has contrast ${failure.ratio.toFixed(2)}:1; required >= 4.5:1`);
  process.exit(1);
}
console.log("Light/Dark text contrast passes WCAG AA for all required token pairs.");
