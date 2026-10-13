/**
 * Legacy (runes-less) Svelte component support: props declared with
 * `export let` instead of `$props()`.
 *
 * Still-legal syntax under Svelte 5, with no `$props()` declaration for prop
 * extraction to anchor on. This module supplies the two things that replace
 * it, and nothing else: a syntactic scan of the original instance script
 * (`scanLegacyExports`) and the checker anchor in the svelte2tsx virtual
 * (`resolveLegacyPropsAnchor`). `analyzeSvelteModule` hands the result to the
 * same prop extraction the runes path uses, so filtering, types, callbacks,
 * and JSDoc are shared.
 *
 * What a legacy component documents: its props, all of them bindable (any
 * `export let` can be bound). Slots and events aren't modeled here; a default
 * slot sets `acceptsChildren` in `svelte.ts`, which covers legacy components
 * with no props too.
 *
 * @internal
 *
 * @module
 */

import ts from 'typescript';

/** A prop found by `scanLegacyExports`. */
export interface LegacyProp {
	/** Exported prop name (the rename in the `export {a as b}` form). */
	name: string;
	/** Offset of the export within the script content; the caller owns line mapping. */
	pos: number;
	/** Whether the binding has an initializer, which makes the prop optional. */
	hasInitializer: boolean;
	/**
	 * Verbatim source text of the initializer. Absent without one, and for an
	 * explicit `undefined`, which says the same as no default.
	 */
	defaultValue?: string;
}

/** What `scanLegacyExports` reads from an instance script. */
export interface LegacyExports {
	/** Props, in source order of their exports. */
	props: Array<LegacyProp>;
	/**
	 * Exported names of accessors: `export const`, `export function`,
	 * `export class`, and export clauses over those bindings. svelte2tsx lists
	 * them in the props type as optional properties, but they're read from the
	 * component instance, never passed in.
	 */
	accessors: Set<string>;
}

/** What a top-level binding in the instance script is, for the export-clause forms. */
type BindingInfo =
	{ kind: 'mutable'; initializer: ts.Expression | undefined } | { kind: 'accessor' };

/**
 * Scan an instance script for legacy props and accessors.
 *
 * Runes-less components declare props by exporting mutable bindings —
 * `export let a` / `export var a` directly, or `let a; export {a as b}` for
 * renames (the reserved-word workaround). Presence of either form is a
 * reliable legacy signal without classifying the component's mode: `export
 * let` is a compile error in runes mode, so no valid component mixes it with
 * `$props()`. `export const` / `export function` / `export class` are
 * accessors, not props, and type-only exports aren't runtime bindings.
 *
 * The scan reads the *original* instance script because svelte2tsx rewrites
 * the `export` modifier away inside `$$render`; a purely syntactic walk over
 * top-level statements is all it needs. It's also where defaults come from:
 * `defaultValue` is the initializer's source text as the author wrote it.
 *
 * @param scriptSource - parsed instance `<script>` content from the original source
 * @returns props in source order (empty when the component isn't legacy) and accessor names
 */
