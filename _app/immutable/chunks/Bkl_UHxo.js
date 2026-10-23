import{$ as e,A as t,G as n,J as r,M as i,P as a,X as o,Z as s,dt as c,ft as l,h as u,ot as d,st as f}from"./Dv5cY9UL.js";import{o as p}from"./COY1KSPd.js";import{t as m}from"./BlpeCiy-.js";import{i as h,n as g,r as _,t as v}from"./COVud6_C.js";import{t as y}from"./CJXZ7M5E.js";import{t as b}from"./Di2O_w4E.js";var x=i(`<!> <!> <p><!> requires complete <code>ModuleSourceOptions</code>; build them with <!>, which merges your overrides with <!>. The session applies no further defaults.</p> <p>The tsconfig (the <code>tsconfig</code> option, or the project's) is parsed once, at
			construction. <code>compilerOptions</code> merge over it per key, and the type checker and
			default resolver both see the merged result. The tsconfig file is required and its whole <code>extends</code> chain must load, unless you pass <code>tsconfig: false</code>, which
			skips the file and uses built-in strict options
			(<!>) under your <code>compilerOptions</code>.
			Later edits to the tsconfig aren't picked up; create a new session.</p> <p>By default every file the tsconfig includes is a root of the program, so a session fed a few
			files of a large project still loads all of it. <code>rootFileNames</code> replaces those
			roots with a list, or filters them with a function. The files you ingest and everything they
			import are always loaded, so narrowing changes output only for types that arrive through no
			import: ambient declarations in a file nothing imports resolve to <code>any</code> once that
			file stops being a root. Keeping the <code>.d.ts</code> roots, as above, covers the usual
			case; see <!>.</p>`,1),S=i(`<!> <p>The session owns a source set that you add to, update, and remove from:</p> <table><thead><tr><th class="white-space:nowrap">Method</th><th>Purpose</th></tr></thead><tbody><tr><td class="white-space:nowrap"><code>setFile(file, opts?)</code></td><td>Ingest one file's content; a no-op on cache hit. Returns <!></td></tr><tr><td class="white-space:nowrap"><code>setFiles(files, opts?)</code></td><td>Ingest a batch. Additive; never removes. Returns <!> with aggregate and per-file views</td></tr><tr><td class="white-space:nowrap"><code>deleteFile(id)</code></td><td>Remove a file from the session</td></tr><tr><td class="white-space:nowrap"><code>has(id)</code></td><td>Whether the given absolute path is currently owned</td></tr><tr><td class="white-space:nowrap"><code>list()</code></td><td>Snapshot of owned file IDs (insertion order), context files included</td></tr><tr><td class="white-space:nowrap"><code>query(opts?)</code></td><td>Analyze the owned set. Files outside <code>sourcePaths</code>, matching <code>exclude</code>, or held as context inform type resolution but emit no module.
						Returns <!></td></tr><tr><td class="white-space:nowrap"><code>allIngestDiagnostics()</code></td><td>Cumulative ingest-time diagnostics across every owned entry</td></tr><tr><td class="white-space:nowrap"><code>getProgram()</code></td><td>The underlying <code>ts.Program</code>, for your own checker work. It goes stale after
						any <code>setFile</code>, <code>setFiles</code>, or <code>deleteFile</code> that changes
						the session, so call it again afterward</td></tr><tr><td class="white-space:nowrap"><code>dispose()</code></td><td>Release resources and clear the owned set. Don't use the session afterward</td></tr></tbody></table> <p><strong>Concurrency.</strong> The session isn't safe for overlapping calls, so serialize them. <code>setFile</code>, <code>setFiles</code>, and <code>deleteFile</code> are async (resolvers
			may await I/O); <code>query</code> is sync and reads the current owned set, so await pending
			ingests first.</p>`,1),C=i(`<!> <p>Re-ingesting a file either reuses everything cached for it or recomputes everything. What
			counts as a hit depends on the mode:</p> <ul><li><strong>lex+resolve</strong> (default): identical content and the same <!> <code>identity</code>.</li> <li><strong>pre-resolved</strong> (caller supplies <code>SourceFileInfo.dependencies</code>):
				identical content and an element-wise equal array. A fresh array with the same elements
				hits, so <code>[...filer.deps.keys()]</code> per call works; any length, element, or order
				difference misses. The dependencies are trusted unchecked; see <!>.</li></ul> <p>Switching a file between modes always misses.</p> <p>Unresolved imports are the exception: a file's edges can change without re-ingesting it. When
			a <code>setFile</code> / <code>setFiles</code> call adds files, the session retries specifiers
			that previously resolved to <code>null</code> in lex+resolve files (with the same resolver),
			updates their edges, and clears stale <code>resolver_failed</code> diagnostics. It also calls
			the resolver's optional <code>invalidate()</code> before the next batch whenever files were
			added or removed since it last ran, so cached failed lookups don't stick. Pre-resolved files
			are untouched.</p> <p>On a hit, <code>SetFileResult.changed</code> is <code>false</code> and the cached ingest
			diagnostics are returned without doing any work, unless the call changes the file's role
			(<code>context</code>), which reports <code>changed: true</code> since the emitted set moves.</p>`,1),w=i(`<!> <p><!> is <code></code>. <code>identity</code> is a stable opaque
			token (string or symbol) that keys the cache alongside content; <code>invalidate()</code> clears any cached failed lookups when files are added or removed.</p> <!> <p><code>identity</code> is required because function references make poor cache keys: callers
			often wrap a resolver in a fresh closure per call (a common Vite/Rollup pattern), which would
			defeat caching. Reuse the same token as long as resolution behaves the same, and change it
			when it doesn't.</p> <p><code>resolveImport</code> also accepts a bare resolve function. The session-level one is
			wrapped once at construction, so its identity is stable; a bare function passed per call gets
			a fresh identity every call, and so never cache-hits.</p> <p>When neither <code>AnalysisSessionOptions.resolveImport</code> nor a per-call <!>.<code>resolveImport</code> is supplied, the session
			builds a default from TypeScript module resolution and the merged compiler options on first
			use. It sees files that exist only in the session, even in directories absent from disk; a
			custom resolver must handle in-memory files itself to get dependency edges for them.</p>`,1),T=i(`<!> <p>By default a session also ingests the in-project files its sources import that you didn't
			supply (transitively, skipping <code>node_modules</code> and dot-directories), so edits to
			them, like <code>internal/</code> modules, stay live instead of being read from disk once.
			These context files emit no modules and add no edges. Their imports always go through
			lex+resolve, so when the closure finds files, even a fully pre-resolved session builds the
			default resolver (unless you supply <code>resolveImport</code>). <code>analyze()</code> turns
			the closure off; <code>analyzeFromFiles</code> keeps it on.</p> <p>That includes source files, such as a component left out of <code>package.json</code> <code>exports</code>, or the rest of the project when you hand over one component. The type
			checker can only read a component through its transformed form, so without the ingest every
			type drawn from that component would be <code>any</code>. Such a file still emits no module
			until you supply it yourself. Each <code>setFile</code>/<code>setFiles</code> call sets the
			role of its files: they're inputs by default, so to forward an edit to a context file without
			turning it into a module, pass <code></code>. With the closure off, as in <code>analyze()</code>, pass every component the checker needs.</p>`,1),E=i(`<!> <p>Diagnostic kinds have two lifecycles:</p> <ul><li><strong>Ingest-time</strong> (<code>transform_failed</code>, <code>source_map_failed</code>, <code>import_parse_failed</code>, <code>resolver_failed</code>): returned from <code>setFile</code> / <code>setFiles</code> and kept with the file until it is re-ingested
				or deleted. A <code>resolver_failed</code> also clears once a later batch resolves its
				specifier.</li> <li><strong>Query-time</strong> (the rest): recomputed and returned by every <code>query</code> call.</li></ul> <p><code>query()</code> does <em>not</em> include ingest diagnostics, and <code>setFile</code> / <code>setFiles</code> return only those for the files you passed (not context-closure files). <code>allIngestDiagnostics()</code> returns the complete set for every owned file:</p> <!> <p>It's cheap, so long-lived consumers can republish the full picture every cycle without
			tracking per-batch returns. The Vite plugin does this on every dev re-analysis.</p> <p>Discovery-time diagnostics (<code>module_unreadable</code>) are a third category. Sessions
			don't run discovery, so if you do, keep those diagnostics yourself and merge them into what
			you publish (see <!>).</p>`,1),D=i(`<!> <p>An LSP-style edit/query loop. Each <code>setFile</code> updates one file; <code>query</code> reanalyzes, reusing parsed ASTs and svelte2tsx output for unchanged files.</p> <!> <p>For HMR and file watchers, pass all changed files to one <code>setFiles</code> call rather
			than looping <code>setFile</code>: a batch resolves imports in parallel.</p>`,1),O=i(`<section><p><!> returns a persistent analysis handle backed
			by a TypeScript <code>LanguageService</code>. Use it when the same source set is re-analyzed
			repeatedly (Vite plugin, LSP-style tools); it reuses parsed ASTs, svelte2tsx output, and the
			dependency graph across cycles. The one-shot <!> and <!> wrap single-use sessions; if you analyze once
			(CLI, CI, one-off generation), use them instead. The full type definitions are in <!>.</p></section> <!> <!> <!> <!> <!> <!> <!>`,1);function k(i,k){f(k,!0);let A=p(`session`);u(`ihg8at`,e=>{n(()=>{r.title=`session - svelte-docinfo`})}),_(i,{get tome(){return A},children:(n,r)=>{var i=O(),u=s(i),d=o(u),f=o(d);h(f,{name:`createAnalysisSession`});var p=e(f,4);h(p,{name:`analyze`});var _=e(p,2);h(_,{name:`analyzeFromFiles`});var k=e(_,2);y(k,{module_path:`session.ts`,children:(e,n)=>{c();var r=a(`session.ts`);t(e,r)},$$slots:{default:!0}}),c(),l(d),l(u);var A=e(u,2);g(A,{children:(n,r)=>{var i=x(),a=s(i);v(a,{text:`Construction`});var u=e(a,2);b(u,{lang:`ts`,dangerous_raw_html:`<span class="token_special_keyword">import</span> <span class="token_punctuation">{</span>createAnalysisSession<span class="token_punctuation">,</span> createSourceOptions<span class="token_punctuation">}</span> <span class="token_special_keyword">from</span> <span class="token_string">'svelte-docinfo'</span><span class="token_punctuation">;</span>

<span class="token_keyword">const</span> session <span class="token_operator">=</span> <span class="token_function">createAnalysisSession</span><span class="token_punctuation">({</span>
  sourceOptions<span class="token_operator">:</span> <span class="token_function">createSourceOptions</span><span class="token_punctuation">(</span>process<span class="token_punctuation">.</span><span class="token_function">cwd</span><span class="token_punctuation">()),</span>
  <span class="token_comment">// Optional: session-default ImportResolver (or a bare resolve function).</span>
  <span class="token_comment">// Defaults to TypeScript module resolution with your tsconfig.</span>
  <span class="token_comment">// resolveImport: myResolver,</span>
  <span class="token_comment">// Optional (default true): also ingest the in-project files your inputs</span>
  <span class="token_comment">// import that you didn't supply, as non-emitting context.</span>
  <span class="token_comment">// contextClosure: true,</span>
  <span class="token_comment">// Optional: a tsconfig path relative to the project root, or false to</span>
  <span class="token_comment">// analyze without one. Default: 'tsconfig.json'.</span>
  <span class="token_comment">// tsconfig: 'tsconfig.lib.json',</span>
  <span class="token_comment">// Optional: the program's root files, in place of the tsconfig's.</span>
  <span class="token_comment">// rootFileNames: declarationFileRoots, // from 'svelte-docinfo/typescript-program.js'</span>
  <span class="token_comment">// Optional: logger for session-level messages.</span>
  <span class="token_comment">// log: console,</span>
<span class="token_punctuation">});</span>`});var d=e(u,2),f=o(d);h(f,{name:`AnalysisSessionOptions`});var p=e(f,4);h(p,{name:`createSourceOptions`});var m=e(p,2);h(m,{name:`DEFAULT_SOURCE_OPTIONS`}),c(),l(d);var g=e(d,2),_=e(o(g),9);h(_,{name:`DEFAULT_COMPILER_OPTIONS`}),c(3),l(g);var y=e(g,2),S=e(o(y),7);h(S,{name:`RootFileNames`}),c(),l(y),t(n,i)},$$slots:{default:!0}});var j=e(A,2);g(j,{children:(n,r)=>{var i=S(),a=s(i);v(a,{text:`Lifecycle`});var u=e(a,4),d=e(o(u)),f=o(d),p=e(o(f)),m=e(o(p));h(m,{name:`SetFileResult`}),l(p),l(f);var g=e(f),_=e(o(g)),y=e(o(_));h(y,{name:`SetFilesResult`}),c(),l(_),l(g);var b=e(g,4),x=e(o(b)),C=e(o(x),5);h(C,{name:`AnalyzeResultJson`}),l(x),l(b),c(3),l(d),l(u),c(2),t(n,i)},$$slots:{default:!0}});var M=e(j,2);g(M,{children:(n,r)=>{var i=C(),u=s(i);v(u,{text:`Cache-hit semantics`});var d=e(u,4),f=o(d),p=e(o(f),2);h(p,{name:`ImportResolver`}),c(3),l(f);var g=e(f,2),_=e(o(g),6);m(_,{slug:`build-tools`,hash:`Trust-contract`,children:(e,n)=>{c();var r=a(`trust contract`);t(e,r)},$$slots:{default:!0}}),c(),l(g),l(d),c(6),t(n,i)},$$slots:{default:!0}});var N=e(M,2);g(N,{children:(n,r)=>{var i=w(),a=s(i);v(a,{text:`ImportResolver and identity`});var u=e(a,2),d=o(u);h(d,{name:`ImportResolver`});var f=e(d,2);f.textContent=`{resolve, identity, invalidate?}`,c(5),l(u);var p=e(u,2);b(p,{lang:`ts`,dangerous_raw_html:`<span class="token_special_keyword">import</span> <span class="token_import_type_keyword token_special_keyword">type</span> <span class="token_punctuation">{</span><span class="token_capitalized_identifier token_class_name">ImportResolver</span><span class="token_punctuation">}</span> <span class="token_special_keyword">from</span> <span class="token_string">'svelte-docinfo'</span><span class="token_punctuation">;</span>

<span class="token_keyword">const</span> myResolver<span class="token_type_annotation"><span class="token_:">:</span> <span class="token_type"><span class="token_type_name token_class_name">ImportResolver</span></span></span> <span class="token_operator">=</span> <span class="token_punctuation">{</span>
  identity<span class="token_operator">:</span> <span class="token_string">'vite-plugin-container'</span><span class="token_punctuation">,</span>
  <span class="token_function_variable token_function">resolve</span><span class="token_operator">:</span> <span class="token_punctuation">(</span>specifier<span class="token_punctuation">,</span> fromFile<span class="token_punctuation">)</span> <span class="token_operator">=></span> <span class="token_punctuation">{</span>
    <span class="token_comment">// return absolute path, or null for externals</span>
    <span class="token_special_keyword">return</span> <span class="token_keyword">null</span><span class="token_punctuation">;</span>
  <span class="token_punctuation">},</span>
<span class="token_punctuation">};</span>`});var m=e(p,6),g=e(o(m),3);h(g,{name:`SetFileOptions`}),c(3),l(m),t(n,i)},$$slots:{default:!0}});var P=e(N,2);g(P,{children:(n,r)=>{var i=T(),a=s(i);v(a,{text:`Context files`});var u=e(a,4),d=e(o(u),11);d.textContent=`{context: true}`,c(3),l(u),t(n,i)},$$slots:{default:!0}});var F=e(P,2);g(F,{children:(n,r)=>{var i=E(),u=s(i);v(u,{text:`Diagnostics: ingest-time vs query-time`});var d=e(u,8);b(d,{lang:`ts`,dangerous_raw_html:`<span class="token_keyword">const</span> queryResult <span class="token_operator">=</span> session<span class="token_punctuation">.</span><span class="token_function">query</span><span class="token_punctuation">();</span>
<span class="token_keyword">const</span> fullDiagnostics <span class="token_operator">=</span> <span class="token_punctuation">[</span>
  <span class="token_operator">...</span>session<span class="token_punctuation">.</span><span class="token_function">allIngestDiagnostics</span><span class="token_punctuation">(),</span>
  <span class="token_operator">...</span>queryResult<span class="token_punctuation">.</span>diagnostics<span class="token_punctuation">,</span>
<span class="token_punctuation">];</span>`});var f=e(d,4),p=e(o(f),3);m(p,{slug:`build-tools`,hash:`discoverSourceFiles-standalone`,children:(e,n)=>{c();var r=a(`discoverSourceFiles`);t(e,r)},$$slots:{default:!0}}),c(),l(f),t(n,i)},$$slots:{default:!0}});var I=e(F,2);g(I,{children:(n,r)=>{var i=D(),a=s(i);v(a,{text:`Worked example: incremental loop`});var o=e(a,4);b(o,{lang:`ts`,dangerous_raw_html:`<span class="token_special_keyword">import</span> <span class="token_punctuation">{</span>createAnalysisSession<span class="token_punctuation">,</span> createSourceOptions<span class="token_punctuation">,</span> hasErrors<span class="token_punctuation">}</span> <span class="token_special_keyword">from</span> <span class="token_string">'svelte-docinfo'</span><span class="token_punctuation">;</span>

<span class="token_keyword">const</span> session <span class="token_operator">=</span> <span class="token_function">createAnalysisSession</span><span class="token_punctuation">({</span>
  sourceOptions<span class="token_operator">:</span> <span class="token_function">createSourceOptions</span><span class="token_punctuation">(</span>process<span class="token_punctuation">.</span><span class="token_function">cwd</span><span class="token_punctuation">()),</span>
<span class="token_punctuation">});</span>

<span class="token_comment">// Initial population.</span>
<span class="token_special_keyword">await</span> session<span class="token_punctuation">.</span><span class="token_function">setFiles</span><span class="token_punctuation">([</span>
  <span class="token_punctuation">{</span>id<span class="token_operator">:</span> <span class="token_string">'/abs/src/lib/a.ts'</span><span class="token_punctuation">,</span> content<span class="token_operator">:</span> <span class="token_string">'...'</span><span class="token_punctuation">},</span>
  <span class="token_punctuation">{</span>id<span class="token_operator">:</span> <span class="token_string">'/abs/src/lib/b.ts'</span><span class="token_punctuation">,</span> content<span class="token_operator">:</span> <span class="token_string">'...'</span><span class="token_punctuation">},</span>
<span class="token_punctuation">]);</span>

<span class="token_comment">// Edit: one file changed.</span>
<span class="token_keyword">const</span> <span class="token_punctuation">{</span>changed<span class="token_punctuation">}</span> <span class="token_operator">=</span> <span class="token_special_keyword">await</span> session<span class="token_punctuation">.</span><span class="token_function">setFile</span><span class="token_punctuation">({</span>
  id<span class="token_operator">:</span> <span class="token_string">'/abs/src/lib/a.ts'</span><span class="token_punctuation">,</span>
  content<span class="token_operator">:</span> <span class="token_string">'... new content ...'</span><span class="token_punctuation">,</span>
<span class="token_punctuation">});</span>

<span class="token_special_keyword">if</span> <span class="token_punctuation">(</span>changed<span class="token_punctuation">)</span> <span class="token_punctuation">{</span>
  <span class="token_keyword">const</span> <span class="token_punctuation">{</span>modules<span class="token_punctuation">,</span> diagnostics<span class="token_operator">:</span> pass<span class="token_punctuation">}</span> <span class="token_operator">=</span> session<span class="token_punctuation">.</span><span class="token_function">query</span><span class="token_punctuation">();</span>
  <span class="token_keyword">const</span> all <span class="token_operator">=</span> <span class="token_punctuation">[</span><span class="token_operator">...</span>session<span class="token_punctuation">.</span><span class="token_function">allIngestDiagnostics</span><span class="token_punctuation">(),</span> <span class="token_operator">...</span>pass<span class="token_punctuation">];</span>
  <span class="token_special_keyword">if</span> <span class="token_punctuation">(</span><span class="token_function">hasErrors</span><span class="token_punctuation">(</span>all<span class="token_punctuation">))</span> <span class="token_punctuation">{</span>
    <span class="token_comment">// surface to the editor</span>
  <span class="token_punctuation">}</span>
<span class="token_punctuation">}</span>

<span class="token_comment">// Tear down.</span>
session<span class="token_punctuation">.</span><span class="token_function">dispose</span><span class="token_punctuation">();</span>`}),c(2),t(n,i)},$$slots:{default:!0}}),t(n,i)},$$slots:{default:!0}}),d()}export{k as t};