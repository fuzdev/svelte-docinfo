import"../chunks/DsnmJJEf.js";import{p as E,c as F,e as H,f,a as m,ad as B,b as _,s,d as e,$ as J,ai as r,r as t}from"../chunks/CuIJZvP6.js";import{h as K}from"../chunks/BTPVYJhH.js";import{C as k}from"../chunks/aUjUCLhX.js";import{T as N,a as h,b as y}from"../chunks/CogwKM9i.js";import{D as u}from"../chunks/BPj1lf8M.js";import{M as Y}from"../chunks/eGggYFJS.js";import{T as j}from"../chunks/zTkTidZd.js";import{c as q}from"../chunks/Dbjfq-WG.js";var G=f("<!> <ol><li><p>Add the plugin to <code>vite.config.ts</code>:</p> <!></li> <li><p>Add TypeScript support in your <code>app.d.ts</code>:</p> <!></li> <li><p>Import the virtual module anywhere in your app:</p> <!> <p>Both exports match the programmatic <!> shape. See <!> for what flows through <code>diagnostics</code>.</p></li></ol> <p>If TypeScript reports <code>Cannot find module 'virtual:svelte-docinfo'</code>, ensure the <code>/// &lt;reference&gt;</code> line is in your <code>app.d.ts</code>.</p>",1),U=f(`<!> <p>All options are optional; the minimal call uses defaults (package.json exports discovery, glob
			fallback):</p> <!> <p>Every option, with its default:</p> <!> <p>The plugin runs the same pipeline as <!> internally: discover
			via <!>, resolve dependencies, then analyze. <code>sourceOptions</code> is merged with defaults via <!> before discovery; <code>hmrDebounceMs</code> only affects the dev-mode watcher.</p>`,1),W=f(`<!> <p>The CLI calls <!> once, so use it for CI pipelines and one-off
			generation. The plugin owns a persistent <!>, so
			HMR re-analyses reuse parsed TypeScript ASTs and svelte2tsx output across cycles. Use it when
			the analysis feeds the SvelteKit/Vite bundle. See the <!> guide if you're
			driving a session directly (custom bundler, LSP, etc.).</p>`,1),Q=f(`<!> <p>The plugin hooks into four Vite lifecycle stages:</p> <ol><li><strong>configResolved</strong>: throws synchronously when <code>discovery: 'exports'</code> is combined with <code>include</code>, so contradictory
				configs fail at startup rather than at first analysis</li> <li><strong>buildStart</strong>: discovers the source set, reads file contents, and runs <!>'s <code>analyze</code>; caches the
				serialized JSON result</li> <li><strong>resolveId / load</strong>: serves the cached result as <code>virtual:svelte-docinfo</code>, a JavaScript module exporting <code>modules</code>, <code>diagnostics</code>, and a default <code></code></li> <li><strong>configureServer</strong>: watches source directories for changes, debounces
				re-analysis, and sends HMR updates only when the output actually changes. The session diffs
				incoming files by content equality, so unchanged files skip re-parsing entirely.</li></ol>`,1),X=f(`<section><p>The <!> is the recommended path for SvelteKit
			and Vite projects. It runs analysis at build time and serves the result as <!>; in dev mode it watches source
			files and sends HMR updates as you edit.</p></section> <!> <!> <!> <!>`,1);function rs(C,P){E(P,!0);const L=q("vite-plugin");K("1v4ku2r",b=>{H(()=>{J.title="Vite plugin - svelte-docinfo"})}),N(C,{get tome(){return L},children:(b,ss)=>{var $=X(),w=m($),x=e(w),S=s(e(x));Y(S,{module_path:"vite.ts",children:(l,v)=>{r();var n=B("Vite plugin");_(l,n)},$$slots:{default:!0}});var O=s(S,2);k(O,{lang:"ts",inline:!0,dangerous_raw_html:`<span class="token_string">'virtual:svelte-docinfo'</span>`}),r(),t(x),t(w);var D=s(w,2);h(D,{children:(l,v)=>{var n=G(),o=m(n);y(o,{text:"Setup"});var p=s(o,2),a=e(p),i=s(e(a),2);k(i,{lang:"ts",dangerous_raw_html:`<span class="token_special_keyword">import</span> <span class="token_punctuation">{</span>defineConfig<span class="token_punctuation">}</span> <span class="token_special_keyword">from</span> <span class="token_string">'vite'</span><span class="token_punctuation">;</span>
<span class="token_special_keyword">import</span> <span class="token_punctuation">{</span>sveltekit<span class="token_punctuation">}</span> <span class="token_special_keyword">from</span> <span class="token_string">'@sveltejs/kit/vite'</span><span class="token_punctuation">;</span>
<span class="token_special_keyword">import</span> svelteDocinfo <span class="token_special_keyword">from</span> <span class="token_string">'svelte-docinfo/vite.js'</span><span class="token_punctuation">;</span>

<span class="token_special_keyword">export</span> <span class="token_special_keyword">default</span> <span class="token_function">defineConfig</span><span class="token_punctuation">(</span><span class="token_punctuation">{</span>
  plugins<span class="token_operator">:</span> <span class="token_punctuation">[</span><span class="token_function">sveltekit</span><span class="token_punctuation">(</span><span class="token_punctuation">)</span><span class="token_punctuation">,</span> <span class="token_function">svelteDocinfo</span><span class="token_punctuation">(</span><span class="token_punctuation">)</span><span class="token_punctuation">]</span><span class="token_punctuation">,</span>
<span class="token_punctuation">}</span><span class="token_punctuation">)</span><span class="token_punctuation">;</span>`}),t(a);var c=s(a,2),d=s(e(c),2);k(d,{lang:"ts",dangerous_raw_html:'<span class="token_comment">/// &lt;reference types="svelte-docinfo/virtual-svelte-docinfo.js" /></span>'}),t(c);var g=s(c,2),R=s(e(g),2);k(R,{lang:"ts",dangerous_raw_html:`<span class="token_special_keyword">import</span> <span class="token_punctuation">{</span>modules<span class="token_punctuation">,</span> diagnostics<span class="token_punctuation">}</span> <span class="token_special_keyword">from</span> <span class="token_string">'virtual:svelte-docinfo'</span><span class="token_punctuation">;</span>
<span class="token_comment">// or use the default export:</span>
<span class="token_special_keyword">import</span> data <span class="token_special_keyword">from</span> <span class="token_string">'virtual:svelte-docinfo'</span><span class="token_punctuation">;</span>
<span class="token_comment">// data.modules and data.diagnostics are the same as the named exports</span>`});var A=s(R,2),I=s(e(A));u(I,{name:"AnalyzeResultJson"});var z=s(I,2);j(z,{slug:"diagnostics"}),r(3),t(A),t(g),t(p),r(2),_(l,n)},$$slots:{default:!0}});var T=s(D,2);h(T,{children:(l,v)=>{var n=U(),o=m(n);y(o,{text:"Options"});var p=s(o,4);k(p,{lang:"ts",dangerous_raw_html:'<span class="token_function">svelteDocinfo</span><span class="token_punctuation">(</span><span class="token_punctuation">)</span>'});var a=s(p,4);k(a,{lang:"ts",dangerous_raw_html:`<span class="token_special_keyword">import</span> svelteDocinfo <span class="token_special_keyword">from</span> <span class="token_string">'svelte-docinfo/vite.js'</span><span class="token_punctuation">;</span>

<span class="token_function">svelteDocinfo</span><span class="token_punctuation">(</span><span class="token_punctuation">{</span>
  <span class="token_comment">// Project root directory. Default: Vite's resolved config.root.</span>
  projectRoot<span class="token_operator">:</span> process<span class="token_punctuation">.</span><span class="token_function">cwd</span><span class="token_punctuation">(</span><span class="token_punctuation">)</span><span class="token_punctuation">,</span>

  <span class="token_comment">// Glob patterns for file discovery. Forces glob mode under discovery: 'auto'.</span>
  <span class="token_comment">// Default: undefined (use exports discovery).</span>
  include<span class="token_operator">:</span> <span class="token_punctuation">[</span><span class="token_string">'src/**/*.ts'</span><span class="token_punctuation">,</span> <span class="token_string">'src/**/*.svelte'</span><span class="token_punctuation">]</span><span class="token_punctuation">,</span>

  <span class="token_comment">// Exclude globs. When provided, fully replaces the default</span>
  <span class="token_comment">// ['**/*.test.ts', '**/*.spec.ts'] — re-include those patterns</span>
  <span class="token_comment">// explicitly if you want them filtered.</span>
  exclude<span class="token_operator">:</span> <span class="token_punctuation">[</span><span class="token_string">'**/*.test.ts'</span><span class="token_punctuation">,</span> <span class="token_string">'**/*.spec.ts'</span><span class="token_punctuation">]</span><span class="token_punctuation">,</span>

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
  sourceOptions<span class="token_operator">:</span> <span class="token_punctuation">{</span>sourcePaths<span class="token_operator">:</span> <span class="token_punctuation">[</span><span class="token_string">'src/lib'</span><span class="token_punctuation">]</span><span class="token_punctuation">}</span><span class="token_punctuation">,</span>

  <span class="token_comment">// HMR debounce in ms. Default: 100.</span>
  hmrDebounceMs<span class="token_operator">:</span> <span class="token_number">100</span><span class="token_punctuation">,</span>
<span class="token_punctuation">}</span><span class="token_punctuation">)</span>`});var i=s(a,2),c=s(e(i));u(c,{name:"analyzeFromFiles"});var d=s(c,2);u(d,{name:"discoverSourceFiles"});var g=s(d,4);u(g,{name:"createSourceOptions"}),r(3),t(i),_(l,n)},$$slots:{default:!0}});var M=s(T,2);h(M,{children:(l,v)=>{var n=W(),o=m(n);y(o,{text:"CLI vs Vite plugin"});var p=s(o,2),a=s(e(p));u(a,{name:"analyzeFromFiles"});var i=s(a,2);u(i,{name:"createAnalysisSession"});var c=s(i,2);j(c,{slug:"session"}),r(),t(p),_(l,n)},$$slots:{default:!0}});var V=s(M,2);h(V,{children:(l,v)=>{var n=Q(),o=m(n);y(o,{text:"How it works"});var p=s(o,4),a=s(e(p),2),i=s(e(a),2);u(i,{name:"createAnalysisSession"}),r(3),t(a);var c=s(a,2),d=s(e(c),8);d.textContent="{modules, diagnostics}",t(c),r(2),t(p),_(l,n)},$$slots:{default:!0}}),_(b,$)},$$slots:{default:!0}}),F()}export{rs as component};
