import { useEffect, useRef, useState } from "react";
import { matchCommand, onboardingPresets, type OnboardingPresetId } from "@slate/core";
import { commandShortcut, keyboardInput, readKeymap, shortcutOS } from "../commands";
import { WindowDragRegion, WindowTitleBar, type WindowChrome } from "../browser/WindowTitleBar";
import { WorkspaceDialog } from "../browser/WorkspaceDialog";
import { NativeNewSpaceForm } from "./NativeNewSpaceForm";
import { nativeWelcome } from "./nativeWelcome";
import type { NativeSpace, NativeSpaceCatalog } from "./nativeSpaces";
import "./nativeOnboarding.css";

type Choice = "folder" | "new" | "import";
type Icon = "logo" | "minus" | "square" | "close" | "folder" | "sparkles" | "download" | "feather" | "code" | "flask" | "book" | "check" | "lock" | "drive";
function Asset({ icon, slot }: { icon: Icon; slot: string }) { return <span className="nativeOnboardingAsset" data-icon={icon} data-asset-slot={slot} aria-hidden="true" />; }
const choices: readonly { id: Choice; title: string; description: string; hint: string; icon: Icon }[] = [
  { id: "folder", title: "Open a folder", description: "Any folder of .md files. Obsidian vaults, iA Writer libraries and Git repos work as they are.", hint: "", icon: "folder" },
  { id: "new", title: "Start a new Space", description: "Creates a folder in Documents with a short welcome sheet that teaches the shortcuts.", hint: "~/Documents/Slate/Personal", icon: "sparkles" },
  { id: "import", title: "Import from another app", description: "Bear, Notion, Ulysses, Evernote or Apple Notes exports become clean Markdown files.", hint: "Nothing is uploaded", icon: "download" },
];
const presetIcons: Record<OnboardingPresetId, Icon> = { writer: "feather", developer: "code", researcher: "flask", student: "book", minimal: "minus" };

