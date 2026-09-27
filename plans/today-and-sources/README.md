# Today and Sources planning package

- [Product requirements](../../docs/product/PRD-TODAY-AND-SOURCES.md)
- [Engineering design](../../docs/engineering/TODAY-AND-SOURCES.md)
- [Build stages and gates](BUILD-PLAN.md)
- Visual review: `plan.mdx`, `canvas.mdx`, `prototype.mdx`.

Start the local review bridge from the repository root:

```sh
npx --yes @agent-native/core@latest plan local serve --dir plans/today-and-sources --kind plan --open
```

The URL works on the machine running the bridge. Source stays in this folder; the hosted Plan viewer reads it from localhost. This is not a published/shared plan.

The navigation prototype is a schematic with fictional examples. It demonstrates Today → Sources → combined filter → source history → linked note, plus a sample inline reply. It does not save files, search mail or call providers. The previously polished Today concept remains the layout reference; these wireframes do not replace the JustMaple theme specification.

Planning validation on September 27, 2026: local Markdown links checked; structured plan lint passed; rendered canvas, document dependency diagram and prototype navigation inspected; adversarial document review resolved generic notebook identity, retry aggregation, submit ordering and task-reservation recovery. Runtime tests were not run because this task changes planning artifacts only. Required implementation test commands are in BUILD-PLAN.md.
