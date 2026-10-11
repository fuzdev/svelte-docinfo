import{$ as e,A as t,G as n,J as r,M as i,P as a,X as o,Z as s,dt as c,ft as l,h as u,ot as d,st as f}from"./Dv5cY9UL.js";import{n as p}from"./xdGjbzzi.js";import{t as m}from"./DDITWWx4.js";import{t as h}from"./CfV_IJW7.js";import{t as g}from"./DQqnZpZk.js";import{t as _}from"./RCyso_65.js";import{n as v,r as y,t as b}from"./DBJcJiSF.js";var x=i(`<!> <p>Requires Vite 6 or later.</p> <ol><li><p>Add the plugin to <code>vite.config.ts</code>:</p> <!></li> <li><p>Add TypeScript support in your <code>app.d.ts</code>:</p> <!></li> <li><p>Import the virtual module anywhere in your app:</p> <!> <p>The shape is <!>, the same as the programmatic
					API. See <!> for <code>diagnostics</code>.</p></li></ol> <p>If TypeScript reports <code>Cannot find module 'virtual:svelte-docinfo'</code>, check the <code>/// &lt;reference&gt;</code> line in <code>app.d.ts</code>.</p>`,1),S=i(`<!> <p>All options are optional; the minimal call discovers files from <code>package.json</code> exports, falling back to glob:</p> <!> <p>Every option, with its default:</p> <!> <p>The plugin runs the same pipeline as <!>: discover,
			resolve dependencies, analyze. In dev, imports resolve through Vite's <code>resolveId</code>,
			so Vite aliases apply; in builds, the TypeScript default resolver is used (it honors tsconfig <code>paths</code>). <code>hmrDebounceMs</code> only affects the dev watcher.</p> <p>Paths and patterns resolve against <code>projectRoot</code>. Absolute paths and patterns
			inside the root are accepted; anything outside it throws at config time.</p>`,1),C=i(`<!> <p>The CLI runs <!> once; use it for CI and one-off
			generation. The plugin keeps a persistent <!>, so
			dev re-analysis reuses parsed ASTs and svelte2tsx output; use it when the analysis feeds your
			app bundle. To drive a session yourself (custom bundler, LSP), see the <!> guide.</p>`,1),w=i(`<!> <p>The plugin hooks into these Vite lifecycle stages:</p> <ol><li><strong>configResolved</strong>: validates options, so bad configs (like <code>discovery: 'exports'</code> with <code>include</code>, or a path outside the project
				root) fail at startup</li> <li><strong>configureServer</strong>: in dev, watches source files and the non-source files they
				import (e.g. <code>internal/</code> modules), debounces re-analysis, and reloads the page
				only when the output changes. Unchanged files aren't re-parsed.</li> <li><strong>buildStart</strong>: creates a session, discovers and ingests the source files, runs <code>query</code>, and caches the result</li> <li><strong>resolveId / load</strong>: serves the cached result as <code>virtual:svelte-docinfo</code>, exporting <code>modules</code>, <code>diagnostics</code>, and a default <code></code></li> <li><strong>buildEnd</strong>: disposes the session, in dev when the server closes or restarts
				and in a build once the bundle's modules have loaded</li></ol> <p>Any change to the docs data reloads the page, even one that only shifts a declaration's source
			line, instead of letting Svelte HMR update components in place. Importers build state from the
			data (like a layout building a library from <code>modules</code>), so re-running the module
			alone would leave them stale.</p>`,1),T=i(`<section><p>The <!> is the recommended path for
			SvelteKit and Vite projects. It runs analysis at build time and serves the result as <!>. In dev it watches your source
			files, plus non-source files they import like <code>internal/</code> modules, and reloads the
			page when an edit changes the result.</p></section> <!> <!> <!> <!>`,1);function E(i,E){f(E,!0);let D=p(`vite-plugin`);u(`1v4ku2r`,e=>{n(()=>{r.title=`Vite plugin - svelte-docinfo`})}),y(i,{get tome(){return D},children:(n,r)=>{var i=T(),u=s(i),d=o(u),f=e(o(d));g(f,{module_path:`vite.ts`,children:(e,n)=>{c();var r=a(`Vite plugin`);t(e,r)},$$slots:{default:!0}});var p=e(f,2);_(p,{lang:`ts`,inline:!0,dangerous_raw_html:`<span class="token_string">'virtual:svelte-docinfo'</span>`}),c(3),l(d),l(u);var y=e(u,2);v(y,{children:(n,r)=>{var i=x(),a=s(i);b(a,{text:`Setup`});var u=e(a,4),d=o(u),f=e(o(d),2);_(f,{lang:`ts`,dangerous_raw_html:`<span class="token_special_keyword">import</span> <span class="token_punctuation">{</span>defineConfig<span class="token_punctuation">}</span> <span class="token_special_keyword">from</span> <span class="token_string">'vite'</span><span class="token_punctuation">;</span>
<span class="token_special_keyword">import</span> <span class="token_punctuation">{</span>sveltekit<span class="token_punctuation">}</span> <span class="token_special_keyword">from</span> <span class="token_string">'@sveltejs/kit/vite'</span><span class="token_punctuation">;</span>
<span class="token_special_keyword">import</span> svelteDocinfo <span class="token_special_keyword">from</span> <span class="token_string">'svelte-docinfo/vite.js'</span><span class="token_punctuation">;</span>

<span class="token_special_keyword">export</span> <span class="token_special_keyword">default</span> <span class="token_function">defineConfig</span><span class="token_punctuation">({</span>
  plugins<span class="token_operator">:</span> <span class="token_punctuation">[</span><span class="token_function">sveltekit</span><span class="token_punctuation">(),</span> <span class="token_function">svelteDocinfo</span><span class="token_punctuation">()],</span>
<span class="token_punctuation">});</span>`}),l(d);var p=e(d,2),g=e(o(p),2);_(g,{lang:`ts`,dangerous_raw_html:`<span class="token_comment">/// &lt;reference types="svelte-docinfo/virtual-svelte-docinfo.js" /></span>`}),l(p);var v=e(p,2),y=e(o(v),2);_(y,{lang:`ts`,dangerous_raw_html:`<span class="token_special_keyword">import</span> <span class="token_punctuation">{</span>modules<span class="token_punctuation">,</span> diagnostics<span class="token_punctuation">}</span> <span class="token_special_keyword">from</span> <span class="token_string">'virtual:svelte-docinfo'</span><span class="token_punctuation">;</span>
<span class="token_comment">// or use the default export:</span>
<span class="token_special_keyword">import</span> data <span class="token_special_keyword">from</span> <span class="token_string">'virtual:svelte-docinfo'</span><span class="token_punctuation">;</span>
<span class="token_comment">// data.modules and data.diagnostics are the same as the named exports</span>`});var S=e(y,2),C=e(o(S));h(C,{name:`AnalyzeResultJson`});var w=e(C,2);m(w,{slug:`diagnostics`}),c(3),l(S),l(v),l(u),c(2),t(n,i)},$$slots:{default:!0}});var E=e(y,2);v(E,{children:(n,r)=>{var i=S(),a=s(i);b(a,{text:`Options`});var u=e(a,4);_(u,{lang:`ts`,dangerous_raw_html:`<span class="token_function">svelteDocinfo</span><span class="token_punctuation">()</span>`});var d=e(u,4);_(d,{lang:`ts`,dangerous_raw_html:`<span class="token_special_keyword">import</span> svelteDocinfo <span class="token_special_keyword">from</span> <span class="token_string">'svelte-docinfo/vite.js'</span><span class="token_punctuation">;</span>

<span class="token_function">svelteDocinfo</span><span class="token_punctuation">({</span>
  <span class="token_comment">// Project root directory. Default: Vite's resolved config.root.</span>
  projectRoot<span class="token_operator">:</span> process<span class="token_punctuation">.</span><span class="token_function">cwd</span><span class="token_punctuation">(),</span>

  <span class="token_comment">// Glob patterns for file discovery. Forces glob mode under discovery: 'auto'.</span>
  <span class="token_comment">// Default: undefined (use exports discovery).</span>
  <span class="token_comment">// Each pattern's static base joins sourceOptions.sourcePaths; a pattern</span>
  <span class="token_comment">// with no base makes the whole project root source and logs an info line.</span>
  include<span class="token_operator">:</span> <span class="token_punctuation">[</span><span class="token_string">'src/**/*.ts'</span><span class="token_punctuation">,</span> <span class="token_string">'src/**/*.svelte'</span><span class="token_punctuation">],</span>

  <span class="token_comment">// Exclude globs. An array replaces the default</span>
  <span class="token_comment">// ['**/*.test.ts', '**/*.spec.ts', '**/internal/**']; a callback extends</span>
  <span class="token_comment">// it. Replaces sourceOptions.exclude when both are set. node_modules and</span>
  <span class="token_comment">// dot-directories are always excluded.</span>
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
<span class="token_punctuation">})</span>`});var f=e(d,2),p=e(o(f));h(p,{name:`analyzeFromFiles`}),c(7),l(f),c(2),t(n,i)},$$slots:{default:!0}});var D=e(E,2);v(D,{children:(n,r)=>{var i=C(),a=s(i);b(a,{text:`CLI vs Vite plugin`});var u=e(a,2),d=e(o(u));h(d,{name:`analyzeFromFiles`});var f=e(d,2);h(f,{name:`createAnalysisSession`});var p=e(f,2);m(p,{slug:`session`}),c(),l(u),t(n,i)},$$slots:{default:!0}});var O=e(D,2);v(O,{children:(n,r)=>{var i=w(),a=s(i);b(a,{text:`How it works`});var u=e(a,4),d=e(o(u),6),f=e(o(d),8);f.textContent=`{modules, diagnostics}`,l(d),c(2),l(u),c(2),t(n,i)},$$slots:{default:!0}}),t(n,i)},$$slots:{default:!0}}),d()}export{E as t};