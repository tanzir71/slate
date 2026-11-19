import "./tidy.css";

export function TidyIcon({
  name,
}: {
  name: "wand" | "apply" | "diff" | "close" | "chevron";
}) {
  return <span className={`tidyIcon tidyIcon--${name}`} aria-hidden="true" />;
}
