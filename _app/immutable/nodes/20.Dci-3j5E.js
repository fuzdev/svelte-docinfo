import"../chunks/DsnmJJEf.js";import{p as O,b as F,i as z,f as _,g as B,a as d,s,c as k,d as o,$ as K,n as l,r as p}from"../chunks/iYPbPufE.js";import{h as N}from"../chunks/Bm5_blfa.js";import{C as u}from"../chunks/D9PntOCU.js";import{T as Y,a as f,b as v}from"../chunks/DWAjGfvL.js";import{D as g}from"../chunks/CUxUz_S-.js";import{M as q}from"../chunks/B8K4q-MO.js";import{T as A}from"../chunks/FNQkTWje.js";import{c as G}from"../chunks/BUeY-gI9.js";var J=k(`<!> <ol><li><p>Add the plugin to <code>vite.config.ts</code>:</p> <!></li> <li><p>Add TypeScript support in your <code>app.d.ts</code>:</p> <!></li> <li><p>Import the virtual module anywhere in your app:</p> <!> <p>The shape is <!>, the same as the programmatic
					API. See <!> for <code>diagnostics</code>.</p></li></ol> <p>If TypeScript reports <code>Cannot find module 'virtual:svelte-docinfo'</code>, check the <code>/// &lt;reference&gt;</code> line in <code>app.d.ts</code>.</p>`,1),U=k(`<!> <p>All options are optional; the minimal call discovers files from <code>package.json</code> exports, falling back to glob:</p> <!> <p>Every option, with its default:</p> <!> <p>The plugin runs the same pipeline as <!>: discover,
			resolve dependencies, analyze. In dev, imports resolve through Vite's <code>resolveId</code>,
			so Vite aliases apply; in builds, the TypeScript default resolver is used (it honors tsconfig <code>paths</code>). <code>hmrDebounceMs</code> only affects the dev watcher.</p> <p>Paths and patterns resolve against <code>projectRoot</code>. Absolute paths and patterns
			inside the root are accepted; anything outside it throws at config time.</p>`,1),Q=k(`<!> <p>The CLI runs <!> once; use it for CI and one-off
			generation. The plugin keeps a persistent <!>, so
			HMR re-analysis reuses parsed ASTs and svelte2tsx output; use it when the analysis feeds your
			app bundle. To drive a session yourself (custom bundler, LSP), see the <!> guide.</p>`,1),W=k(`<!> <p>The plugin hooks into four Vite lifecycle stages:</p> <ol><li><strong>configResolved</strong>: validates options, so bad configs (like <code>discovery: 'exports'</code> with <code>include</code>, or a path outside the project
				root) fail at startup</li> <li><strong>buildStart</strong>: creates a session, discovers and ingests the source files, runs <code>query</code>, and caches the result</li> <li><strong>resolveId / load</strong>: serves the cached result as <code>virtual:svelte-docinfo</code>, exporting <code>modules</code>, <code>diagnostics</code>, and a default <code></code></li> <li><strong>configureServer</strong>: watches source files and the non-source files they import
				(e.g. <code>internal/</code> modules), debounces re-analysis, and sends an HMR update only
				when the output changes. Unchanged files aren't re-parsed.</li></ol>`,1),X=k(`<section><p>The <!> is the recommended path for
			SvelteKit and Vite projects. It runs analysis at build time and serves the result as <!>. In dev it watches your source
			files, plus non-source files they import like <code>internal/</code> modules, and sends HMR
			updates as you edit.</p></section> <!> <!> <!> <!>`,1);function is(M,P){O(P,!0);const C=G("vite-plugin");N("1v4ku2r",y=>{z(()=>{K.title="Vite plugin - svelte-docinfo"})}),Y(M,{get tome(){return C},children:(y,ss)=>{var w=X(),h=_(w),b=o(h),$=s(o(b));q($,{module_path:"vite.ts",children:(c,m)=>{l();var n=B("Vite plugin");d(c,n)},$$slots:{default:!0}});var L=s($,2);u(L,{lang:"ts",inline:!0,dangerous_raw_html:`<span class="token_string">'virtual:svelte-docinfo'</span>`}),l(3),p(b),p(h);var x=s(h,2);f(x,{children:(c,m)=>{var n=J(),a=_(n);v(a,{text:"Setup"});var t=s(a,2),e=o(t),r=s(o(e),2);u(r,{lang:"ts",dangerous_raw_html:`<span class="token_special_keyword">import</span> <span class="token_punctuation">{</span>defineConfig<span class="token_punctuation">}</span> <span class="token_special_keyword">from</span> <span class="token_string">'vite'</span><span class="token_punctuation">;</span>
<span class="token_special_keyword">import</span> <span class="token_punctuation">{</span>sveltekit<span class="token_punctuation">}</span> <span class="token_special_keyword">from</span> <span class="token_string">'@sveltejs/kit/vite'</span><span class="token_punctuation">;</span>
<span class="token_special_keyword">import</span> svelteDocinfo <span class="token_special_keyword">from</span> <span class="token_string">'svelte-docinfo/vite.js'</span><span class="token_punctuation">;</span>

<span class="token_special_keyword">export</span> <span class="token_special_keyword">default</span> <span class="token_function">defineConfig</span><span class="token_punctuation">({</span>
  plugins<span class="token_operator">:</span> <span class="token_punctuation">[</span><span class="token_function">sveltekit</span><span class="token_punctuation">(),</span> <span class="token_function">svelteDocinfo</span><span class="token_punctuation">()],</span>
<span class="token_punctuation">});</span>`}),p(e);var i=s(e,2),E=s(o(i),2);u(E,{lang:"ts",dangerous_raw_html:'<span class="token_comment">/// &lt;reference types="svelte-docinfo/virtual-svelte-docinfo.js" /></span>'}),p(i);var S=s(i,2),I=s(o(S),2);u(I,{lang:"ts",dangerous_raw_html:`<span class="token_special_keyword">import</span> <span class="token_punctuation">{</span>modules<span class="token_punctuation">,</span> diagnostics<span class="token_punctuation">}</span> <span class="token_special_keyword">from</span> <span class="token_string">'virtual:svelte-docinfo'</span><span class="token_punctuation">;</span>
<span class="token_comment">// or use the default export:</span>
<span class="token_special_keyword">import</span> data <span class="token_special_keyword">from</span> <span class="token_string">'virtual:svelte-docinfo'</span><span class="token_punctuation">;</span>
<span class="token_comment">// data.modules and data.diagnostics are the same as the named exports</span>`});var R=s(I,2),j=s(o(R));g(j,{name:"AnalyzeResultJson"});var H=s(j,2);A(H,{slug:"diagnostics"}),l(3),p(R),p(S),p(t),l(2),d(c,n)},$$slots:{default:!0}});var D=s(x,2);f(D,{children:(c,m)=>{var n=U(),a=_(n);v(a,{text:"Options"});var t=s(a,4);u(t,{lang:"ts",dangerous_raw_html:'<span class="token_function">svelteDocinfo</span><span class="token_punctuation">()</span>'});var e=s(t,4);u(e,{lang:"ts",dangerous_raw_html:`<span class="token_special_keyword">import</span> svelteDocinfo <span class="token_special_keyword">from</span> <span class="token_string">'svelte-docinfo/vite.js'</span><span class="token_punctuation">;</span>

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

  <span class="token_comment">// Dispatch on duplicate declaration names across modules.</span>
  <span class="token_comment">// 'throw' | 'warn' | (duplicates, log) => void.</span>
  <span class="token_comment">// Default: undefined (only the duplicate_declaration diagnostic).</span>
  <span class="token_comment">// Set to 'throw' to fail fast on duplicates.</span>
  onDuplicates<span class="token_operator">:</span> <span class="token_keyword">undefined</span><span class="token_punctuation">,</span>

  <span class="token_comment">// Partial overrides for default source options (SvelteKit src/lib layout).</span>
  <span class="token_comment">// Merged into createSourceOptions(projectRoot, sourceOptions).</span>
  sourceOptions<span class="token_operator">:</span> <span class="token_punctuation">{</span>sourcePaths<span class="token_operator">:</span> <span class="token_punctuation">[</span><span class="token_string">'src/lib'</span><span class="token_punctuation">]},</span>

  <span class="token_comment">// HMR debounce in ms. Default: 100.</span>
  hmrDebounceMs<span class="token_operator">:</span> <span class="token_number">100</span><span class="token_punctuation">,</span>
<span class="token_punctuation">})</span>`});var r=s(e,2),i=s(o(r));g(i,{name:"analyzeFromFiles"}),l(7),p(r),l(2),d(c,n)},$$slots:{default:!0}});var T=s(D,2);f(T,{children:(c,m)=>{var n=Q(),a=_(n);v(a,{text:"CLI vs Vite plugin"});var t=s(a,2),e=s(o(t));g(e,{name:"analyzeFromFiles"});var r=s(e,2);g(r,{name:"createAnalysisSession"});var i=s(r,2);A(i,{slug:"session"}),l(),p(t),d(c,n)},$$slots:{default:!0}});var V=s(T,2);f(V,{children:(c,m)=>{var n=W(),a=_(n);v(a,{text:"How it works"});var t=s(a,4),e=s(o(t),4),r=s(o(e),8);r.textContent="{modules, diagnostics}",p(e),l(2),p(t),d(c,n)},$$slots:{default:!0}}),d(y,w)},$$slots:{default:!0}}),F()}export{is as component};
