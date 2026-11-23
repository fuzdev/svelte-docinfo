import{$ as e,A as t,F as n,M as r,Q as i,X as a,dt as o,gt as s,h as c,ht as l,q as u,tt as d,ut as f}from"./CBSqT5U-.js";import{t as p}from"./BeTrdHCY.js";import{i as m,n as h,t as g}from"./Bhmzzj4p.js";import{t as _}from"./HI1dhcHt.js";import{t as v}from"./p-9kdI9O.js";import{t as y}from"./BWYLNuA8.js";import{n as b}from"./DfI0x1IA.js";var x=r(`<!> <p>Requires Vite 6 or later.</p> <ol><li><p>Add the plugin to <code>vite.config.ts</code>:</p> <!></li> <li><p>Add TypeScript support in your <code>app.d.ts</code>:</p> <!></li> <li><p>Import the virtual module anywhere in your app:</p> <!> <p>The data is <!> in its wire form
					(<!>). <code>modules</code> and <code>diagnostics</code> are always arrays, but entries in <code>modules</code> omit empty
					arrays and <code>false</code> flags. Treat absent as empty, or restore the defaults per
					module with <!> from <code>svelte-docinfo/types.js</code>, which is light enough for the browser (see <!>). See <!> for <code>diagnostics</code>.</p></li></ol> <p>If TypeScript reports <code>Cannot find module 'virtual:svelte-docinfo'</code>, check the <!> line in <code>app.d.ts</code>.</p>`,1),S=r(`<!> <p>All options are optional; the minimal call discovers files from <code>package.json</code> exports, falling back to glob:</p> <!> <p>Every option, with its default in the comment above it:</p> <!> <p>The plugin runs the same pipeline as <!>: discover,
			resolve dependencies, analyze. In dev, imports resolve through Vite's <code>resolveId</code>,
			so Vite aliases apply; in builds, the TypeScript default resolver is used (it honors tsconfig <code>paths</code>). <code>hmrDebounceMs</code> only affects the dev watcher.</p> <p><!> covers how <code>discovery</code>, <code>include</code>, <code>exclude</code>, <code>sourceOptions</code>, and the tsconfig options decide what's
			documented.</p>`,1),C=r(`<!> <p>Options are validated when Vite resolves its config, so a bad one (like <!> with <code>include</code>, or a path
			outside the project root) fails at startup.</p> <p>In dev the plugin watches the source files and the files they import, debounces re-analysis by <code>hmrDebounceMs</code>, and re-parses only what changed. Only the files discovery selects
			emit modules, as in a build: an edit elsewhere refreshes the analysis without adding a module,
			and a newly created file is checked against discovery again.</p> <p>Any change to the output reloads the page, even one that only shifts a declaration's source
			line, instead of letting Svelte HMR update components in place. Importers build state from the
			data (like a layout building a library from <code>modules</code>), so re-running the module
			alone would leave them stale.</p>`,1),w=r(`<section><p>The <!> is the recommended path for
			SvelteKit and Vite projects. It runs analysis at build time and serves the result as <!>. In dev it watches your source
			files, plus the other files they import like <code>internal/</code> modules, and reloads the
			page when an edit changes the result.</p> <p>The plugin keeps a persistent <!>, so dev
			re-analysis reuses parsed ASTs and svelte2tsx output. To write the data to a file instead, use
			the <!>.</p></section> <!> <!> <!>`,1);function T(r,T){o(T,!0);let E=b(`vite-plugin`);c(`1v4ku2r`,e=>{u(()=>{a.title=`Vite plugin - svelte-docinfo`})}),m(r,{get tome(){return E},children:(r,a)=>{var o=w(),c=e(o),u=i(c),f=d(i(u));v(f,{module_path:`vite.ts`,children:(e,r)=>{l();var i=n(`Vite plugin`);t(e,i)},$$slots:{default:!0}});var m=d(f,2);p(m,{lang:`ts`,inline:!0,dangerous_raw_html:`<span class="token_string">'virtual:svelte-docinfo'</span>`}),l(3),s(u);var b=d(u,2),T=d(i(b));_(T,{name:`createAnalysisSession`});var E=d(T,2);y(E,{slug:`cli`,children:(e,r)=>{l();var i=n(`CLI`);t(e,i)},$$slots:{default:!0}}),l(),s(b),s(c);var D=d(c,2);h(D,{children:(r,a)=>{var o=x(),c=e(o);g(c,{text:`Setup`});var u=d(c,4),f=i(u),m=d(i(f),2);p(m,{lang:`ts`,dangerous_raw_html:`<span class="token_special_keyword">import</span> <span class="token_punctuation">{</span>defineConfig<span class="token_punctuation">}</span> <span class="token_special_keyword">from</span> <span class="token_string">'vite'</span><span class="token_punctuation">;</span>
<span class="token_special_keyword">import</span> <span class="token_punctuation">{</span>sveltekit<span class="token_punctuation">}</span> <span class="token_special_keyword">from</span> <span class="token_string">'@sveltejs/kit/vite'</span><span class="token_punctuation">;</span>
<span class="token_special_keyword">import</span> svelteDocinfo <span class="token_special_keyword">from</span> <span class="token_string">'svelte-docinfo/vite.js'</span><span class="token_punctuation">;</span>

<span class="token_special_keyword">export</span> <span class="token_special_keyword">default</span> <span class="token_function">defineConfig</span><span class="token_punctuation">({</span>
  plugins<span class="token_operator">:</span> <span class="token_punctuation">[</span><span class="token_function">sveltekit</span><span class="token_punctuation">(),</span> <span class="token_function">svelteDocinfo</span><span class="token_punctuation">()],</span>
<span class="token_punctuation">});</span>`}),s(f);var h=d(f,2),v=d(i(h),2);p(v,{lang:`ts`,dangerous_raw_html:`<span class="token_comment">/// &lt;reference types="svelte-docinfo/virtual-svelte-docinfo.js" /></span>`}),s(h);var b=d(h,2),S=d(i(b),2);p(S,{lang:`ts`,dangerous_raw_html:`<span class="token_special_keyword">import</span> <span class="token_punctuation">{</span>modules<span class="token_punctuation">,</span> diagnostics<span class="token_punctuation">}</span> <span class="token_special_keyword">from</span> <span class="token_string">'virtual:svelte-docinfo'</span><span class="token_punctuation">;</span>
<span class="token_comment">// or use the default export:</span>
<span class="token_special_keyword">import</span> data <span class="token_special_keyword">from</span> <span class="token_string">'virtual:svelte-docinfo'</span><span class="token_punctuation">;</span>
<span class="token_comment">// data.modules and data.diagnostics are the same as the named exports</span>`});var C=d(S,2),w=d(i(C));_(w,{name:`AnalyzeResultJson`});var T=d(w,2);_(T,{name:`AnalyzeResultJsonWire`});var E=d(T,10);_(E,{name:`parseModuleJson`});var D=d(E,4);y(D,{slug:`output-format`,hash:`Compact-JSON`,children:(e,r)=>{l();var i=n(`compact JSON`);t(e,i)},$$slots:{default:!0}});var O=d(D,2);y(O,{slug:`diagnostics`}),l(3),s(C),s(b),s(u);var k=d(u,2),A=d(i(k),3);p(A,{lang:`ts`,inline:!0,dangerous_raw_html:`<span class="token_comment">/// &lt;reference></span>`}),l(3),s(k),t(r,o)},$$slots:{default:!0}});var O=d(D,2);h(O,{children:(n,r)=>{var a=S(),o=e(a);g(o,{text:`Options`});var c=d(o,4);p(c,{lang:`ts`,dangerous_raw_html:`<span class="token_function">svelteDocinfo</span><span class="token_punctuation">()</span>`});var u=d(c,4);p(u,{lang:`ts`,dangerous_raw_html:`<span class="token_special_keyword">import</span> svelteDocinfo <span class="token_special_keyword">from</span> <span class="token_string">'svelte-docinfo/vite.js'</span><span class="token_punctuation">;</span>

<span class="token_function">svelteDocinfo</span><span class="token_punctuation">({</span>
  <span class="token_comment">// Project root directory. Default: Vite's resolved config.root.</span>
  projectRoot<span class="token_operator">:</span> process<span class="token_punctuation">.</span><span class="token_function">cwd</span><span class="token_punctuation">(),</span>

  <span class="token_comment">// Glob patterns for file discovery. Forces glob mode under discovery: 'auto'.</span>
  <span class="token_comment">// Default: undefined (use exports discovery).</span>
  <span class="token_comment">// Each pattern's static base joins sourceOptions.sourcePaths; a pattern</span>
  <span class="token_comment">// with no base makes the whole project root source and logs an info line.</span>
  include<span class="token_operator">:</span> <span class="token_punctuation">[</span><span class="token_string">'src/**/*.ts'</span><span class="token_punctuation">,</span> <span class="token_string">'src/**/*.svelte'</span><span class="token_punctuation">],</span>

  <span class="token_comment">// Exclude globs. An array replaces the default</span>
  <span class="token_comment">// ['**/*.{test,spec}.{ts,mts,tsx,js,mjs,jsx}', '**/internal/**']; a callback extends</span>
  <span class="token_comment">// it. Replaces sourceOptions.exclude when both are set. node_modules and</span>
  <span class="token_comment">// dot-directories below a source path are never source.</span>
  <span class="token_function_variable token_function">exclude</span><span class="token_operator">:</span> <span class="token_punctuation">(</span>defaults<span class="token_punctuation">)</span> <span class="token_operator">=></span> <span class="token_punctuation">[</span><span class="token_operator">...</span>defaults<span class="token_punctuation">,</span> <span class="token_string">'**/*.gen.ts'</span><span class="token_punctuation">],</span>

  <span class="token_comment">// Discovery strategy: 'auto' | 'exports' | 'glob'. Default: 'auto'.</span>
  <span class="token_comment">// 'auto'    → exports first, glob fallback</span>
  <span class="token_comment">// 'exports' → strict; throws if package.json exports is missing or resolves to no files</span>
  <span class="token_comment">// 'glob'    → skip exports, use glob patterns</span>
  discovery<span class="token_operator">:</span> <span class="token_string">'auto'</span><span class="token_punctuation">,</span>

  <span class="token_comment">// Dist directory for exports discovery. Default: 'dist'.</span>
  distDir<span class="token_operator">:</span> <span class="token_string">'dist'</span><span class="token_punctuation">,</span>

  <span class="token_comment">// Resolve module dependency graph. Default: true.</span>
  resolveDependencies<span class="token_operator">:</span> <span class="token_boolean">true</span><span class="token_punctuation">,</span>

  <span class="token_comment">// Partial overrides for default source options (SvelteKit src/lib layout).</span>
  <span class="token_comment">// Merged into createSourceOptions(projectRoot, sourceOptions).</span>
  sourceOptions<span class="token_operator">:</span> <span class="token_punctuation">{</span>sourcePaths<span class="token_operator">:</span> <span class="token_punctuation">[</span><span class="token_string">'src/lib'</span><span class="token_punctuation">]},</span>

  <span class="token_comment">// dev re-analysis debounce in ms. Default: 100.</span>
  hmrDebounceMs<span class="token_operator">:</span> <span class="token_number">100</span><span class="token_punctuation">,</span>

  <span class="token_comment">// Opt-in check that names are unique across modules, for packages with a</span>
  <span class="token_comment">// flat export namespace. Default: undefined (off).</span>
  <span class="token_comment">// 'diagnostic' → emit duplicate_declaration diagnostics</span>
  <span class="token_comment">// 'warn'       → also log them</span>
  <span class="token_comment">// 'throw'      → also fail the build</span>
  onDuplicates<span class="token_operator">:</span> <span class="token_keyword">undefined</span><span class="token_punctuation">,</span>

  <span class="token_comment">// tsconfig path relative to projectRoot (searched upward from it), or false</span>
  <span class="token_comment">// to analyze without one. Default: 'tsconfig.json'.</span>
  tsconfig<span class="token_operator">:</span> <span class="token_string">'tsconfig.json'</span><span class="token_punctuation">,</span>

  <span class="token_comment">// Compiler options merged over the tsconfig's. Default: none.</span>
  compilerOptions<span class="token_operator">:</span> <span class="token_keyword">undefined</span><span class="token_punctuation">,</span>

  <span class="token_comment">// The program's root files, in place of the tsconfig's: a list, or a</span>
  <span class="token_comment">// function over the tsconfig's roots. Default: the tsconfig's roots.</span>
  <span class="token_comment">// See the source files guide for the declarationFileRoots preset and its tradeoff.</span>
  rootFileNames<span class="token_operator">:</span> <span class="token_keyword">undefined</span><span class="token_punctuation">,</span>
<span class="token_punctuation">})</span>`});var f=d(u,2),m=d(i(f));_(m,{name:`analyzeFromFiles`}),l(7),s(f);var h=d(f,2),v=i(h);y(v,{slug:`source-files`}),l(9),s(h),t(n,a)},$$slots:{default:!0}});var k=d(O,2);h(k,{children:(n,r)=>{var a=C(),o=e(a);g(o,{text:`Dev behavior`});var c=d(o,2),u=d(i(c));p(u,{lang:`ts`,inline:!0,dangerous_raw_html:`discovery<span class="token_operator">:</span> <span class="token_string">'exports'</span>`}),l(3),s(c),l(4),t(n,a)},$$slots:{default:!0}}),t(r,o)},$$slots:{default:!0}}),f()}export{T as t};