export const scanLegacyExports = (scriptSource: ts.SourceFile): LegacyExports => {
	// top-level bindings by local name, for the export-clause forms
	const bindings: Map<string, BindingInfo> = new Map();
	const props: Array<LegacyProp> = [];
	const accessors: Set<string> = new Set();

	const toProp = (
		name: string,
		pos: number,
		initializer: ts.Expression | undefined
	): LegacyProp => {
		const prop: LegacyProp = { name, pos, hasInitializer: initializer !== undefined };
		if (initializer && !(ts.isIdentifier(initializer) && initializer.text === 'undefined')) {
			prop.defaultValue = initializer.getText(scriptSource);
		}
		return prop;
	};

	for (const statement of scriptSource.statements) {
		const exported =
			ts.canHaveModifiers(statement) &&
			(ts.getModifiers(statement)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ?? false);
		if (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) {
			if (!statement.name) continue;
			bindings.set(statement.name.text, { kind: 'accessor' });
			if (exported) accessors.add(statement.name.text);
			continue;
		}
		if (!ts.isVariableStatement(statement)) continue;
		// const/using/await-using bindings aren't reassignable — accessors, not props
		const mutable = !(statement.declarationList.flags & (ts.NodeFlags.Const | ts.NodeFlags.Using));
		for (const declaration of statement.declarationList.declarations) {
			// legacy props are simple identifiers; skip destructuring defensively
			if (!ts.isIdentifier(declaration.name)) continue;
			const name = declaration.name.text;
			// a directly-exported binding can still be renamed by a clause, so
			// record it either way — `export let a; export {a as b}` scans as
			// `a` and `b`, and svelte2tsx's props value then keeps only `b`
			bindings.set(
				name,
				mutable ? { kind: 'mutable', initializer: declaration.initializer } : { kind: 'accessor' }
			);
			if (!exported) continue;
			if (mutable) {
				props.push(toProp(name, declaration.name.getStart(scriptSource), declaration.initializer));
			} else {
				accessors.add(name);
			}
		}
	}

	// separate pass — an export clause may precede the binding it re-exports
	for (const statement of scriptSource.statements) {
		if (
			!ts.isExportDeclaration(statement) ||
			statement.isTypeOnly ||
			statement.moduleSpecifier !== undefined ||
			statement.exportClause === undefined ||
			!ts.isNamedExports(statement.exportClause)
		) {
			continue;
		}
		for (const spec of statement.exportClause.elements) {
			if (spec.isTypeOnly) continue;
			const binding = bindings.get((spec.propertyName ?? spec.name).text);
			if (!binding) continue;
			if (binding.kind === 'mutable') {
				props.push(toProp(spec.name.text, spec.getStart(scriptSource), binding.initializer));
			} else {
				accessors.add(spec.name.text);
			}
		}
	}

	props.sort((a, b) => a.pos - b.pos);
	return { props, accessors };
};

/** The checker anchor for a legacy component's props, resolved by `resolveLegacyPropsAnchor`. */
export interface LegacyPropsAnchor {
	/** The props type. */
	type: ts.Type;
	/**
	 * The node the type was read from, in the component's own virtual: the
	 * written type (a TS component) or the props object literal (a JS one,
	 * which has no type node).
	 */
	node: ts.Node;
	/**
	 * Whether `node` is a written type whose properties carry their own
	 * optionality. False for a JS component, where every property of the object
	 * literal reads as required and optionality comes from the script instead
	 * (`LegacyProp.hasInitializer`).
	 */
	typed: boolean;
	/**
	 * Whether the type is the author's own `$$Props` rather than one svelte2tsx
	 * wrote from the exports. An authored type can declare props the script
	 * never exports, so all of its properties are props except the accessors,
	 * which svelte2tsx intersects in beside it. A generated one lists every
	 * export, accessors and type-only exports included, so only the scanned
	 * prop names are props.
	 */
	authored: boolean;
}

/**
 * What `resolveLegacyPropsAnchor` found:
 *
 * - a `LegacyPropsAnchor` to extract props from
 * - `'not_legacy'` — svelte2tsx read the component as runes and wrote an empty
 *   props type, so the scanned exports aren't props and nothing is wrong
 * - `'unrecognized'` — a shape this module doesn't know, or one the checker
 *   threw on
 */
export type LegacyPropsResolution = LegacyPropsAnchor | 'not_legacy' | 'unrecognized';

/** The reserved alias svelte2tsx reads a legacy component's authored props type from. */
const PROPS_ALIAS = '$$Props';

/** Whether a type node is a reference to the reserved `$$Props`. */
const isPropsAliasReference = (node: ts.TypeNode): boolean =>
	ts.isTypeReferenceNode(node) &&
	ts.isIdentifier(node.typeName) &&
	node.typeName.text === PROPS_ALIAS;

/**
 * Whether a type node is `Record<string, never>`, the empty props type
 * svelte2tsx writes for a component it reads as runes.
 */
