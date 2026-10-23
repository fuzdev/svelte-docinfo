import{$ as e,A as t,G as n,J as r,M as i,P as a,X as o,Z as s,dt as c,ft as l,h as u,ot as d,st as f}from"./Dv5cY9UL.js";import{o as p}from"./COY1KSPd.js";import{t as m}from"./BlpeCiy-.js";import{i as h,n as g,r as _,t as v}from"./COVud6_C.js";import{t as y}from"./CJXZ7M5E.js";import{t as b}from"./Di2O_w4E.js";var x=i(`<!> <p>Requires Vite 6 or later.</p> <ol><li><p>Add the plugin to <code>vite.config.ts</code>:</p> <!></li> <li><p>Add TypeScript support in your <code>app.d.ts</code>:</p> <!></li> <li><p>Import the virtual module anywhere in your app:</p> <!> <p>The data is <!> in its wire form
					(<!>). <code>modules</code> and <code>diagnostics</code> are always arrays, but entries in <code>modules</code> omit empty
					arrays and <code>false</code> flags. Pass the data through <!> to restore them, or treat absent as empty
					(see <!>). See <!> for <code>diagnostics</code>.</p></li></ol> <p>If TypeScript reports <code>Cannot find module 'virtual:svelte-docinfo'</code>, check the <code>/// &lt;reference&gt;</code> line in <code>app.d.ts</code>.</p>`,1),S=i(`<!> <p>All options are optional; the minimal call discovers files from <code>package.json</code> exports, falling back to glob:</p> <!> <p>Every option, with its default in the comment above it:</p> <!> <p>The plugin runs the same pipeline as <!>: discover,
			resolve dependencies, analyze. In dev, imports resolve through Vite's <code>resolveId</code>,
			so Vite aliases apply; in builds, the TypeScript default resolver is used (it honors tsconfig <code>paths</code>). <code>hmrDebounceMs</code> only affects the dev watcher.</p> <p>Paths and patterns resolve against <code>projectRoot</code>; see <!> for how <code>include</code>, <code>exclude</code>, and the source paths combine.</p>`,1),C=i(`<!> <p>Options are validated when Vite resolves its config, so a bad one (like <code>discovery: 'exports'</code> with <code>include</code>, or a path outside the project
			root) fails at startup.</p> <p>In dev the plugin watches the source files and the files they import, debounces re-analysis by <code>hmrDebounceMs</code>, and re-parses only what changed. Only the files discovery selects
			emit modules, as in a build: an edit elsewhere refreshes the analysis without adding a module,
			and a newly created file is checked against discovery again.</p> <p>Any change to the output reloads the page, even one that only shifts a declaration's source
			line, instead of letting Svelte HMR update components in place. Importers build state from the
			data (like a layout building a library from <code>modules</code>), so re-running the module
			alone would leave them stale.</p>`,1),w=i(`<section><p>The <!> is the recommended path for
			SvelteKit and Vite projects. It runs analysis at build time and serves the result as <!>. In dev it watches your source
			files, plus the other files they import like <code>internal/</code> modules, and reloads the
			page when an edit changes the result.</p> <p>The plugin keeps a persistent <!>, so dev
			re-analysis reuses parsed ASTs and svelte2tsx output. For one-off generation and CI, the <!> runs <!> once.</p></section> <!> <!> <!>`,1);function T(i,T){f(T,!0);let E=p(`vite-plugin`);u(`1v4ku2r`,e=>{n(()=>{r.title=`Vite plugin - svelte-docinfo`})}),_(i,{get tome(){return E},children:(n,r)=>{var i=w(),u=s(i),d=o(u),f=e(o(d));y(f,{module_path:`vite.ts`,children:(e,n)=>{c();var r=a(`Vite plugin`);t(e,r)},$$slots:{default:!0}});var p=e(f,2);b(p,{lang:`ts`,inline:!0,dangerous_raw_html:`<span class="token_string">'virtual:svelte-docinfo'</span>`}),c(3),l(d);var _=e(d,2),T=e(o(_));h(T,{name:`createAnalysisSession`});var E=e(T,2);m(E,{slug:`cli`});var D=e(E,2);h(D,{name:`analyzeFromFiles`}),c(),l(_),l(u);var O=e(u,2);g(O,{children:(n,r)=>{var i=x(),u=s(i);v(u,{text:`Setup`});var d=e(u,4),f=o(d),p=e(o(f),2);b(p,{lang:`ts`,dangerous_raw_html:`<span class="token_special_keyword">import</span> <span class="token_punctuation">{</span>defineConfig<span class="token_punctuation">}</span> <span class="token_special_keyword">from</span> <span class="token_string">'vite'</span><span class="token_punctuation">;</span>
<span class="token_special_keyword">import</span> <span class="token_punctuation">{</span>sveltekit<span class="token_punctuation">}</span> <span class="token_special_keyword">from</span> <span class="token_string">'@sveltejs/kit/vite'</span><span class="token_punctuation">;</span>
<span class="token_special_keyword">import</span> svelteDocinfo <span class="token_special_keyword">from</span> <span class="token_string">'svelte-docinfo/vite.js'</span><span class="token_punctuation">;</span>

<span class="token_special_keyword">export</span> <span class="token_special_keyword">default</span> <span class="token_function">defineConfig</span><span class="token_punctuation">({</span>
  plugins<span class="token_operator">:</span> <span class="token_punctuation">[</span><span class="token_function">sveltekit</span><span class="token_punctuation">(),</span> <span class="token_function">svelteDocinfo</span><span class="token_punctuation">()],</span>
<span class="token_punctuation">});</span>`}),l(f);var g=e(f,2),_=e(o(g),2);b(_,{lang:`ts`,dangerous_raw_html:`<span class="token_comment">/// &lt;reference types="svelte-docinfo/virtual-svelte-docinfo.js" /></span>`}),l(g);var y=e(g,2),S=e(o(y),2);b(S,{lang:`ts`,dangerous_raw_html:`<span class="token_special_keyword">import</span> <span class="token_punctuation">{</span>modules<span class="token_punctuation">,</span> diagnostics<span class="token_punctuation">}</span> <span class="token_special_keyword">from</span> <span class="token_string">'virtual:svelte-docinfo'</span><span class="token_punctuation">;</span>
<span class="token_comment">// or use the default export:</span>
<span class="token_special_keyword">import</span> data <span class="token_special_keyword">from</span> <span class="token_string">'virtual:svelte-docinfo'</span><span class="token_punctuation">;</span>
<span class="token_comment">// data.modules and data.diagnostics are the same as the named exports</span>`});var C=e(S,2),w=e(o(C));h(w,{name:`AnalyzeResultJson`});var T=e(w,2);h(T,{name:`AnalyzeResultJsonWire`});var E=e(T,10);h(E,{name:`parseAnalyzeResult`});var D=e(E,2);m(D,{slug:`output-format`,hash:`Compact-JSON-and-absent-as-false`,children:(e,n)=>{c();var r=a(`compact JSON`);t(e,r)},$$slots:{default:!0}});var O=e(D,2);m(O,{slug:`diagnostics`}),c(3),l(C),l(y),l(d),c(2),t(n,i)},$$slots:{default:!0}});var k=e(O,2);g(k,{children:(n,r)=>{var i=S(),u=s(i);v(u,{text:`Options`});var d=e(u,4);b(d,{lang:`ts`,dangerous_raw_html:`<span class="token_function">svelteDocinfo</span><span class="token_punctuation">()</span>`});var f=e(d,4);b(f,{lang:`ts`,dangerous_raw_html:`<span class="token_special_keyword">import</span> svelteDocinfo <span class="token_special_keyword">from</span> <span class="token_string">'svelte-docinfo/vite.js'</span><span class="token_punctuation">;</span>

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
  <span class="token_comment">// See the session guide for the declarationFileRoots preset and its tradeoff.</span>
  rootFileNames<span class="token_operator">:</span> <span class="token_keyword">undefined</span><span class="token_punctuation">,</span>
<span class="token_punctuation">})</span>`});var p=e(f,2),g=e(o(p));h(g,{name:`analyzeFromFiles`}),c(7),l(p);var _=e(p,2),y=e(o(_),3);m(y,{slug:`build-tools`,hash:`Source-scope`,children:(e,n)=>{c();var r=a(`source scope`);t(e,r)},$$slots:{default:!0}}),c(5),l(_),t(n,i)},$$slots:{default:!0}});var A=e(k,2);g(A,{children:(e,n)=>{var r=C(),i=s(r);v(i,{text:`Dev behavior`}),c(6),t(e,r)},$$slots:{default:!0}}),t(n,i)},$$slots:{default:!0}}),d()}export{T as t};