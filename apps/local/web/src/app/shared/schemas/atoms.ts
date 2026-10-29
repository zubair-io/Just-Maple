import { Type, Static } from '@sinclair/typebox';

// --- Atom Types ---

export const AtomTypeSchema = Type.Union([
  Type.Literal('text'),
  Type.Literal('stat'),
  Type.Literal('icon'),
  Type.Literal('badge'),
  Type.Literal('image'),
  Type.Literal('progress'),
  Type.Literal('timestamp'),
  Type.Literal('divider'),
  Type.Literal('link'),
  Type.Literal('list'),
  Type.Literal('checkbox'),
]);

export type AtomType = Static<typeof AtomTypeSchema>;

// --- Layout Types ---

export const LayoutTypeSchema = Type.Union([
  Type.Literal('card'),
  Type.Literal('stack'),
  Type.Literal('row'),
  Type.Literal('grid'),
]);

export type LayoutType = Static<typeof LayoutTypeSchema>;

// --- Atom Node (leaf) ---

export const AtomNodeSchema = Type.Object({
  atom: Type.String(),
  // Value resolution (one of):
  value: Type.Optional(Type.Unknown()),
  bind: Type.Optional(Type.String()),
  // Transforms:
  format: Type.Optional(Type.String()),
  map: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
  // Display:
  size: Type.Optional(Type.String()),
  color: Type.Optional(Type.String()),
  weight: Type.Optional(Type.String()),
  label: Type.Optional(Type.String()),
  // Atom-specific:
  src: Type.Optional(Type.String()),
  href: Type.Optional(Type.String()),
  checked: Type.Optional(Type.Boolean()),
  ordered: Type.Optional(Type.Boolean()),
  items: Type.Optional(Type.Array(Type.String())),
  name: Type.Optional(Type.String()),
  alt: Type.Optional(Type.String()),
  fit: Type.Optional(Type.String()),
  rounded: Type.Optional(Type.Boolean()),
  max: Type.Optional(Type.Number()),
  variant: Type.Optional(Type.String()),
  external: Type.Optional(Type.Boolean()),
  disabled: Type.Optional(Type.Boolean()),
  spacing: Type.Optional(Type.String()),
});

export type AtomNode = Static<typeof AtomNodeSchema>;

// --- Widget Node (recursive union of all node types) ---
// Discriminated by field: atom | layout | each | when

export const WidgetNodeSchema = Type.Recursive((Self) =>
  Type.Union([
    // Atom leaf — renders a single UI component
    AtomNodeSchema,

    // Layout container — arranges children in rows, columns, grids, or cards
    Type.Object({
      layout: LayoutTypeSchema,
      children: Type.Array(Self),
      gap: Type.Optional(Type.String()),
      align: Type.Optional(Type.String()),
      columns: Type.Optional(Type.Number()),
      header: Type.Optional(Type.String()),
      padding: Type.Optional(Type.String()),
      wrap: Type.Optional(Type.Boolean()),
    }),

    // Each loop — iterates over an array in the data context
    // `each`: JSONPath-like source (e.g. "$.books", "{{items}}")
    // `as`: loop variable name scoped to the template
    // `template`: node to render per item
    Type.Object({
      each: Type.String(),
      as: Type.String(),
      template: Self,
    }),

    // Conditional — renders `then` or `else` based on a truthy expression
    // `when`: expression to evaluate (e.g. "{{item.is_public}}")
    Type.Object({
      when: Type.String(),
      then: Self,
      else: Type.Optional(Self),
    }),
  ]),
);

export type WidgetNode = Static<typeof WidgetNodeSchema>;

// --- Layout Node (standalone type for backward compat) ---

export const LayoutNodeSchema = Type.Recursive((Self) =>
  Type.Object({
    layout: LayoutTypeSchema,
    children: Type.Array(Type.Union([Self, AtomNodeSchema])),
    // Layout props:
    gap: Type.Optional(Type.String()),
    align: Type.Optional(Type.String()),
    columns: Type.Optional(Type.Number()),
    header: Type.Optional(Type.String()),
    padding: Type.Optional(Type.String()),
    wrap: Type.Optional(Type.Boolean()),
  }),
);

export type LayoutNode = Static<typeof LayoutNodeSchema>;

// --- Widget Template (root of any widget) ---
// Now uses the full WidgetNode which supports each/when control flow

export const WidgetTemplateSchema = WidgetNodeSchema;
export type WidgetTemplate = WidgetNode;
