import{$ as e,G as t,N as n,Q as r,Y as i,Z as a,ct as o,j as s,k as c,lt as l,mt as u,pt as d,v as f}from"./B1I_stDj.js";import"./xihTtKlq.js";import{n as p}from"./UpetHRea.js";import{t as m}from"./Ux2LPEv6.js";import{t as h}from"./B9Puxzxu.js";import{t as g}from"./DtYEwZTL.js";import{t as _}from"./Xh6-IssL.js";import{n as v,r as y,t as b}from"./C4dfbF9E.js";var x=s(`<!> <ol><li><p>Add the plugin to <code>vite.config.ts</code>:</p> <!></li> <li><p>Add TypeScript support in your <code>app.d.ts</code>:</p> <!></li> <li><p>Import the virtual module anywhere in your app:</p> <!> <p>Both exports match the programmatic <!> shape. See <!> for what flows through <code>diagnostics</code>.</p></li></ol> <p>If TypeScript reports <code>Cannot find module 'virtual:svelte-docinfo'</code>, ensure the <code>/// &lt;reference&gt;</code> line is in your <code>app.d.ts</code>.</p>`,1),S=s(`<!> <p>All options are optional; the minimal call uses defaults (package.json exports discovery, glob
			fallback):</p> <!> <p>Every option, with its default:</p> <!> <p>The plugin runs the same pipeline as <!> internally: discover
			via <!>, resolve dependencies, then analyze. <code>sourceOptions</code> is merged with defaults via <!> before discovery; <code>hmrDebounceMs</code> only affects the dev-mode watcher.</p>`,1),C=s(`<!> <p>The CLI calls <!> once, so use it for CI pipelines and one-off
			generation. The plugin owns a persistent <!>, so
			HMR re-analyses reuse parsed TypeScript ASTs and svelte2tsx output across cycles. Use it when
			the analysis feeds the SvelteKit/Vite bundle. See the <!> guide if you're
			driving a session directly (custom bundler, LSP, etc.).</p>`,1),w=s(`<!> <p>The plugin hooks into four Vite lifecycle stages:</p> <ol><li><strong>configResolved</strong>: throws synchronously when <code>discovery: 'exports'</code> is combined with <code>include</code>, so contradictory
				configs fail at startup rather than at first analysis</li> <li><strong>buildStart</strong>: discovers the source set, reads file contents, and runs <!>'s <code>analyze</code>; caches the
				serialized JSON result</li> <li><strong>resolveId / load</strong>: serves the cached result as <code>virtual:svelte-docinfo</code>, a JavaScript module exporting <code>modules</code>, <code>diagnostics</code>, and a default <code></code></li> <li><strong>configureServer</strong>: watches source directories for changes, debounces
				re-analysis, and sends HMR updates only when the output actually changes. The session diffs
				incoming files by content equality, so unchanged files skip re-parsing entirely.</li></ol>`,1),T=s(`<section><p>The <!> is the recommended path for SvelteKit
			and Vite projects. It runs analysis at build time and serves the result as <!>; in dev mode it watches source
			files and sends HMR updates as you edit.</p></section> <!> <!> <!> <!>`,1);function E(s,E){l(E,!0);let D=p(`vite-plugin`);f(`1v4ku2r`,e=>{t(()=>{i.title=`Vite plugin - svelte-docinfo`})}),y(s,{get tome(){return D},children:(t,i)=>{var o=T(),s=r(o),l=a(s),f=e(a(l));g(f,{module_path:`vite.ts`,children:(e,t)=>{d(),c(e,n(`Vite plugin`))},$$slots:{default:!0}}),_(e(f,2),{lang:`ts`,inline:!0,dangerous_raw_html:`<span class="token_string">'virtual:svelte-docinfo'</span>`}),d(),u(l),u(s);var p=e(s,2);v(p,{children:(t,n)=>{var i=x(),o=r(i);b(o,{text:`Setup`});var s=e(o,2),l=a(s);_(e(a(l),2),{lang:`ts`,dangerous_raw_html:`<span class="token_special_keyword">import</span> <span class="token_punctuation">{</span>defineConfig<span class="token_punctuation">}</span> <span class="token_special_keyword">from</span> <span class="token_string">'vite'</span><span class="token_punctuation">;</span>
<span class="token_special_keyword">import</span> <span class="token_punctuation">{</span>sveltekit<span class="token_punctuation">}</span> <span class="token_special_keyword">from</span> <span class="token_string">'@sveltejs/kit/vite'</span><span class="token_punctuation">;</span>
<span class="token_special_keyword">import</span> svelteDocinfo <span class="token_special_keyword">from</span> <span class="token_string">'svelte-docinfo/vite.js'</span><span class="token_punctuation">;</span>

<span class="token_special_keyword">export</span> <span class="token_special_keyword">default</span> <span class="token_function">defineConfig</span><span class="token_punctuation">(</span><span class="token_punctuation">{</span>
  plugins<span class="token_operator">:</span> <span class="token_punctuation">[</span><span class="token_function">sveltekit</span><span class="token_punctuation">(</span><span class="token_punctuation">)</span><span class="token_punctuation">,</span> <span class="token_function">svelteDocinfo</span><span class="token_punctuation">(</span><span class="token_punctuation">)</span><span class="token_punctuation">]</span><span class="token_punctuation">,</span>
<span class="token_punctuation">}</span><span class="token_punctuation">)</span><span class="token_punctuation">;</span>`}),u(l);var f=e(l,2);_(e(a(f),2),{lang:`ts`,dangerous_raw_html:`<span class="token_comment">/// &lt;reference types="svelte-docinfo/virtual-svelte-docinfo.js" /></span>`}),u(f);var p=e(f,2),g=e(a(p),2);_(g,{lang:`ts`,dangerous_raw_html:`<span class="token_special_keyword">import</span> <span class="token_punctuation">{</span>modules<span class="token_punctuation">,</span> diagnostics<span class="token_punctuation">}</span> <span class="token_special_keyword">from</span> <span class="token_string">'virtual:svelte-docinfo'</span><span class="token_punctuation">;</span>
<span class="token_comment">// or use the default export:</span>
<span class="token_special_keyword">import</span> data <span class="token_special_keyword">from</span> <span class="token_string">'virtual:svelte-docinfo'</span><span class="token_punctuation">;</span>
<span class="token_comment">// data.modules and data.diagnostics are the same as the named exports</span>`});var v=e(g,2),y=e(a(v));h(y,{name:`AnalyzeResultJson`}),m(e(y,2),{slug:`diagnostics`}),d(3),u(v),u(p),u(s),d(2),c(t,i)},$$slots:{default:!0}});var y=e(p,2);v(y,{children:(t,n)=>{var i=S(),o=r(i);b(o,{text:`Options`});var s=e(o,4);_(s,{lang:`ts`,dangerous_raw_html:`<span class="token_function">svelteDocinfo</span><span class="token_punctuation">(</span><span class="token_punctuation">)</span>`});var l=e(s,4);_(l,{lang:`ts`,dangerous_raw_html:`<span class="token_special_keyword">import</span> svelteDocinfo <span class="token_special_keyword">from</span> <span class="token_string">'svelte-docinfo/vite.js'</span><span class="token_punctuation">;</span>

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
<span class="token_punctuation">}</span><span class="token_punctuation">)</span>`});var f=e(l,2),p=e(a(f));h(p,{name:`analyzeFromFiles`});var m=e(p,2);h(m,{name:`discoverSourceFiles`}),h(e(m,4),{name:`createSourceOptions`}),d(3),u(f),c(t,i)},$$slots:{default:!0}});var E=e(y,2);v(E,{children:(t,n)=>{var i=C(),o=r(i);b(o,{text:`CLI vs Vite plugin`});var s=e(o,2),l=e(a(s));h(l,{name:`analyzeFromFiles`});var f=e(l,2);h(f,{name:`createAnalysisSession`}),m(e(f,2),{slug:`session`}),d(),u(s),c(t,i)},$$slots:{default:!0}}),v(e(E,2),{children:(t,n)=>{var i=w(),o=r(i);b(o,{text:`How it works`});var s=e(o,4),l=e(a(s),2);h(e(a(l),2),{name:`createAnalysisSession`}),d(3),u(l);var f=e(l,2),p=e(a(f),8);p.textContent=`{modules, diagnostics}`,u(f),d(2),u(s),c(t,i)},$$slots:{default:!0}}),c(t,o)},$$slots:{default:!0}}),o()}export{E as t};