const isEmptyPropsRecord = (node: ts.TypeNode): boolean =>
	ts.isTypeReferenceNode(node) &&
	ts.isIdentifier(node.typeName) &&
	node.typeName.text === 'Record' &&
	node.typeArguments?.length === 2 &&
	node.typeArguments[0]!.kind === ts.SyntaxKind.StringKeyword &&
	node.typeArguments[1]!.kind === ts.SyntaxKind.NeverKeyword;

/**
 * Classify the written props type of a legacy component: `false` for the
 * literal svelte2tsx generates from the exports, `true` for an authored
 * `$$Props` (bare, or intersected with the literal that carries the
 * accessors: `{fn?: typeof fn} & $$Props`), `undefined` for anything else.
 */
const isAuthoredPropsType = (node: ts.TypeNode): boolean | undefined => {
	if (ts.isTypeLiteralNode(node)) return false;
	if (isPropsAliasReference(node)) return true;
	if (
		ts.isIntersectionTypeNode(node) &&
		node.types.some(isPropsAliasReference) &&
		node.types.every((member) => ts.isTypeLiteralNode(member) || isPropsAliasReference(member))
	) {
		return true;
	}
	return undefined;
};

/**
 * Resolve the props anchor of a legacy component from its svelte2tsx virtual.
 *
 * svelte2tsx ends `$$render` with `return {props: …, slots: …, …}`, and the
 * `props` value is the anchor. The shapes recognized:
 *
 * - **TS** — `<object> as <Type>`. The type is a literal svelte2tsx writes
 *   from the exports, carrying each prop's JSDoc and optionality
 *   (`{a?: typeof a, b: number}`), or the author's reserved `$$Props`, bare or
 *   intersected with a literal of the accessors.
 * - **JS** — a bare object literal (`{a: a, b: b}`), with each binding's JSDoc
 *   copied onto its property, so a `@type` there types the prop.
 * - **Read as runes** — `{} as Record<string, never>`, or in JS the same type
 *   in a JSDoc cast. svelte2tsx saw a rune in the script, so an exported
 *   binding there is an instance export, not a prop: `'not_legacy'`.
 *
 * Anything else is `'unrecognized'`: an unknown virtual yields no props rather
 * than guessed ones.
 *
 * The props are what the type declares, so an `export let` name an authored
 * `$$Props` leaves out is no prop: a typed consumer can't pass it.
 *
 * Where svelte2tsx's props value departs from Svelte, the output follows it:
 *
 * - A binding exported both directly and through a renaming clause
 *   (`export let a; export {a as b}`) keeps only the renamed prop, without the
 *   binding's JSDoc. In TS it reads as optional.
 * - An export clause written above its binding loses the binding's JSDoc too,
 *   and in TS reads as optional.
 *
 * Runes components that declare `$props()` return a `props` value as well, but
 * they anchor on that declaration and never reach here.
 *
 * @param propsValue - the `props` value of the object `$$render` returns, when the virtual has one
 */
export const resolveLegacyPropsAnchor = (
	propsValue: ts.Expression | undefined,
	checker: ts.TypeChecker
): LegacyPropsResolution => {
	if (!propsValue) return 'unrecognized';

	let node: ts.Node;
	let typed: boolean;
	let authored: boolean;
	if (ts.isObjectLiteralExpression(propsValue)) {
		node = propsValue;
		typed = false;
		authored = false;
	} else {
		// TS writes the type in an `as`, JS in a JSDoc cast on a parenthesized `{}`
		const typeNode = ts.isAsExpression(propsValue)
			? propsValue.type
			: ts.isParenthesizedExpression(propsValue)
				? ts.getJSDocType(propsValue)
				: undefined;
		if (!typeNode) return 'unrecognized';
		if (isEmptyPropsRecord(typeNode)) return 'not_legacy';
		const authoredType = isAuthoredPropsType(typeNode);
		// a JSDoc cast only ever carries the empty record
		if (authoredType === undefined || !ts.isAsExpression(propsValue)) return 'unrecognized';
		node = typeNode;
		typed = true;
		authored = authoredType;
	}

	try {
		return { type: checker.getTypeAtLocation(node), node, typed, authored };
	} catch (_) {
		return 'unrecognized';
	}
};
