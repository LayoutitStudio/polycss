import type {
  PolyWorldDomElementLike,
  PolyWorldDomParentLike,
  PolyWorldDomRecord,
  PolyWorldDomRecordInput,
  PolyWorldDomValidationDiagnostic,
} from "./types";

export class PolyWorldDomRegistryError extends Error {
  readonly diagnostics: readonly PolyWorldDomValidationDiagnostic[];

  constructor(diagnostics: readonly PolyWorldDomValidationDiagnostic[]) {
    super(diagnostics.map((diagnostic) => diagnostic.message).join("\n"));
    this.name = "PolyWorldDomRegistryError";
    this.diagnostics = diagnostics;
  }
}

export class PolyWorldDomRegistry<
  TElement extends PolyWorldDomElementLike = PolyWorldDomElementLike,
> {
  #recordsByElementId = new Map<string, PolyWorldDomRecord<TElement>>();
  #recordsBySourceId = new Map<string, PolyWorldDomRecord<TElement>[]>();
  #recordsByAlias = new Map<string, PolyWorldDomRecord<TElement>[]>();
  #recordsByLayer = new Map<string, PolyWorldDomRecord<TElement>[]>();
  #recordsByTag = new Map<string, PolyWorldDomRecord<TElement>[]>();

  constructor(records: readonly PolyWorldDomRecordInput<TElement>[] = []) {
    for (const record of records) this.register(record);
  }

  get records(): readonly PolyWorldDomRecord<TElement>[] {
    return [...this.#recordsByElementId.values()];
  }

  get recordsByElementId(): ReadonlyMap<string, PolyWorldDomRecord<TElement>> {
    return this.#recordsByElementId;
  }

  get recordsBySourceId(): ReadonlyMap<string, readonly PolyWorldDomRecord<TElement>[]> {
    return this.#recordsBySourceId;
  }

  get recordsByAlias(): ReadonlyMap<string, readonly PolyWorldDomRecord<TElement>[]> {
    return this.#recordsByAlias;
  }

  get recordsByLayer(): ReadonlyMap<string, readonly PolyWorldDomRecord<TElement>[]> {
    return this.#recordsByLayer;
  }

  get recordsByTag(): ReadonlyMap<string, readonly PolyWorldDomRecord<TElement>[]> {
    return this.#recordsByTag;
  }

  register(input: PolyWorldDomRecordInput<TElement>): PolyWorldDomRecord<TElement> {
    const diagnostics = validatePolyWorldDomRecord(input);
    if (this.#recordsByElementId.has(input.elementId)) {
      diagnostics.push({
        code: "poly-world-dom-duplicate-element-id",
        message: `Duplicate PolyWorld DOM record element id "${input.elementId}".`,
        elementId: input.elementId,
        field: "elementId",
      });
    }
    if (diagnostics.length > 0) throw new PolyWorldDomRegistryError(diagnostics);

    const record = normalizeRecord(input);
    this.#recordsByElementId.set(record.elementId, record);
    this.#indexRecord(record);
    return record;
  }

  update(input: PolyWorldDomRecordInput<TElement>): PolyWorldDomRecord<TElement> {
    const diagnostics = validatePolyWorldDomRecord(input);
    if (diagnostics.length > 0) throw new PolyWorldDomRegistryError(diagnostics);

    const existing = this.#recordsByElementId.get(input.elementId);
    if (existing !== undefined) this.#unindexRecord(existing);

    const record = normalizeRecord(input);
    this.#recordsByElementId.set(record.elementId, record);
    this.#indexRecord(record);
    return record;
  }

  getByElementId(elementId: string): PolyWorldDomRecord<TElement> | undefined {
    return this.#recordsByElementId.get(elementId);
  }

  getBySourceId(sourceId: string): readonly PolyWorldDomRecord<TElement>[] {
    return this.#recordsBySourceId.get(sourceId) ?? [];
  }

  getByAlias(alias: string): readonly PolyWorldDomRecord<TElement>[] {
    return this.#recordsByAlias.get(alias) ?? [];
  }

  getByLayer(layer: string): readonly PolyWorldDomRecord<TElement>[] {
    return this.#recordsByLayer.get(layer) ?? [];
  }

  getByTag(tag: string): readonly PolyWorldDomRecord<TElement>[] {
    return this.#recordsByTag.get(tag) ?? [];
  }

  mountedRecords(): readonly PolyWorldDomRecord<TElement>[] {
    return this.records.filter((record) => record.mounted);
  }

  mountedElementIds(): readonly string[] {
    return this.mountedRecords().map((record) => record.elementId);
  }

  hiddenElementIds(): readonly string[] {
    return this.records
      .filter((record) => record.mounted && record.element.hidden === true)
      .map((record) => record.elementId);
  }

  setMounted(elementId: string, mounted: boolean): void {
    const record = this.#recordsByElementId.get(elementId);
    if (record !== undefined) record.mounted = mounted;
  }

  #indexRecord(record: PolyWorldDomRecord<TElement>): void {
    for (const sourceId of record.sourceIds) pushMap(this.#recordsBySourceId, sourceId, record);
    for (const alias of record.aliases) pushMap(this.#recordsByAlias, alias, record);
    for (const layer of record.layers) pushMap(this.#recordsByLayer, layer, record);
    for (const tag of record.tags) pushMap(this.#recordsByTag, tag, record);
  }

  #unindexRecord(record: PolyWorldDomRecord<TElement>): void {
    for (const sourceId of record.sourceIds) removeMapValue(this.#recordsBySourceId, sourceId, record);
    for (const alias of record.aliases) removeMapValue(this.#recordsByAlias, alias, record);
    for (const layer of record.layers) removeMapValue(this.#recordsByLayer, layer, record);
    for (const tag of record.tags) removeMapValue(this.#recordsByTag, tag, record);
  }
}

export function createPolyWorldDomRegistry<
  TElement extends PolyWorldDomElementLike = PolyWorldDomElementLike,
>(
  records: readonly PolyWorldDomRecordInput<TElement>[] = [],
): PolyWorldDomRegistry<TElement> {
  return new PolyWorldDomRegistry(records);
}

export function validatePolyWorldDomRecord(
  input: PolyWorldDomRecordInput,
): PolyWorldDomValidationDiagnostic[] {
  const diagnostics: PolyWorldDomValidationDiagnostic[] = [];
  validateId(input.elementId, "elementId", diagnostics);
  validateElement(input.element, input.elementId, diagnostics);
  validateStringArray(input.elementId, "sourceIds", input.sourceIds, diagnostics);
  validateStringArray(input.elementId, "aliases", input.aliases, diagnostics);
  validateStringArray(input.elementId, "layers", input.layers, diagnostics);
  validateStringArray(input.elementId, "tags", input.tags, diagnostics);
  validateOptionalId(input.elementId, "previousElementId", input.previousElementId, diagnostics);
  validateOptionalId(input.elementId, "nextElementId", input.nextElementId, diagnostics);
  return diagnostics;
}

function normalizeRecord<
  TElement extends PolyWorldDomElementLike = PolyWorldDomElementLike,
>(input: PolyWorldDomRecordInput<TElement>): PolyWorldDomRecord<TElement> {
  const parent = input.parent ?? parentFromElement(input.element);

  return {
    elementId: input.elementId,
    element: input.element,
    parent,
    mounted: input.mounted ?? isMounted(input.element, parent),
    previousElementId: input.previousElementId,
    nextElementId: input.nextElementId,
    sourceIds: uniqueSorted(input.sourceIds),
    aliases: uniqueSorted(input.aliases),
    layers: uniqueSorted(input.layers),
    tags: uniqueSorted(input.tags),
    data: input.data,
  };
}

function isMounted<TElement extends PolyWorldDomElementLike>(
  element: TElement,
  parent: PolyWorldDomParentLike<TElement> | null,
): boolean {
  return parent !== null && element.parentNode === parent;
}

function parentFromElement<TElement extends PolyWorldDomElementLike>(
  element: TElement,
): PolyWorldDomParentLike<TElement> | null {
  const parent = element.parentNode;
  if (parent === undefined || parent === null || typeof parent !== "object") return null;
  if (!("insertBefore" in parent) || typeof parent.insertBefore !== "function") return null;
  return parent as PolyWorldDomParentLike<TElement>;
}

function validateId(
  value: string,
  field: string,
  diagnostics: PolyWorldDomValidationDiagnostic[],
): void {
  if (typeof value !== "string" || value.length === 0) {
    diagnostics.push({
      code: "poly-world-dom-empty-element-id",
      message: "PolyWorld DOM record requires a non-empty elementId.",
      field,
    });
  }
}

function validateOptionalId(
  elementId: string,
  field: string,
  value: string | undefined,
  diagnostics: PolyWorldDomValidationDiagnostic[],
): void {
  if (value === undefined) return;
  if (typeof value !== "string" || value.length === 0) {
    diagnostics.push({
      code: "poly-world-dom-empty-reference-id",
      message: `PolyWorld DOM record "${elementId}" has an empty ${field}.`,
      elementId,
      field,
    });
  }
}

function validateElement(
  value: PolyWorldDomElementLike,
  elementId: string,
  diagnostics: PolyWorldDomValidationDiagnostic[],
): void {
  if (value === undefined || value === null || typeof value.remove !== "function") {
    diagnostics.push({
      code: "poly-world-dom-invalid-element",
      message: `PolyWorld DOM record "${elementId}" requires an element with remove().`,
      elementId,
      field: "element",
    });
  }
}

function validateStringArray(
  elementId: string,
  field: string,
  values: readonly string[] | undefined,
  diagnostics: PolyWorldDomValidationDiagnostic[],
): void {
  if (values === undefined) return;
  for (const value of values) {
    if (typeof value !== "string" || value.length === 0) {
      diagnostics.push({
        code: "poly-world-dom-empty-array-value",
        message: `PolyWorld DOM record "${elementId}" has an empty value in ${field}.`,
        elementId,
        field,
      });
    }
  }
}

function pushMap<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const values = map.get(key);
  if (values === undefined) {
    map.set(key, [value]);
    return;
  }
  values.push(value);
}

function removeMapValue<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const values = map.get(key);
  if (values === undefined) return;
  const next = values.filter((item) => item !== value);
  if (next.length === 0) {
    map.delete(key);
    return;
  }
  map.set(key, next);
}

function uniqueSorted(values: readonly string[] | undefined): readonly string[] {
  return [...new Set(values ?? [])].sort(compareStrings);
}

function compareStrings(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}
