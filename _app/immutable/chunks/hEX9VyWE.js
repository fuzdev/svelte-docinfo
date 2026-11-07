import{A as e,K as t,M as n,P as r,Q as i,Y as a,Z as o,ct as s,et as c,ft as l,h as u,pt as d,st as f}from"./DfytQE96.js";import{n as p}from"./BnC-tGdx.js";import{t as m}from"./DuTAA-Bs.js";import{t as h}from"./DsRQ6bt9.js";import{t as g}from"./BMIMPPXl.js";import{t as _}from"./DCnbBvfW.js";import{n as v,r as y,t as b}from"./BbU_MvBW.js";var x=n(`<!> <!> <p><!> requires complete <code>ModuleSourceOptions</code>; build them with <!>, which merges your overrides with <!>. The session applies no further defaults.</p> <p>The tsconfig is parsed once, at construction, so a later edit to it needs a new session. The <code>tsconfig</code>, <code>compilerOptions</code>, and <code>rootFileNames</code> options
			work as <!> describes.</p>`,1),S=n(`<!> <p>The session owns a source set that you add to, update, and remove from:</p> <table><thead><tr><th class="white-space:nowrap">Method</th><th>Purpose</th></tr></thead><tbody><tr><td class="white-space:nowrap"><code>setFile(file, opts?)</code></td><td>Ingest one file's content; a no-op on cache hit. Returns <!></td></tr><tr><td class="white-space:nowrap"><code>setFiles(files, opts?)</code></td><td>Ingest a batch. Additive; never removes. Returns <!> with aggregate and per-file views</td></tr><tr><td class="white-space:nowrap"><code>deleteFile(id)</code></td><td>Remove a file from the session</td></tr><tr><td class="white-space:nowrap"><code>has(id)</code></td><td>Whether the given absolute path is currently owned</td></tr><tr><td class="white-space:nowrap"><code>list()</code></td><td>Snapshot of owned file IDs (insertion order), context files included</td></tr><tr><td class="white-space:nowrap"><code>query(opts?)</code></td><td>Analyze the owned set. Files outside <code>sourcePaths</code>, matching <code>exclude</code>, or held as context inform type resolution but emit no module.
						Returns <!></td></tr><tr><td class="white-space:nowrap"><code>allIngestDiagnostics()</code></td><td>Cumulative ingest-time diagnostics across every owned entry</td></tr><tr><td class="white-space:nowrap"><code>getProgram()</code></td><td>The underlying <code>ts.Program</code>, for your own checker work. It goes stale after
						any <code>setFile</code>, <code>setFiles</code>, or <code>deleteFile</code> that changes
						the session, so call it again afterward</td></tr><tr><td class="white-space:nowrap"><code>dispose()</code></td><td>Release resources and clear the owned set. Don't use the session afterward</td></tr></tbody></table> <p><strong>Concurrency.</strong> The session isn't safe for overlapping calls, so serialize them. <code>setFile</code>, <code>setFiles</code>, and <code>deleteFile</code> are async (resolvers
			may await I/O); <code>query</code> is sync and reads the current owned set, so await pending
			ingests first.</p>`,1),C=n(`<!> <p>Re-ingesting a file either reuses everything cached for it or recomputes everything. What
			counts as a hit depends on the mode:</p> <ul><li><strong>lex+resolve</strong> (default): identical content and the same <!> <code>identity</code>.</li> <li><strong>pre-resolved</strong> (caller supplies <code>SourceFileInfo.dependencies</code>):
				identical content and an element-wise equal array. A fresh array with the same elements
				hits, so <!> per call works; any
				length, element, or order difference misses. The dependencies are trusted unchecked; see <!>.</li></ul> <p>Switching a file between modes always misses.</p> <p>Unresolved imports are the exception: a file's edges can change without re-ingesting it. When
			a <code>setFile</code> / <code>setFiles</code> call adds files, the session retries specifiers
			that previously resolved to <code>null</code> in lex+resolve files (with the same resolver),
			updates their edges, and clears stale <code>resolver_failed</code> diagnostics. It also calls
			the resolver's optional <code>invalidate()</code> before the next batch whenever files were
			added or removed since it last ran, so cached failed lookups don't stick. Pre-resolved files
			are untouched.</p> <p>On a hit, <code>SetFileResult.changed</code> is <code>false</code> and the cached ingest
			diagnostics are returned without doing any work, unless the call changes the file's role
			(<code>context</code>), which reports <!> since
			the emitted set moves.</p>`,1),w=n(`<!> <p><!> is <code></code>. <code>identity</code> is a stable opaque
			token (string or symbol) that keys the cache alongside content; <code>invalidate()</code> clears any cached failed lookups when files are added or removed.</p> <!> <p><code>identity</code> is required because function references make poor cache keys: callers
			often wrap a resolver in a fresh closure per call (a common Vite/Rollup pattern), which would
			defeat caching. Reuse the same token as long as resolution behaves the same, and change it
			when it doesn't.</p> <p><code>resolveImport</code> also accepts a bare resolve function. The session-level one is
			wrapped once at construction, so its identity is stable; a bare function passed per call gets
			a fresh identity every call, and so never cache-hits.</p> <p>When neither <code>AnalysisSessionOptions.resolveImport</code> nor a per-call <!>.<code>resolveImport</code> is supplied, the session
			builds a default from TypeScript module resolution and the merged compiler options on first
			use. It sees files that exist only in the session, even in directories absent from disk; a
			custom resolver must handle in-memory files itself to get dependency edges for them.</p>`,1),T=n(`<!> <p>By default a session also ingests the in-project files its sources import that you didn't
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
			turning it into a module, pass <!>. With the
			closure off, as in <code>analyze()</code>, pass every component the checker needs.</p>`,1),E=n(`<!> <p>Diagnostic kinds have two lifecycles:</p> <ul><li><strong>Ingest-time</strong> (<code>transform_failed</code>, <code>source_map_failed</code>, <code>import_parse_failed</code>, <code>resolver_failed</code>): returned from <code>setFile</code> / <code>setFiles</code> and kept with the file until it is re-ingested
				or deleted. A <code>resolver_failed</code> also clears once a later batch resolves its
				specifier.</li> <li><strong>Query-time</strong> (the rest): recomputed and returned by every <code>query</code> call.</li></ul> <p><code>query()</code> does <em>not</em> include ingest diagnostics, and <code>setFile</code> / <code>setFiles</code> return only those for the files you passed (not context-closure files). <code>allIngestDiagnostics()</code> returns the complete set for every owned file:</p> <!> <p>It's cheap, so long-lived consumers can republish the full picture every cycle without
			tracking per-batch returns. The Vite plugin does this on every dev re-analysis.</p> <p>Discovery-time diagnostics (<code>module_unreadable</code>) are a third category. Sessions
			don't run discovery, so if you do, keep those diagnostics yourself and merge them into what
			you publish (see <!>).</p>`,1),D=n(`<!> <p>An LSP-style edit/query loop. Each <code>setFile</code> updates one file; <code>query</code> reanalyzes, reusing parsed ASTs and svelte2tsx output for unchanged files.</p> <!> <p>For HMR and file watchers, pass all changed files to one <code>setFiles</code> call rather
			than looping <code>setFile</code>: a batch resolves imports in parallel.</p>`,1),O=n(`<section><p><!> returns a persistent analysis handle backed
			by a TypeScript <code>LanguageService</code>, for re-analyzing the same files as they change
			(the Vite plugin, watchers, editor tools). It reuses parsed ASTs, svelte2tsx output, and the
			dependency graph across queries. To analyze once, use the one-shot <!> or <!> (see <!>), which wrap single-use sessions. The full types are in <!>.</p></section> <!> <!> <!> <!> <!> <!> <!>`,1);function k(n,k){s(k,!0);let A=p(`session`);u(`ihg8at`,e=>{t(()=>{a.title=`session - svelte-docinfo`})}),y(n,{get tome(){return A},children:(t,n)=>{var a=O(),s=i(a),u=o(s),f=o(u);h(f,{name:`createAnalysisSession`});var p=c(f,4);h(p,{name:`analyze`});var y=c(p,2);h(y,{name:`analyzeFromFiles`});var k=c(y,2);m(k,{slug:`js-api`});var A=c(k,2);g(A,{module_path:`session.ts`,children:(t,n)=>{l();var i=r(`session.ts`);e(t,i)},$$slots:{default:!0}}),l(),d(u),d(s);var j=c(s,2);v(j,{children:(t,n)=>{var a=x(),s=i(a);b(s,{text:`Construction`});var u=c(s,2);_(u,{lang:`ts`,dangerous_raw_html:`<span class="token_special_keyword">import</span> <span class="token_punctuation">{</span>createAnalysisSession<span class="token_punctuation">,</span> createSourceOptions<span class="token_punctuation">}</span> <span class="token_special_keyword">from</span> <span class="token_string">'svelte-docinfo'</span><span class="token_punctuation">;</span>

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
<span class="token_punctuation">});</span>`});var f=c(u,2),p=o(f);h(p,{name:`AnalysisSessionOptions`});var g=c(p,4);h(g,{name:`createSourceOptions`});var v=c(g,2);h(v,{name:`DEFAULT_SOURCE_OPTIONS`}),l(),d(f);var y=c(f,2),S=c(o(y),7);m(S,{slug:`source-files`,hash:`tsconfig`,children:(t,n)=>{l();var i=r(`source files`);e(t,i)},$$slots:{default:!0}}),l(),d(y),e(t,a)},$$slots:{default:!0}});var M=c(j,2);v(M,{children:(t,n)=>{var r=S(),a=i(r);b(a,{text:`Lifecycle`});var s=c(a,4),u=c(o(s)),f=o(u),p=c(o(f)),m=c(o(p));h(m,{name:`SetFileResult`}),d(p),d(f);var g=c(f),_=c(o(g)),v=c(o(_));h(v,{name:`SetFilesResult`}),l(),d(_),d(g);var y=c(g,4),x=c(o(y)),C=c(o(x),5);h(C,{name:`AnalyzeResultJson`}),d(x),d(y),l(3),d(u),d(s),l(2),e(t,r)},$$slots:{default:!0}});var N=c(M,2);v(N,{children:(t,n)=>{var a=C(),s=i(a);b(s,{text:`Cache-hit semantics`});var u=c(s,4),f=o(u),p=c(o(f),2);h(p,{name:`ImportResolver`}),l(3),d(f);var g=c(f,2),v=c(o(g),4);_(v,{lang:`ts`,inline:!0,dangerous_raw_html:`<span class="token_punctuation">[</span><span class="token_operator">...</span>filer<span class="token_punctuation">.</span>deps<span class="token_punctuation">.</span><span class="token_function">keys</span><span class="token_punctuation">()]</span>`});var y=c(v,2);m(y,{slug:`build-tools`,hash:`Trust-contract`,children:(t,n)=>{l();var i=r(`trust contract`);e(t,i)},$$slots:{default:!0}}),l(),d(g),d(u);var x=c(u,6),S=c(o(x),7);_(S,{lang:`ts`,inline:!0,dangerous_raw_html:`changed<span class="token_operator">:</span> <span class="token_boolean">true</span>`}),l(),d(x),e(t,a)},$$slots:{default:!0}});var P=c(N,2);v(P,{children:(t,n)=>{var r=w(),a=i(r);b(a,{text:`ImportResolver and identity`});var s=c(a,2),u=o(s);h(u,{name:`ImportResolver`});var f=c(u,2);f.textContent=`{resolve, identity, invalidate?}`,l(5),d(s);var p=c(s,2);_(p,{lang:`ts`,dangerous_raw_html:`<span class="token_special_keyword">import</span> <span class="token_import_type_keyword token_special_keyword">type</span> <span class="token_punctuation">{</span><span class="token_capitalized_identifier token_class_name">ImportResolver</span><span class="token_punctuation">}</span> <span class="token_special_keyword">from</span> <span class="token_string">'svelte-docinfo'</span><span class="token_punctuation">;</span>

<span class="token_keyword">const</span> myResolver<span class="token_type_annotation"><span class="token_operator">:</span> <span class="token_type"><span class="token_type_name token_class_name">ImportResolver</span></span></span> <span class="token_operator">=</span> <span class="token_punctuation">{</span>
  identity<span class="token_operator">:</span> <span class="token_string">'vite-plugin-container'</span><span class="token_punctuation">,</span>
  <span class="token_function_variable token_function">resolve</span><span class="token_operator">:</span> <span class="token_punctuation">(</span>specifier<span class="token_punctuation">,</span> fromFile<span class="token_punctuation">)</span> <span class="token_operator">=></span> <span class="token_punctuation">{</span>
    <span class="token_comment">// return absolute path, or null for externals</span>
    <span class="token_special_keyword">return</span> <span class="token_keyword">null</span><span class="token_punctuation">;</span>
  <span class="token_punctuation">},</span>
<span class="token_punctuation">};</span>`});var m=c(p,6),g=c(o(m),3);h(g,{name:`SetFileOptions`}),l(3),d(m),e(t,r)},$$slots:{default:!0}});var F=c(P,2);v(F,{children:(t,n)=>{var r=T(),a=i(r);b(a,{text:`Context files`});var s=c(a,4),u=c(o(s),11);_(u,{lang:`ts`,inline:!0,dangerous_raw_html:`<span class="token_punctuation">{</span>context<span class="token_operator">:</span> <span class="token_boolean">true</span><span class="token_punctuation">}</span>`}),l(3),d(s),e(t,r)},$$slots:{default:!0}});var I=c(F,2);v(I,{children:(t,n)=>{var a=E(),s=i(a);b(s,{text:`Diagnostics: ingest-time vs query-time`});var u=c(s,8);_(u,{lang:`ts`,dangerous_raw_html:`<span class="token_keyword">const</span> queryResult <span class="token_operator">=</span> session<span class="token_punctuation">.</span><span class="token_function">query</span><span class="token_punctuation">();</span>
<span class="token_keyword">const</span> fullDiagnostics <span class="token_operator">=</span> <span class="token_punctuation">[</span>
  <span class="token_operator">...</span>session<span class="token_punctuation">.</span><span class="token_function">allIngestDiagnostics</span><span class="token_punctuation">(),</span>
  <span class="token_operator">...</span>queryResult<span class="token_punctuation">.</span>diagnostics<span class="token_punctuation">,</span>
<span class="token_punctuation">];</span>`});var f=c(u,4),p=c(o(f),3);m(p,{slug:`build-tools`,hash:`discoverSourceFiles-standalone`,children:(t,n)=>{l();var i=r(`discoverSourceFiles`);e(t,i)},$$slots:{default:!0}}),l(),d(f),e(t,a)},$$slots:{default:!0}});var L=c(I,2);v(L,{children:(t,n)=>{var r=D(),a=i(r);b(a,{text:`Worked example: incremental loop`});var o=c(a,4);_(o,{lang:`ts`,dangerous_raw_html:`<span class="token_special_keyword">import</span> <span class="token_punctuation">{</span>createAnalysisSession<span class="token_punctuation">,</span> createSourceOptions<span class="token_punctuation">,</span> hasErrors<span class="token_punctuation">}</span> <span class="token_special_keyword">from</span> <span class="token_string">'svelte-docinfo'</span><span class="token_punctuation">;</span>

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
session<span class="token_punctuation">.</span><span class="token_function">dispose</span><span class="token_punctuation">();</span>`}),l(2),e(t,r)},$$slots:{default:!0}}),e(t,a)},$$slots:{default:!0}}),f()}export{k as t};