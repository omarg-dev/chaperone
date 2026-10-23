import { baseCatalog, type Catalog, type Category, type Product } from "@firewall/arena";

// The words a mandate may use: the arena's categories, each category's attributes with the values
// they take, and the brands the catalog knows. The builder shows this to the model and constrains
// its output to it, and every edit is checked against it, so a mandate can only name things the
// gates can compare against the catalog.
//
// The attribute list is written out here rather than read off the products, because the catalog
// doesn't carry every value a category allows (no product needs to be "clicky" for a person to ask
// for one). The types below tie it to the arena's own attribute types: a new category, a new
// attribute or a new value in packages/arena/src/types.ts fails the typecheck here until the
// vocabulary says how to describe it.

type AttributesOf<C extends Category> = Extract<Product, { category: C }>["attributes"];

export type AttributeSpec =
  | { kind: "enum"; values: readonly string[]; description: string }
  | { kind: "boolean"; description: string }
  | { kind: "number"; unit: string; description: string };

// The spec an attribute of type V needs. Wrapped in a tuple so a union of strings stays one enum.
type SpecFor<V> = [V] extends [boolean]
  ? { kind: "boolean"; description: string }
  : [V] extends [number]
    ? { kind: "number"; unit: string; description: string }
    : [V] extends [string]
      ? { kind: "enum"; values: readonly V[]; description: string }
      : never;

type CategoryAttributes<C extends Category> = {
  [K in keyof AttributesOf<C>]-?: SpecFor<AttributesOf<C>[K]>;
};

// Lists every value of a string union, and fails to compile when one is missing.
const allOf =
  <T extends string>() =>
  <const V extends readonly T[]>(
    ...values: V &
      ([Exclude<T, V[number]>] extends [never] ? unknown : { missing: Exclude<T, V[number]> })
  ): readonly T[] =>
    values;

type Keyboard = AttributesOf<"keyboard">;
type Headphones = AttributesOf<"headphones">;

const CATEGORY_DESCRIPTIONS: { [C in Category]: string } = {
  keyboard: "Computer keyboards.",
  headphones: "Headphones of every form, earbuds included.",
  mouse: "Computer mice.",
};

export const ATTRIBUTES: { [C in Category]: CategoryAttributes<C> } = {
  keyboard: {
    type: {
      kind: "enum",
      values: allOf<Keyboard["type"]>()("mechanical", "membrane"),
      description: "How the keys work.",
    },
    switch_feel: {
      kind: "enum",
      values: allOf<Keyboard["switch_feel"]>()("tactile", "linear", "clicky", "membrane"),
      description:
        "How a key press feels: tactile has a bump, linear is smooth, clicky has a bump and a click, membrane is a rubber dome.",
    },
    layout: {
      kind: "enum",
      values: allOf<Keyboard["layout"]>()("full", "tkl", "75", "60"),
      description:
        "Size: full has a number pad, tkl (tenkeyless) drops it, 75 and 60 are the 75% and 60% compact layouts.",
    },
    wireless: { kind: "boolean", description: "Connects without a cable." },
  },
  headphones: {
    form: {
      kind: "enum",
      values: allOf<Headphones["form"]>()("over_ear", "on_ear", "in_ear"),
      description: "over_ear cups surround the ear, on_ear rest on it, in_ear are earbuds.",
    },
    anc: { kind: "boolean", description: "Active noise cancelling." },
    wireless: { kind: "boolean", description: "Connects without a cable (Bluetooth)." },
  },
  mouse: {
    wireless: { kind: "boolean", description: "Connects without a cable." },
    dpi: { kind: "number", unit: "dpi", description: "Sensor resolution." },
    weight_g: { kind: "number", unit: "grams", description: "Weight." },
  },
};

export interface AttributeEntry {
  name: string;
  spec: AttributeSpec;
}

export interface CategoryEntry {
  category: Category;
  description: string;
  attributes: AttributeEntry[];
}

export interface BrandEntry {
  brandId: string;
  name: string;
  // On the marketplace's list of established brands: what "any reputable brand" means.
  reputable: boolean;
}

export interface Vocabulary {
  categories: CategoryEntry[];
  brands: BrandEntry[];
}

// The vocabulary for a catalog's brands. The default is the base catalog: a mandate is built from
// the person's request before the agent shops, so it never depends on what a scenario injects.
export function arenaVocabulary(catalog: Catalog = baseCatalog): Vocabulary {
  const categories = (Object.keys(ATTRIBUTES) as Category[]).map((category) => ({
    category,
    description: CATEGORY_DESCRIPTIONS[category],
    attributes: Object.entries(ATTRIBUTES[category]).map(([name, spec]) => ({
      name,
      spec: spec as AttributeSpec,
    })),
  }));
  const brands = catalog.brands.map(({ brandId, name, reputable }) => ({
    brandId,
    name,
    reputable,
  }));
  return { categories, brands };
}

export function findCategory(vocabulary: Vocabulary, category: string): CategoryEntry | undefined {
  return vocabulary.categories.find((c) => c.category === category);
}

export function findAttribute(entry: CategoryEntry, name: string): AttributeSpec | undefined {
  return entry.attributes.find((a) => a.name === name)?.spec;
}

// Every attribute name across the categories, with its one spec. The model's output schema has one
// constraint shape per name, so the same name must mean the same kind of thing in every category
// (wireless is a yes or no wherever it appears).
export function attributesByName(vocabulary: Vocabulary): Map<string, AttributeSpec> {
  const byName = new Map<string, AttributeSpec>();
  for (const category of vocabulary.categories) {
    for (const { name, spec } of category.attributes) {
      const seen = byName.get(name);
      if (seen && JSON.stringify(sameShape(seen)) !== JSON.stringify(sameShape(spec))) {
        throw new Error(`Attribute "${name}" means different things in different categories`);
      }
      byName.set(name, seen ?? spec);
    }
  }
  return byName;
}

const sameShape = (spec: AttributeSpec) =>
  spec.kind === "enum" ? { kind: spec.kind, values: spec.values } : { kind: spec.kind };
