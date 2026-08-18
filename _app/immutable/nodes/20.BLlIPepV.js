import"../chunks/DsnmJJEf.js";import{p as E,b as H,i as z,f as k,g as B,a as _,s,c as f,d as a,$ as J,n as l,r as t}from"../chunks/iYPbPufE.js";import{h as K}from"../chunks/Bm5_blfa.js";import{C as m}from"../chunks/FdTAqBrw.js";import{T as N,a as g,b as y}from"../chunks/bBFAaf_v.js";import{D as d}from"../chunks/B0C8H7r1.js";import{M as q}from"../chunks/Ck1zUBrh.js";import{T as A}from"../chunks/BBMkE1cu.js";import{c as Y}from"../chunks/CC8l6xUA.js";var G=f("<!> <ol><li><p>Add the plugin to <code>vite.config.ts</code>:</p> <!></li> <li><p>Add TypeScript support in your <code>app.d.ts</code>:</p> <!></li> <li><p>Import the virtual module anywhere in your app:</p> <!> <p>Both exports match the programmatic <!> shape. See <!> for what flows through <code>diagnostics</code>.</p></li></ol> <p>If TypeScript reports <code>Cannot find module 'virtual:svelte-docinfo'</code>, ensure the <code>/// &lt;reference&gt;</code> line is in your <code>app.d.ts</code>.</p>",1),U=f(`<!> <p>All options are optional; the minimal call uses defaults (package.json exports discovery, glob
			fallback):</p> <!> <p>Every option, with its default:</p> <!> <p>The plugin runs the same pipeline as <!> internally: discover
			via <!>, resolve dependencies, then analyze. <code>sourceOptions</code> is merged with defaults via <!> before discovery; <code>hmrDebounceMs</code> only affects the dev-mode watcher.</p> <p>Paths and patterns resolve against <code>projectRoot</code>: absolute <code>sourcePaths</code> / <code>sourceRoot</code> entries and <code>include</code> / <code>exclude</code> patterns inside the root are accepted (stored root-relative),
			while anything resolving outside it throws at config time instead of silently emitting nothing.</p>`,1),W=f(`<!> <p>The CLI calls <!> once, so use it for CI pipelines and one-off
			generation. The plugin owns a persistent <!>, so
			HMR re-analyses reuse parsed TypeScript ASTs and svelte2tsx output across cycles. Use it when
			the analysis feeds the SvelteKit/Vite bundle. See the <!> guide if you're
			driving a session directly (custom bundler, LSP, etc.).</p>`,1),Q=f(`<!> <p>The plugin hooks into four Vite lifecycle stages:</p> <ol><li><strong>configResolved</strong>: throws synchronously when <code>discovery: 'exports'</code> is combined with <code>include</code>, or when a source
				path or include pattern escapes the project root, so bad configs fail at startup rather than
				at first analysis</li> <li><strong>buildStart</strong>: creates a fresh <!> session, discovers the source set, ingests file
				contents via <code>setFiles</code>, and runs <code>query</code>; caches the serialized JSON
				result</li> <li><strong>resolveId / load</strong>: serves the cached result as <code>virtual:svelte-docinfo</code>, a JavaScript module exporting <code>modules</code>, <code>diagnostics</code>, and a default <code></code></li> <li><strong>configureServer</strong>: watches source directories for changes, debounces
				re-analysis, and sends HMR updates only when the output actually changes. The session diffs
				incoming files by content equality, so unchanged files skip re-parsing entirely.</li></ol>`,1),X=f(`<section><p>The <!> is the recommended path for SvelteKit
			and Vite projects. It runs analysis at build time and serves the result as <!>; in dev mode it watches source
			files and sends HMR updates as you edit.</p></section> <!> <!> <!> <!>`,1);function ls(I,C){E(C,!0);const L=Y("vite-plugin");K("1v4ku2r",b=>{z(()=>{J.title="Vite plugin - svelte-docinfo"})}),N(I,{get tome(){return L},children:(b,ss)=>{var x=X(),w=k(x),$=a(w),S=s(a($));q(S,{module_path:"vite.ts",children:(r,v)=>{l();var n=B("Vite plugin");_(r,n)},$$slots:{default:!0}});var O=s(S,2);m(O,{lang:"ts",inline:!0,dangerous_raw_html:`<span class="token_string">'virtual:svelte-docinfo'</span>`}),l(),t($),t(w);var D=s(w,2);g(D,{children:(r,v)=>{var n=G(),o=k(n);y(o,{text:"Setup"});var p=s(o,2),e=a(p),i=s(a(e),2);m(i,{lang:"ts",dangerous_raw_html:`<span class="token_special_keyword">import</span> <span class="token_punctuation">{</span>defineConfig<span class="token_punctuation">}</span> <span class="token_special_keyword">from</span> <span class="token_string">'vite'</span><span class="token_punctuation">;</span>
<span class="token_special_keyword">import</span> <span class="token_punctuation">{</span>sveltekit<span class="token_punctuation">}</span> <span class="token_special_keyword">from</span> <span class="token_string">'@sveltejs/kit/vite'</span><span class="token_punctuation">;</span>
<span class="token_special_keyword">import</span> svelteDocinfo <span class="token_special_keyword">from</span> <span class="token_string">'svelte-docinfo/vite.js'</span><span class="token_punctuation">;</span>

<span class="token_special_keyword">export</span> <span class="token_special_keyword">default</span> <span class="token_function">defineConfig</span><span class="token_punctuation">({</span>
  plugins<span class="token_operator">:</span> <span class="token_punctuation">[</span><span class="token_function">sveltekit</span><span class="token_punctuation">(),</span> <span class="token_function">svelteDocinfo</span><span class="token_punctuation">()],</span>
<span class="token_punctuation">});</span>`}),t(e);var c=s(e,2),u=s(a(c),2);m(u,{lang:"ts",dangerous_raw_html:'<span class="token_comment">/// &lt;reference types="svelte-docinfo/virtual-svelte-docinfo.js" /></span>'}),t(c);var h=s(c,2),j=s(a(h),2);m(j,{lang:"ts",dangerous_raw_html:`<span class="token_special_keyword">import</span> <span class="token_punctuation">{</span>modules<span class="token_punctuation">,</span> diagnostics<span class="token_punctuation">}</span> <span class="token_special_keyword">from</span> <span class="token_string">'virtual:svelte-docinfo'</span><span class="token_punctuation">;</span>
<span class="token_comment">// or use the default export:</span>
<span class="token_special_keyword">import</span> data <span class="token_special_keyword">from</span> <span class="token_string">'virtual:svelte-docinfo'</span><span class="token_punctuation">;</span>
<span class="token_comment">// data.modules and data.diagnostics are the same as the named exports</span>`});var M=s(j,2),P=s(a(M));d(P,{name:"AnalyzeResultJson"});var V=s(P,2);A(V,{slug:"diagnostics"}),l(3),t(M),t(h),t(p),l(2),_(r,n)},$$slots:{default:!0}});var T=s(D,2);g(T,{children:(r,v)=>{var n=U(),o=k(n);y(o,{text:"Options"});var p=s(o,4);m(p,{lang:"ts",dangerous_raw_html:'<span class="token_function">svelteDocinfo</span><span class="token_punctuation">()</span>'});var e=s(p,4);m(e,{lang:"ts",dangerous_raw_html:`<span class="token_special_keyword">import</span> svelteDocinfo <span class="token_special_keyword">from</span> <span class="token_string">'svelte-docinfo/vite.js'</span><span class="token_punctuation">;</span>

<span class="token_function">svelteDocinfo</span><span class="token_punctuation">({</span>
  <span class="token_comment">// Project root directory. Default: Vite's resolved config.root.</span>
  projectRoot<span class="token_operator">:</span> process<span class="token_punctuation">.</span><span class="token_function">cwd</span><span class="token_punctuation">(),</span>

  <span class="token_comment">// Glob patterns for file discovery. Forces glob mode under discovery: 'auto'.</span>
  <span class="token_comment">// Default: undefined (use exports discovery).</span>
  <span class="token_comment">// Widens the source scope: each pattern's static base joins</span>
  <span class="token_comment">// sourceOptions.sourcePaths (the watcher tracks it too); a pattern with</span>
  <span class="token_comment">// no base scopes the whole project root and logs an info line.</span>
  include<span class="token_operator">:</span> <span class="token_punctuation">[</span><span class="token_string">'src/**/*.ts'</span><span class="token_punctuation">,</span> <span class="token_string">'src/**/*.svelte'</span><span class="token_punctuation">],</span>

  <span class="token_comment">// Exclude globs. An array fully replaces the default</span>
  <span class="token_comment">// ['**/*.test.ts', '**/*.spec.ts', '**/internal/**']; the callback</span>
  <span class="token_comment">// form extends the defaults without restating them. node_modules and</span>
  <span class="token_comment">// dot-directories below a source path are always excluded,</span>
  <span class="token_comment">// independent of this option.</span>
  <span class="token_function_variable token_function">exclude</span><span class="token_operator">:</span> <span class="token_punctuation">(</span>defaults<span class="token_punctuation">)</span> <span class="token_operator">=></span> <span class="token_punctuation">[</span><span class="token_operator">...</span>defaults<span class="token_punctuation">,</span> <span class="token_string">'**/*.gen.ts'</span><span class="token_punctuation">],</span>

  <span class="token_comment">// Discovery strategy: 'auto' | 'exports' | 'glob'. Default: 'auto'.</span>
  <span class="token_comment">// 'auto'    → exports first, glob fallback</span>
  <span class="token_comment">// 'exports' → strict; throws if package.json exports is missing</span>
  <span class="token_comment">// 'glob'    → skip exports, use glob patterns</span>
  discovery<span class="token_operator">:</span> <span class="token_string">'auto'</span><span class="token_punctuation">,</span>

  <span class="token_comment">// Dist directory for exports discovery. Default: 'dist'.</span>
  distDir<span class="token_operator">:</span> <span class="token_string">'dist'</span><span class="token_punctuation">,</span>

  <span class="token_comment">// Resolve module dependency graph. Default: true.</span>
  resolveDependencies<span class="token_operator">:</span> <span class="token_boolean">true</span><span class="token_punctuation">,</span>

  <span class="token_comment">// Dispatch on duplicate declaration names across modules.</span>
  <span class="token_comment">// 'throw' | 'warn' | (duplicates, log) => void.</span>
  <span class="token_comment">// Default: undefined — the duplicate_declaration diagnostic still emits,</span>
  <span class="token_comment">// but no extra dispatch fires. Set to 'throw' to fail fast on duplicates.</span>
  onDuplicates<span class="token_operator">:</span> <span class="token_keyword">undefined</span><span class="token_punctuation">,</span>

  <span class="token_comment">// Partial overrides for default source options (SvelteKit src/lib layout).</span>
  <span class="token_comment">// Merged into createSourceOptions(projectRoot, sourceOptions).</span>
  sourceOptions<span class="token_operator">:</span> <span class="token_punctuation">{</span>sourcePaths<span class="token_operator">:</span> <span class="token_punctuation">[</span><span class="token_string">'src/lib'</span><span class="token_punctuation">]},</span>

  <span class="token_comment">// HMR debounce in ms. Default: 100.</span>
  hmrDebounceMs<span class="token_operator">:</span> <span class="token_number">100</span><span class="token_punctuation">,</span>
<span class="token_punctuation">})</span>`});var i=s(e,2),c=s(a(i));d(c,{name:"analyzeFromFiles"});var u=s(c,2);d(u,{name:"discoverSourceFiles"});var h=s(u,4);d(h,{name:"createSourceOptions"}),l(3),t(i),l(2),_(r,n)},$$slots:{default:!0}});var R=s(T,2);g(R,{children:(r,v)=>{var n=W(),o=k(n);y(o,{text:"CLI vs Vite plugin"});var p=s(o,2),e=s(a(p));d(e,{name:"analyzeFromFiles"});var i=s(e,2);d(i,{name:"createAnalysisSession"});var c=s(i,2);A(c,{slug:"session"}),l(),t(p),_(r,n)},$$slots:{default:!0}});var F=s(R,2);g(F,{children:(r,v)=>{var n=Q(),o=k(n);y(o,{text:"How it works"});var p=s(o,4),e=s(a(p),2),i=s(a(e),2);d(i,{name:"createAnalysisSession"}),l(5),t(e);var c=s(e,2),u=s(a(c),8);u.textContent="{modules, diagnostics}",t(c),l(2),t(p),_(r,n)},$$slots:{default:!0}}),_(b,x)},$$slots:{default:!0}}),H()}export{ls as component};
