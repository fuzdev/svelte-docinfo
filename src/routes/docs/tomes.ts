import type { Tome } from '@fuzdev/fuz_ui/tome.ts';
import IntroductionPage from './introduction/+page.svelte';
import VitePluginPage from './vite-plugin/+page.svelte';
import CliPage from './cli/+page.svelte';
import JsApiPage from './js-api/+page.svelte';
import SourceFilesPage from './source-files/+page.svelte';
import JsPage from './js/+page.svelte';
import ComponentStylingPage from './component-styling/+page.svelte';
import SessionPage from './session/+page.svelte';
import BuildToolsPage from './build-tools/+page.svelte';
import ArchitecturePage from './architecture/+page.svelte';
import OutputFormatPage from './output-format/+page.svelte';
import StructuredTypesPage from './structured-types/+page.svelte';
import ReExportsPage from './re-exports/+page.svelte';
import TagsPage from './tags/+page.svelte';
import DiagnosticsPage from './diagnostics/+page.svelte';
import ApiPage from './api/+page.svelte';

export const tomes: Array<Tome> = [
	{
		slug: 'introduction',
		category: 'guide',
		Component: IntroductionPage,
		related_tomes: ['vite-plugin', 'cli', 'js-api', 'output-format', 'tags', 'diagnostics', 'api'],
		related_modules: ['analyze.ts', 'vite.ts', 'cli.ts'],
		related_declarations: ['analyzeFromFiles', 'analyze', 'createAnalysisSession']
	},
	{
		slug: 'vite-plugin',
		title: 'Vite plugin',
		category: 'guide',
		Component: VitePluginPage,
		related_tomes: ['introduction', 'source-files', 'output-format', 'diagnostics'],
		related_modules: ['vite.ts'],
		related_declarations: [
			'VitePluginSvelteDocinfoOptions',
			'AnalyzeResultJsonWire',
			'parseAnalyzeResult',
			'OnDuplicates'
		]
	},
	{
		slug: 'cli',
		title: 'CLI',
		category: 'guide',
		Component: CliPage,
		related_tomes: ['introduction', 'source-files', 'output-format', 'diagnostics'],
		related_modules: ['cli.ts'],
		related_declarations: ['parseAnalyzeResult']
	},
	{
		slug: 'js-api',
		title: 'JS API',
		category: 'guide',
		Component: JsApiPage,
		related_tomes: ['source-files', 'session', 'build-tools', 'output-format', 'api'],
		related_modules: ['analyze.ts', 'index.ts'],
		related_declarations: [
			'analyzeFromFiles',
			'AnalyzeFromFilesOptions',
			'analyze',
			'AnalyzeOptions',
			'createAnalysisSession',
			'parseAnalyzeResult',
			'createSourceOptions'
		]
	},
	{
		slug: 'source-files',
		title: 'source files',
		category: 'guide',
		Component: SourceFilesPage,
		related_tomes: ['vite-plugin', 'cli', 'js-api', 'js'],
		related_modules: ['source-config.ts', 'discovery.ts', 'exports.ts', 'typescript-program.ts'],
		related_declarations: [
			'createSourceOptions',
			'ModuleSourceOptions',
			'DEFAULT_SOURCE_OPTIONS',
			'ExcludeOption',
			'discoverSourceFiles',
			'DEFAULT_COMPILER_OPTIONS',
			'RootFileNames'
		]
	},
	{
		slug: 'js',
		title: 'JS and JSDoc',
		category: 'guide',
		Component: JsPage,
		related_tomes: ['tags', 'source-files', 'output-format', 'diagnostics'],
		related_modules: ['tsdoc.ts', 'typescript-extract-class.ts'],
		related_declarations: ['ParameterJson', 'OverloadJson', 'TypeDeclarationJson']
	},
	{
		slug: 'component-styling',
		title: 'component styling',
		category: 'guide',
		Component: ComponentStylingPage,
		related_tomes: ['tags', 'output-format', 'diagnostics'],
		related_modules: ['svelte-css.ts'],
		related_declarations: ['ComponentCssPropertyJson', 'ComponentDeclarationJson']
	},
	{
		slug: 'session',
		category: 'guide',
		Component: SessionPage,
		related_tomes: ['js-api', 'build-tools', 'diagnostics'],
		related_modules: ['session.ts', 'dep-resolver.ts'],
		related_declarations: [
			'createAnalysisSession',
			'AnalysisSession',
			'AnalysisSessionOptions',
			'SetFileOptions',
			'SetFileResult',
			'SetFilesResult',
			'QueryOptions',
			'ImportResolver',
			'ResolveImport'
		]
	},
	{
		slug: 'build-tools',
		title: 'build tools',
		category: 'guide',
		Component: BuildToolsPage,
		related_tomes: ['js-api', 'session', 'source-files'],
		related_modules: ['source.ts', 'discovery.ts', 'dep-resolver.ts', 'paths.ts'],
		related_declarations: [
			'SourceFileInfo',
			'discoverSourceFiles',
			'createSourceOptionsWithInclude',
			'ImportResolver',
			'normalizeDiagnosticPaths'
		]
	},
	{
		slug: 'architecture',
		category: 'guide',
		Component: ArchitecturePage,
		related_tomes: ['introduction', 'api'],
		related_modules: ['analyze-core.ts'],
		related_declarations: ['analyzeFromFiles']
	},
	{
		slug: 'output-format',
		title: 'output format',
		category: 'reference',
		Component: OutputFormatPage,
		related_tomes: ['structured-types', 're-exports', 'tags', 'diagnostics', 'api'],
		related_modules: ['types.ts', 'declaration-helpers.ts'],
		related_declarations: [
			'AnalyzeResultJson',
			'ModuleJson',
			'DeclarationJson',
			'MemberJson',
			'ComponentPropJson',
			'ComponentCssPropertyJson',
			'ParameterJson',
			'OverloadJson',
			'GenericParamJson',
			'compactReplacer',
			'parseAnalyzeResult',
			'parseModuleJson',
			'generateImport'
		]
	},
	{
		slug: 'structured-types',
		title: 'structured types',
		category: 'reference',
		Component: StructuredTypesPage,
		related_tomes: ['output-format', 'diagnostics'],
		related_modules: ['typescript-extract-type-json.ts', 'declaration-helpers.ts'],
		related_declarations: ['TypeJson', 'TupleElementJson', 'typeJsonToTokens', 'typeJsonToText']
	},
	{
		slug: 're-exports',
		category: 'reference',
		Component: ReExportsPage,
		related_tomes: ['output-format', 'tags'],
		related_modules: ['postprocess.ts', 'typescript-exports.ts'],
		related_declarations: [
			'ReExportJson',
			'ExternalReExportJson',
			'NamespaceDeclarationJson',
			'resolveExportSurface'
		]
	},
	{
		slug: 'tags',
		category: 'reference',
		Component: TagsPage,
		related_tomes: ['js', 'component-styling', 'output-format', 'diagnostics'],
		related_modules: ['tsdoc.ts'],
		related_declarations: ['ComponentPropJson', 'ParameterJson', 'OverloadJson']
	},
	{
		slug: 'diagnostics',
		category: 'reference',
		Component: DiagnosticsPage,
		related_tomes: ['output-format', 'tags', 'js-api', 'session'],
		related_modules: ['diagnostics.ts'],
		related_declarations: [
			'Diagnostic',
			'DiagnosticKind',
			'DiagnosticSeverity',
			'parseDiagnostics',
			'hasErrors',
			'hasWarnings',
			'errorsOf',
			'warningsOf',
			'byKind',
			'formatDiagnostic'
		]
	},
	{
		slug: 'api',
		category: 'reference',
		Component: ApiPage,
		related_tomes: ['js-api', 'output-format', 'diagnostics'],
		related_modules: ['index.ts', 'analyze.ts', 'types.ts'],
		related_declarations: ['analyze', 'analyzeFromFiles', 'createAnalysisSession', 'ModuleJson']
	}
];