export function NativeOnboarding({ catalog, windowChrome, onOpen, onSkip, windowError = "" }: {
  catalog: Pick<NativeSpaceCatalog, "pick" | "create">;
  windowChrome: false | WindowChrome;
  onOpen(space: NativeSpace, preset: OnboardingPresetId, importNotes: boolean): Promise<void>;
  onSkip(): Promise<void>;
  windowError?: string;
}) {
  const [choice, setChoice] = useState<Choice>("new"), [preset, setPreset] = useState<OnboardingPresetId>("writer");
  const [flow, setFlow] = useState<"new" | "import">(), [created, setCreated] = useState<NativeSpace>();
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const locked = useRef(false), alive = useRef(true);
  const os = shortcutOS(), keymap = readKeymap(undefined, os, "desktop");
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  async function run(work: () => Promise<void>) {
    if (locked.current) return; locked.current = true; setBusy(true); setError("");
    try { await work(); } catch (cause) { if (alive.current) setError(cause instanceof Error ? cause.message : "Your Space could not be opened. Your files were kept."); }
    finally { locked.current = false; if (alive.current) setBusy(false); }
  }
  function proceed(target = choice) {
    if (locked.current) return;
    if (target !== "folder") { setFlow(target); setError(""); return; }
    void run(async () => { const selected = await catalog.pick(); if (selected && alive.current) await onOpen(selected, preset, false); });
  }
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if (event.defaultPrevented || document.querySelector("dialog[open]")) return;
      if (matchCommand(keymap.bindings, keyboardInput(event), { editor: false, selection: false }) !== "space.openFolder") return;
      event.preventDefault(); setChoice("folder"); proceed("folder");
    };
    window.addEventListener("keydown", listener); return () => window.removeEventListener("keydown", listener);
  });
  const create = (name: string) => { void run(async () => {
    const space = created ?? await catalog.create(name, nativeWelcome(os));
    if (!alive.current) return;
    setCreated(space); await onOpen(space, preset, flow === "import");
  }); };
  const back = () => { if (!locked.current) { setFlow(undefined); setCreated(undefined); setError(""); } };
  return <div className="browserSlate nativeOnboardingShell">
    <WindowTitleBar windowControls={windowChrome} controlIcons={{ minimize: <Asset icon="minus" slot="window-minimize" />, maximize: <Asset icon="square" slot="window-maximize" />, close: <Asset icon="close" slot="window-close" /> }}>
      <span className="nativeStartupTitle">Welcome to Slate</span><WindowDragRegion windowControls={windowChrome} />
    </WindowTitleBar>
    <main className="nativeOnboardingStage">
      <div className="nativeOnboardingContent">
        <div className="nativeOnboardingBrand"><span className="nativeOnboardingLogo"><Asset icon="logo" slot="brand" /></span><span>Slate</span></div>
        <div className="nativeOnboardingIntro"><h1>Where should your writing live?</h1><p>Slate edits plain Markdown files in folders you choose. Point it at a folder you already have, or start fresh — you can add more Spaces any time.</p></div>
        <fieldset className="nativeOnboardingChoices" disabled={busy}><legend className="visuallyHidden">Where your writing lives</legend>{choices.map(item => <label key={item.id} className="nativeOnboardingChoice" data-selected={choice === item.id}>
          <input className="visuallyHidden" type="radio" name="nativeDestination" aria-label={item.title} aria-describedby={"nativeDestination-" + item.id} value={item.id} checked={choice === item.id} onChange={() => setChoice(item.id)} />
          <span className="nativeOnboardingChoiceTop"><span className="nativeOnboardingChoiceIcon"><Asset icon={item.icon} slot={"choice-" + item.id} /></span>{item.id === "new" && <span className="nativeOnboardingRecommended">Recommended</span>}</span>
          <strong>{item.title}</strong><span id={"nativeDestination-" + item.id} className="nativeOnboardingChoiceDescription">{item.description}</span><span className="nativeOnboardingChoiceHint">{item.id === "folder" ? commandShortcut("space.openFolder", keymap, os) : item.hint}</span>
        </label>)}</fieldset>
        <fieldset className="nativeOnboardingPresets" disabled={busy}><legend>STARTER KIT — sets your first templates, snippets and blocks</legend><div>{onboardingPresets.map(item => <label key={item.id} className="nativeOnboardingPreset" data-preset={item.id} data-selected={preset === item.id}>
          <input className="visuallyHidden" type="radio" name="nativePreset" checked={preset === item.id} onChange={() => setPreset(item.id)} value={item.id} /><Asset icon={presetIcons[item.id]} slot={"preset-" + item.id} /><span>{item.name}</span>
        </label>)}</div></fieldset>
        {!flow && (error || windowError) && <p role="alert">{error || windowError}</p>}{busy && !flow && <p role="status">Opening your Space…</p>}
      </div>
      <footer className="nativeOnboardingFooter">
        <span><Asset icon="check" slot="no-account" />No account</span><span><Asset icon="check" slot="offline" />Works offline</span><span><Asset icon="lock" slot="local" />Files never leave this device</span><span><Asset icon="drive" slot="cache" />Index is a rebuildable cache</span>
        <span className="nativeOnboardingFooterSpace" /><button type="button" disabled={busy} onClick={() => { void run(onSkip); }}>Skip</button><button type="button" className="primaryButton" disabled={busy} onClick={() => proceed()}>Continue</button>
      </footer>
    </main>
    {flow && <WorkspaceDialog title={flow === "import" ? "Import into a new Space" : "Start a new Space"} busy={busy} onClose={back}>
      {(error || windowError) && <p role="alert">{error || windowError}</p>}<NativeNewSpaceForm busy={busy} created={created} onCreate={create} onBack={back} backLabel="Back to setup" />
      {busy && <p role="status">{created ? "Preparing your Space…" : "Creating your Space…"}</p>}
    </WorkspaceDialog>}
  </div>;
}
