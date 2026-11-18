---
template:
  name: "Status update"
  description: "Weekly · green/amber/red"
  category: "Work"
  destination: "updates"
  filename: "{{date}}-{{title|slug}}"
title: "{{title}}"
date: "{{date}}"
tags: [status]
---
# {{title}}

## Overall status
{{prompt:Status|Green}}

## Completed
- {{cursor}}

## In progress

## Risks and blockers

## Next steps
- [ ] 
