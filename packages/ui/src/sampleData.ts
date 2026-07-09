export interface SpaceSeed {
  id: string;
  name: string;
  icon: string;
  color: string;
}

export interface NotebookSeed {
  id: string;
  label: string;
  count?: number;
  children?: NotebookSeed[];
}

export interface SheetSeed {
  id: string;
  title: string;
  notebook: string;
  tags: string[];
  updated: string;
  status: "On Track" | "At Risk" | "Not Started";
  progress: number;
  markdown: string;
  preview: string;
  backlinks: string[];
}

export const spaces: SpaceSeed[] = [
  { id: "work", name: "Work", icon: "briefcase", color: "#326bff" },
  { id: "blog", name: "Blog", icon: "book-open", color: "#178a4b" },
  { id: "research", name: "Research", icon: "library", color: "#7c5cff" },
  { id: "drafts", name: "Drafts", icon: "pencil", color: "#ce6b00" }
];

export const notebooks: NotebookSeed[] = [
  {
    id: "product",
    label: "product",
    count: 21,
    children: [
      { id: "strategy", label: "strategy", count: 7 },
      { id: "planning", label: "planning", count: 4 },
      { id: "metrics", label: "metrics", count: 3 }
    ]
  },
  {
    id: "writing",
    label: "writing",
    count: 19,
    children: [
      { id: "ideas", label: "ideas", count: 9 },
      { id: "outline", label: "outline", count: 6 },
      { id: "drafts", label: "drafts", count: 4 }
    ]
  },
  {
    id: "research",
    label: "research",
    count: 19,
    children: [
      { id: "market", label: "market", count: 8 },
      { id: "user", label: "user", count: 5 },
      { id: "references", label: "references", count: 6 }
    ]
  }
];

export const sheets: SheetSeed[] = [
  {
    id: "launch-plan",
    title: "Launch Plan",
    notebook: "product/strategy",
    tags: ["product/strategy", "planning"],
    updated: "Today",
    status: "On Track",
    progress: 72,
    preview: "A focused plan to launch Slate 1.0 with a strong initial user base and clear release notes.",
    backlinks: ["Product Vision", "Onboarding Flow Ideas", "Changelog Draft"],
    markdown: `# Launch Plan

A focused plan to launch Slate 1.0 with a strong initial user base and a durable writing rhythm.

## 1. Goals

- [x] Build awareness and credibility in the writing and knowledge work community
- [x] Drive 1,000 active users in the first 30 days
- [x] Achieve 40% week-over-week retention by Day 30
- [ ] Collect 100 pieces of user feedback

## 2. Strategy

We'll launch in three phases, each with a clear focus and outcome.

### Phase 1 - Foundation (Weeks 1-2)

- Finalize core workflows and documentation
- Private beta with 50-100 users
- Iterate based on feedback

### Phase 2 - Launch (Week 3)

- Public launch on Product Hunt
- Email campaign to early subscribers
- Publish key tutorials and guides

Related: [[Product Vision]], [[Onboarding Flow Ideas]], #product/strategy, #planning
`
  },
  {
    id: "product-vision",
    title: "Product Vision",
    notebook: "product/strategy",
    tags: ["product/strategy"],
    updated: "Today",
    status: "On Track",
    progress: 81,
    preview: "Slate empowers writers and thinkers to organize ideas and ship their best work.",
    backlinks: ["Launch Plan"],
    markdown: "# Product Vision\n\nSlate helps people think, write, and organize better.\n\n[[Launch Plan]]"
  },
  {
    id: "writing-principles",
    title: "Writing Principles",
    notebook: "writing/ideas",
    tags: ["writing/ideas"],
    updated: "Yesterday",
    status: "On Track",
    progress: 90,
    preview: "Our approach to calm, focused, and intentional writing experiences.",
    backlinks: [],
    markdown: "# Writing Principles\n\nCalm by default. Powerful on demand. Keyboard first."
  },
  {
    id: "user-research",
    title: "User Research Synthesis",
    notebook: "research/user",
    tags: ["research/user"],
    updated: "Yesterday",
    status: "At Risk",
    progress: 34,
    preview: "Key insights from interviews and surveys across 24 participants.",
    backlinks: ["Launch Plan"],
    markdown: "# User Research Synthesis\n\nLong-form writers want speed, trust, and ownership."
  },
  {
    id: "competitive-analysis",
    title: "Competitive Analysis",
    notebook: "research/market",
    tags: ["research/market"],
    updated: "Jul 8",
    status: "On Track",
    progress: 60,
    preview: "Notes on key competitors and opportunities in the market.",
    backlinks: [],
    markdown: "# Competitive Analysis\n\nUlysses, Bear, Evernote, Obsidian, Notion, and Craft."
  },
  {
    id: "onboarding",
    title: "Onboarding Flow Ideas",
    notebook: "product/planning",
    tags: ["product/planning"],
    updated: "Jul 7",
    status: "On Track",
    progress: 55,
    preview: "Ideas to improve the first-run experience and activation.",
    backlinks: ["Launch Plan"],
    markdown: "# Onboarding Flow Ideas\n\nHelp people create a Space, import notes, and write immediately."
  },
  {
    id: "changelog",
    title: "Changelog Draft",
    notebook: "product/planning",
    tags: ["product/planning"],
    updated: "Jul 6",
    status: "Not Started",
    progress: 0,
    preview: "Draft of the 1.0 release notes and migration guide.",
    backlinks: ["Launch Plan"],
    markdown: "# Changelog Draft\n\n## Added\n\n- Slate workspace foundation."
  }
];

