import"../chunks/DsnmJJEf.js";import{p as E,b as H,i as z,f as k,g as B,a as _,s,c as f,d as a,$ as J,n as i,r as t}from"../chunks/iYPbPufE.js";import{h as K}from"../chunks/Bm5_blfa.js";import{C as m}from"../chunks/FdTAqBrw.js";import{T as N,a as h,b as y}from"../chunks/B1oPQ0-L.js";import{D as d}from"../chunks/kc7SwQbr.js";import{M as q}from"../chunks/utN56WWo.js";import{T as j}from"../chunks/DI0cBk6P.js";import{c as Y}from"../chunks/DV4D1SGq.js";var G=f("<!> <ol><li><p>Add the plugin to <code>vite.config.ts</code>:</p> <!></li> <li><p>Add TypeScript support in your <code>app.d.ts</code>:</p> <!></li> <li><p>Import the virtual module anywhere in your app:</p> <!> <p>Both exports match the programmatic <!> shape. See <!> for what flows through <code>diagnostics</code>.</p></li></ol> <p>If TypeScript reports <code>Cannot find module 'virtual:svelte-docinfo'</code>, ensure the <code>/// &lt;reference&gt;</code> line is in your <code>app.d.ts</code>.</p>",1),U=f(`<!> <p>All options are optional; the minimal call uses defaults (package.json exports discovery, glob
			fallback):</p> <!> <p>Every option, with its default:</p> <!> <p>The plugin runs the same pipeline as <!> internally: discover
			via <!>, resolve dependencies, then analyze. <code>sourceOptions</code> is merged with defaults via <!> before discovery; <code>hmrDebounceMs</code> only affects the dev-mode watcher.</p>`,1),W=f(`<!> <p>The CLI calls <!> once, so use it for CI pipelines and one-off
			generation. The plugin owns a persistent <!>, so
			HMR re-analyses reuse parsed TypeScript ASTs and svelte2tsx output across cycles. Use it when
			the analysis feeds the SvelteKit/Vite bundle. See the <!> guide if you're
			driving a session directly (custom bundler, LSP, etc.).</p>`,1),Q=f(`<!> <p>The plugin hooks into four Vite lifecycle stages:</p> <ol><li><strong>configResolved</strong>: throws synchronously when <code>discovery: 'exports'</code> is combined with <code>include</code>, so contradictory
				configs fail at startup rather than at first analysis</li> <li><strong>buildStart</strong>: creates a fresh <!> session, discovers the source set, ingests file
				contents via <code>setFiles</code>, and runs <code>query</code>; caches the serialized JSON
				result</li> <li><strong>resolveId / load</strong>: serves the cached result as <code>virtual:svelte-docinfo</code>, a JavaScript module exporting <code>modules</code>, <code>diagnostics</code>, and a default <code></code></li> <li><strong>configureServer</strong>: watches source directories for changes, debounces
				re-analysis, and sends HMR updates only when the output actually changes. The session diffs
				incoming files by content equality, so unchanged files skip re-parsing entirely.</li></ol>`,1),X=f(`<section><p>The <!> is the recommended path for SvelteKit
			and Vite projects. It runs analysis at build time and serves the result as <!>; in dev mode it watches source
			files and sends HMR updates as you edit.</p></section> <!> <!> <!> <!>`,1);function is(C,P){E(P,!0);const L=Y("vite-plugin");K("1v4ku2r",b=>{z(()=>{J.title="Vite plugin - svelte-docinfo"})}),N(C,{get tome(){return L},children:(b,ss)=>{var $=X(),w=k($),x=a(w),S=s(a(x));q(S,{module_path:"vite.ts",children:(r,v)=>{i();var n=B("Vite plugin");_(r,n)},$$slots:{default:!0}});var F=s(S,2);m(F,{lang:"ts",inline:!0,dangerous_raw_html:`<span class="token_string">'virtual:svelte-docinfo'</span>`}),i(),t(x),t(w);var D=s(w,2);h(D,{children:(r,v)=>{var n=G(),o=k(n);y(o,{text:"Setup"});var p=s(o,2),e=a(p),l=s(a(e),2);m(l,{lang:"ts",dangerous_raw_html:`<span class="token_special_keyword">import</span> <span class="token_punctuation">{</span>defineConfig<span class="token_punctuation">}</span> <span class="token_special_keyword">from</span> <span class="token_string">'vite'</span><span class="token_punctuation">;</span>
<span class="token_special_keyword">import</span> <span class="token_punctuation">{</span>sveltekit<span class="token_punctuation">}</span> <span class="token_special_keyword">from</span> <span class="token_string">'@sveltejs/kit/vite'</span><span class="token_punctuation">;</span>
<span class="token_special_keyword">import</span> svelteDocinfo <span class="token_special_keyword">from</span> <span class="token_string">'svelte-docinfo/vite.js'</span><span class="token_punctuation">;</span>

<span class="token_special_keyword">export</span> <span class="token_special_keyword">default</span> <span class="token_function">defineConfig</span><span class="token_punctuation">({</span>
  plugins<span class="token_operator">:</span> <span class="token_punctuation">[</span><span class="token_function">sveltekit</span><span class="token_punctuation">(),</span> <span class="token_function">svelteDocinfo</span><span class="token_punctuation">()],</span>
<span class="token_punctuation">});</span>`}),t(e);var c=s(e,2),u=s(a(c),2);m(u,{lang:"ts",dangerous_raw_html:'<span class="token_comment">/// &lt;reference types="svelte-docinfo/virtual-svelte-docinfo.js" /></span>'}),t(c);var g=s(c,2),R=s(a(g),2);m(R,{lang:"ts",dangerous_raw_html:`<span class="token_special_keyword">import</span> <span class="token_punctuation">{</span>modules<span class="token_punctuation">,</span> diagnostics<span class="token_punctuation">}</span> <span class="token_special_keyword">from</span> <span class="token_string">'virtual:svelte-docinfo'</span><span class="token_punctuation">;</span>
<span class="token_comment">// or use the default export:</span>
<span class="token_special_keyword">import</span> data <span class="token_special_keyword">from</span> <span class="token_string">'virtual:svelte-docinfo'</span><span class="token_punctuation">;</span>
<span class="token_comment">// data.modules and data.diagnostics are the same as the named exports</span>`});var A=s(R,2),I=s(a(A));d(I,{name:"AnalyzeResultJson"});var V=s(I,2);j(V,{slug:"diagnostics"}),i(3),t(A),t(g),t(p),i(2),_(r,n)},$$slots:{default:!0}});var T=s(D,2);h(T,{children:(r,v)=>{var n=U(),o=k(n);y(o,{text:"Options"});var p=s(o,4);m(p,{lang:"ts",dangerous_raw_html:'<span class="token_function">svelteDocinfo</span><span class="token_punctuation">()</span>'});var e=s(p,4);m(e,{lang:"ts",dangerous_raw_html:`<span class="token_special_keyword">import</span> svelteDocinfo <span class="token_special_keyword">from</span> <span class="token_string">'svelte-docinfo/vite.js'</span><span class="token_punctuation">;</span>

<span class="token_function">svelteDocinfo</span><span class="token_punctuation">({</span>
  <span class="token_comment">// Project root directory. Default: Vite's resolved config.root.</span>
  projectRoot<span class="token_operator">:</span> process<span class="token_punctuation">.</span><span class="token_function">cwd</span><span class="token_punctuation">(),</span>

  <span class="token_comment">// Glob patterns for file discovery. Forces glob mode under discovery: 'auto'.</span>
  <span class="token_comment">// Default: undefined (use exports discovery).</span>
  include<span class="token_operator">:</span> <span class="token_punctuation">[</span><span class="token_string">'src/**/*.ts'</span><span class="token_punctuation">,</span> <span class="token_string">'src/**/*.svelte'</span><span class="token_punctuation">],</span>

  <span class="token_comment">// Exclude globs. When provided, fully replaces the default</span>
  <span class="token_comment">// ['**/*.test.ts', '**/*.spec.ts'] — re-include those patterns</span>
  <span class="token_comment">// explicitly if you want them filtered.</span>
  exclude<span class="token_operator">:</span> <span class="token_punctuation">[</span><span class="token_string">'**/*.test.ts'</span><span class="token_punctuation">,</span> <span class="token_string">'**/*.spec.ts'</span><span class="token_punctuation">],</span>

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
<span class="token_punctuation">})</span>`});var l=s(e,2),c=s(a(l));d(c,{name:"analyzeFromFiles"});var u=s(c,2);d(u,{name:"discoverSourceFiles"});var g=s(u,4);d(g,{name:"createSourceOptions"}),i(3),t(l),_(r,n)},$$slots:{default:!0}});var M=s(T,2);h(M,{children:(r,v)=>{var n=W(),o=k(n);y(o,{text:"CLI vs Vite plugin"});var p=s(o,2),e=s(a(p));d(e,{name:"analyzeFromFiles"});var l=s(e,2);d(l,{name:"createAnalysisSession"});var c=s(l,2);j(c,{slug:"session"}),i(),t(p),_(r,n)},$$slots:{default:!0}});var O=s(M,2);h(O,{children:(r,v)=>{var n=Q(),o=k(n);y(o,{text:"How it works"});var p=s(o,4),e=s(a(p),2),l=s(a(e),2);d(l,{name:"createAnalysisSession"}),i(5),t(e);var c=s(e,2),u=s(a(c),8);u.textContent="{modules, diagnostics}",t(c),i(2),t(p),_(r,n)},$$slots:{default:!0}}),_(b,$)},$$slots:{default:!0}}),H()}export{is as component};
